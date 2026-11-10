import { describe, expect, it } from "vitest";
import { carryForwardEmployee, findMissingSalaried, previousRipplingMonth, withCarriedForward } from "../../lib/ripplingCarryForward";
import type { Employee } from "../../lib/types";

const salaried = (name: string, extra: Partial<Employee> = {}): Employee => ({
  id: name, name, role: "General Manager", department: "Operations", location: "Georgia",
  manager: "Braden Kerr", payType: "salary", annualPay: 52000, ...extra
});
const hourly = (name: string): Employee => ({
  id: name, name, role: "Specialist", department: "Preservation", location: "Georgia", payType: "hourly", hourlyRate: 17, hoursWorked: 120
});

describe("previousRipplingMonth", () => {
  it("finds the latest earlier month with rows", () => {
    expect(previousRipplingMonth({ "2026-08": [hourly("A")], "2026-09": [], "2026-11": [hourly("A")] }, "2026-10")).toBe("2026-08");
    expect(previousRipplingMonth({ "2026-11": [hourly("A")] }, "2026-10")).toBeUndefined();
  });
});

describe("findMissingSalaried", () => {
  const rippling = { "2026-09": [salaried("Zac Williams"), salaried("Hailey Hill"), hourly("Abi Gregory"), salaried("Manual Person", { manual: true })] };

  it("returns only salaried people from the previous month missing from the upload", () => {
    const missing = findMissingSalaried(rippling, "2026-10", [salaried("hailey  hill")]);
    expect(missing.map((m) => m.employee.name)).toEqual(["Zac Williams"]);
    expect(missing[0].fromMonth).toBe("2026-09");
    expect(missing[0].employee.annualPay).toBe(52000);
  });

  it("skips people already deactivated from this month on", () => {
    expect(findMissingSalaried(rippling, "2026-10", [], (n) => n === "Zac Williams").map((m) => m.employee.name)).toEqual(["Hailey Hill"]);
  });

  it("is empty when there is no earlier upload", () => {
    expect(findMissingSalaried(rippling, "2026-09", [])).toEqual([]);
  });
});

describe("carryForwardEmployee", () => {
  it("uses the uploaded values and drops month-specific hours and pay", () => {
    const carried = carryForwardEmployee(salaried("Zac Williams", {
      department: "Override Dept", manager: "Override Mgr", uploaded: { department: "Operations", manager: "Braden Kerr", assignedManagerId: "b" },
      hoursWorked: 160, grossEarnings: 4000, isManager: true
    }));
    expect(carried).toMatchObject({ department: "Operations", manager: "Braden Kerr", assignedManagerId: "b", annualPay: 52000 });
    expect(carried.uploaded).toBeUndefined();
    expect(carried.hoursWorked).toBeUndefined();
    expect(carried.grossEarnings).toBeUndefined();
  });
});

describe("withCarriedForward", () => {
  it("carries keep and one-month deactivations, not ongoing ones", () => {
    const missing = findMissingSalaried({ "2026-09": [salaried("A"), salaried("B"), salaried("C")] }, "2026-10", []);
    const result = withCarriedForward([hourly("X")], missing, { A: "keep", B: "month", C: "from" });
    expect(result.map((e) => e.name)).toEqual(["X", "A", "B"]);
  });
});
