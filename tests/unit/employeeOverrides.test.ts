import { describe, expect, it } from "vitest";
import { applyEmployeeOverrides, applyEmployeeOverridesToAll } from "../../lib/employeeOverrides";
import { employeeToRow } from "../../lib/supabase";
import type { Employee, EmployeeOverride } from "../../lib/types";

const ava: Employee = { id: "ava", name: "Ava", role: "Designer", department: "Design", location: "Georgia", manager: "Talbot Chipman", payType: "hourly" };
const override: EmployeeOverride = { employeeName: "Ava", department: "Fulfillment", managerId: "u-braden", managerName: "Braden Kerr", effectiveFrom: "2026-09" };

describe("applyEmployeeOverrides", () => {
  it("applies from the effective month onward and leaves earlier months as uploaded", () => {
    const rippling = applyEmployeeOverridesToAll({ "2026-08": [ava], "2026-09": [ava], "2026-10": [ava] }, [override]);
    expect(rippling["2026-08"][0]).toEqual(ava);
    for (const month of ["2026-09", "2026-10"]) {
      expect(rippling[month][0]).toMatchObject({ department: "Fulfillment", manager: "Braden Kerr", assignedManagerId: "u-braden" });
      expect(rippling[month][0].uploaded).toEqual({ department: "Design", manager: "Talbot Chipman", assignedManagerId: undefined });
    }
  });

  it("can override just the department or just the manager", () => {
    const [deptOnly] = applyEmployeeOverrides("2026-09", [ava], [{ ...override, managerId: undefined, managerName: undefined }]);
    expect(deptOnly).toMatchObject({ department: "Fulfillment", manager: "Talbot Chipman" });
    const [mgrOnly] = applyEmployeeOverrides("2026-09", [ava], [{ ...override, department: undefined }]);
    expect(mgrOnly).toMatchObject({ department: "Design", manager: "Braden Kerr", assignedManagerId: "u-braden" });
  });

  it("restores uploaded values when re-applied after the override is cleared", () => {
    const [edited] = applyEmployeeOverrides("2026-09", [ava], [override]);
    const [reset] = applyEmployeeOverrides("2026-09", [edited], []);
    expect(reset).toEqual(ava);
  });

  it("stores rows as Rippling uploaded them, never the override", () => {
    const [edited] = applyEmployeeOverrides("2026-09", [ava], [override]);
    expect(employeeToRow("2026-09", edited)).toMatchObject({ department: "Design", manager: "Talbot Chipman" });
    expect(employeeToRow("2026-09", edited)).not.toHaveProperty("assigned_manager_id");
  });
});
