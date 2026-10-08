import { describe, expect, it } from "vitest";
import { applyEmployeeOverridesToAll } from "../../lib/employeeOverrides";
import { lockMonthStartProfiles, unlockMonthStartProfile } from "../../lib/monthStartLock";
import { employeeToRow } from "../../lib/supabase";
import type { Employee } from "../../lib/types";

const ava: Employee = { id: "ava", name: "Ava", role: "Design Specialist", department: "Design", location: "Georgia", payType: "hourly" };
const promoted: Employee = { ...ava, role: "Senior Designer", department: "Production", hoursWorked: 160 };

describe("lockMonthStartProfiles", () => {
  it("keeps a month's title, department and location from the previous upload", () => {
    const locked = lockMonthStartProfiles({ "2026-08": [ava], "2026-09": [promoted] });
    expect(locked["2026-09"][0]).toMatchObject({ role: "Design Specialist", department: "Design", location: "Georgia", hoursWorked: 160 });
    expect(locked["2026-09"][0].monthStartHeld).toEqual({ role: "Senior Designer", department: "Production" });
    expect(locked["2026-08"][0]).toEqual(ava);
  });

  it("applies the uploaded change from the following month", () => {
    const locked = lockMonthStartProfiles({ "2026-08": [ava], "2026-09": [promoted], "2026-10": [promoted] });
    expect(locked["2026-10"][0]).toEqual(promoted);
    expect(unlockMonthStartProfile(locked["2026-09"][0])).toEqual(promoted);
  });

  it("uses the most recent earlier upload when a month was skipped, and leaves new hires as uploaded", () => {
    const newHire: Employee = { ...ava, id: "bo", name: "Bo" };
    const locked = lockMonthStartProfiles({ "2026-07": [ava], "2026-09": [promoted, newHire] });
    expect(locked["2026-09"][0].role).toBe("Design Specialist");
    expect(locked["2026-09"][1]).toEqual(newHire);
  });

  it("lets an admin department override for the month win over the lock", () => {
    const overrides = [{ employeeName: "Ava", department: "Fulfillment", effectiveFrom: "2026-09" }];
    const locked = lockMonthStartProfiles(applyEmployeeOverridesToAll({ "2026-08": [ava], "2026-09": [promoted] }, overrides));
    expect(locked["2026-09"][0]).toMatchObject({ role: "Design Specialist", department: "Fulfillment" });
  });

  it("stores rows as Rippling uploaded them, never the locked values", () => {
    const locked = lockMonthStartProfiles({ "2026-08": [ava], "2026-09": [promoted] });
    expect(employeeToRow("2026-09", locked["2026-09"][0])).toMatchObject({ role: "Senior Designer", department: "Production" });
  });
});
