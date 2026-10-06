import { describe, expect, it } from "vitest";
import { applyManagerChoices, resolveUploadManagers, type AssignableUser } from "../../lib/managerAssignment";
import { getReportingTree, profileNode } from "../../lib/reportingTree";
import type { Employee } from "../../lib/types";

function emp(name: string, manager: string, extra: Partial<Employee> = {}): Employee {
  return { id: name, name, role: "Specialist", department: "Design", location: "Utah", manager, payType: "hourly", ...extra };
}

const sarah: AssignableUser = { id: "u-sarah", email: "sarah@x.com", role: "manager", departments: ["Design"], locations: ["Utah"], linkedEmployeeName: "Sarah Miller" };
const tom: AssignableUser = { id: "u-tom", email: "tom@x.com", role: "manager", departments: ["Design"], locations: [], linkedEmployeeName: "Tom Reed" };
const unlinked: AssignableUser = { id: "u-gm", email: "gm@x.com", role: "manager", departments: [], locations: ["Georgia"] };

describe("resolveUploadManagers", () => {
  it("auto-assigns when the CSV manager matches one app user (case/space-insensitive)", () => {
    const { employees, issues } = resolveUploadManagers([emp("Ava", " sarah  miller ")], [sarah, tom]);
    expect(issues).toEqual([]);
    expect(employees[0].assignedManagerId).toBe("u-sarah");
  });

  it("flags a conflict with the team member's app supervisor", () => {
    const ava: AssignableUser = { id: "u-ava", email: "ava@x.com", role: "user", departments: [], locations: [], linkedEmployeeName: "Ava", supervisorId: "u-tom" };
    const { employees, issues } = resolveUploadManagers([emp("Ava", "Sarah Miller")], [sarah, tom, ava]);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe("conflict");
    expect(issues[0].suggestedIds.slice(0, 2)).toEqual(["u-tom", "u-sarah"]);
    expect(employees[0].assignedManagerId).toBeUndefined();
  });

  it("flags an unmatched CSV manager and suggests managers by department/location", () => {
    const { issues } = resolveUploadManagers([emp("Mia", "Sarah J. Miller")], [sarah, tom, unlinked]);
    expect(issues[0].reason).toBe("unmatched");
    expect(issues[0].suggestedIds).toEqual(["u-sarah", "u-tom"]);
  });

  it("flags a blank CSV manager only when the app has a supervisor", () => {
    const ava: AssignableUser = { id: "u-ava", email: "ava@x.com", role: "user", departments: [], locations: [], linkedEmployeeName: "Ava", supervisorId: "u-sarah" };
    const { issues } = resolveUploadManagers([emp("Ava", ""), emp("CEO", "")], [sarah, ava]);
    expect(issues.map((i) => [i.employeeName, i.reason])).toEqual([["Ava", "missing"]]);
  });
});

describe("applyManagerChoices + reporting tree", () => {
  it("assigns the chosen manager and rewrites the manager name", () => {
    const [mia] = applyManagerChoices([emp("Mia", "Sarah J. Miller")], { Mia: "u-sarah" }, [sarah]);
    expect(mia.assignedManagerId).toBe("u-sarah");
    expect(mia.manager).toBe("Sarah Miller");
  });

  it("puts an upload-assigned team member in an unlinked manager's tree, and their supervisor's", () => {
    const rows = applyManagerChoices([emp("Jo", "Nobody", { location: "Georgia" })], { Jo: "u-gm" }, [unlinked]);
    expect(getReportingTree([profileNode("u-gm")], rows).has("Jo")).toBe(true);
    const profiles = [{ id: "u-gm", supervisorId: "u-boss" }];
    expect(getReportingTree([profileNode("u-boss")], rows, profiles).has("Jo")).toBe(true);
    expect(getReportingTree([profileNode("u-other")], rows, profiles).has("Jo")).toBe(false);
  });

  it("keeps the plain Rippling name chain working", () => {
    const rows = [emp("Lead", "Sarah Miller"), emp("Ava", "Lead")];
    expect([...getReportingTree("Sarah Miller", rows)].sort()).toEqual(["Ava", "Lead"]);
  });
});
