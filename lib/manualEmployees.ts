import type { Employee } from "./types";

// People entered by hand (manual_employees) stay on the roster from the period they were
// entered for onward, like a Rippling employee, until an upload includes them. Each person's
// latest entry at or before the period applies. Hours and gross earnings belong to the period
// they were entered for, so a carried-forward entry drops them (salaried pay still works
// from annual pay; hourly pay needs that period's hours).
export function manualEmployeesForPeriod(byPeriod: Record<string, Employee[]> | undefined, isoMonth: string): Employee[] {
  const latest = new Map<string, { period: string; employee: Employee }>();
  for (const [period, rows] of Object.entries(byPeriod || {})) {
    if (period > isoMonth) continue;
    for (const employee of rows) {
      const prev = latest.get(employee.name);
      if (!prev || prev.period < period) latest.set(employee.name, { period, employee });
    }
  }
  return Array.from(latest.values()).map(({ period, employee }) => ({
    ...employee,
    manual: true,
    manualFrom: period,
    ...(period === isoMonth ? {} : { hoursWorked: undefined, grossEarnings: undefined }),
  }));
}

// An old last day from before someone's manual entry (e.g. they left, then came back) doesn't
// hide them; a last day on or after the entry does.
export function lastDayStillApplies(employee: Pick<Employee, "manual" | "manualFrom">, lastDay: string): boolean {
  return !(employee.manual && employee.manualFrom && lastDay < `${employee.manualFrom}-01`);
}
