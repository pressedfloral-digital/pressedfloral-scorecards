import type { Employee } from "./types";

type ProfileFields = Pick<Employee, "role" | "department" | "location">;

// First month the lock applies to. Earlier months keep their uploaded values, so scorecards
// already scored or set up before the guardrail existed are left as they were.
export const MONTH_START_LOCK_FROM = "2026-10";

// A team member's title, department and location — what decides which goals land on their
// scorecard — are locked to their values on day 1 of the month. A month's Rippling upload
// arrives after the month ends and reflects any mid-month change, so each month's rows take
// these fields from the previous upload (the data the scorecard was set up from) and the
// uploaded values only take effect the following month. New team members, with no earlier
// upload, keep what was uploaded. An admin department override for the month still wins.
export function lockMonthStartProfiles(rippling: Record<string, Employee[]>): Record<string, Employee[]> {
  const periods = Object.keys(rippling).sort();
  const result: Record<string, Employee[]> = {};
  periods.forEach((period, i) => {
    const prior = new Map<string, Employee>();
    for (const earlier of periods.slice(0, i).reverse()) {
      for (const emp of rippling[earlier] || []) if (!prior.has(emp.name)) prior.set(emp.name, emp);
    }
    if (period < MONTH_START_LOCK_FROM) { result[period] = rippling[period] || []; return; }
    result[period] = (rippling[period] || []).map((emp) => {
      const start = prior.get(emp.name);
      if (!start) return emp;
      const locked: ProfileFields = {
        role: start.role,
        // Department overrides apply from a month onward, so if this month has none the
        // earlier one doesn't either — its department is as uploaded.
        department: emp.uploaded ? emp.department : start.uploaded?.department ?? start.department,
        location: start.location
      };
      const held: Partial<ProfileFields> = {};
      for (const key of ["role", "department", "location"] as const) {
        if (locked[key] !== emp[key]) held[key] = emp[key];
      }
      if (Object.keys(held).length === 0) return emp;
      return { ...emp, ...locked, monthStartHeld: held };
    });
  });
  return result;
}

// Restores the values Rippling uploaded — used when a month's rows stand in for a later
// month with no upload yet, where the change has taken effect.
export function unlockMonthStartProfile(emp: Employee): Employee {
  if (!emp.monthStartHeld) return emp;
  const { monthStartHeld, ...rest } = emp;
  return { ...rest, ...monthStartHeld };
}
