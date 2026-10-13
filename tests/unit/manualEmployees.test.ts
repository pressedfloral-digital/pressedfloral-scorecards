import { describe, expect, it } from "vitest";
import { lastDayStillApplies, manualEmployeesForPeriod } from "../../lib/manualEmployees";
import type { Employee } from "../../lib/types";

const braden = (patch: Partial<Employee> = {}): Employee =>
  ({ id: "manual:Braden Kerr", name: "Braden Kerr", role: "Head of Operations", department: "Operations", location: "Utah", payType: "salary", annualPay: 72000, manual: true, ...patch });

describe("manualEmployeesForPeriod", () => {
  it("carries an entry forward to later periods, dropping period-specific hours and earnings", () => {
    const byPeriod = { "2026-07": [braden({ hoursWorked: 480, grossEarnings: 18000 })] };
    const [q4] = manualEmployeesForPeriod(byPeriod, "2026-10");
    expect(q4).toMatchObject({ name: "Braden Kerr", annualPay: 72000, manualFrom: "2026-07" });
    expect(q4.hoursWorked).toBeUndefined();
    expect(q4.grossEarnings).toBeUndefined();
  });

  it("keeps hours and earnings for the period the entry was made for", () => {
    const [q3] = manualEmployeesForPeriod({ "2026-07": [braden({ hoursWorked: 480 })] }, "2026-07");
    expect(q3.hoursWorked).toBe(480);
  });

  it("uses the latest entry at or before the period, and nothing before the first entry", () => {
    const byPeriod = { "2026-07": [braden()], "2026-10": [braden({ annualPay: 80000 })] };
    expect(manualEmployeesForPeriod(byPeriod, "2026-09")[0].annualPay).toBe(72000);
    expect(manualEmployeesForPeriod(byPeriod, "2027-01")[0].annualPay).toBe(80000);
    expect(manualEmployeesForPeriod(byPeriod, "2026-06")).toEqual([]);
  });
});

describe("lastDayStillApplies", () => {
  it("ignores a last day from before the manual entry, but not one after it", () => {
    expect(lastDayStillApplies({ manual: true, manualFrom: "2026-07" }, "2025-11-15")).toBe(false);
    expect(lastDayStillApplies({ manual: true, manualFrom: "2026-07" }, "2026-08-20")).toBe(true);
    expect(lastDayStillApplies({}, "2025-11-15")).toBe(true);
  });
});
