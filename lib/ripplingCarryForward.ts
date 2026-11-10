import { normalizePersonName } from "./managerAssignment";
import type { Employee } from "./types";

// Salaried pay doesn't change month to month unless Rippling says so, so a salaried employee
// who was in the previous month's upload but is missing from this one is carried forward with
// the same title, department, location, manager and salary. The uploader is asked about each
// one first: keep them, deactivate their scorecard for just this month, or deactivate it for
// this month and every month after.
export type MissingSalariedDecision = "keep" | "month" | "from";

export type MissingSalaried = {
  employee: Employee; // the row to carry forward into the uploaded month
  fromMonth: string;  // ISO month their row was copied from
};

// Latest ISO month before `month` that has Rippling rows.
export function previousRipplingMonth(rippling: Record<string, Employee[]>, month: string): string | undefined {
  return Object.keys(rippling).filter((m) => m < month && rippling[m]?.length).sort().pop();
}

// Copy of a previous month's row for carrying forward: the values Rippling uploaded (admin
// overrides and month-start holds are re-applied on load), without that month's hours or pay.
export function carryForwardEmployee(employee: Employee): Employee {
  const { uploaded, monthStartHeld, hoursWorked: _hours, grossEarnings: _gross, isManager: _isManager, ...rest } = employee;
  return {
    ...rest,
    id: `carried:${employee.name}`,
    role: monthStartHeld?.role ?? employee.role,
    department: monthStartHeld?.department ?? uploaded?.department ?? employee.department,
    location: monthStartHeld?.location ?? employee.location,
    manager: uploaded ? uploaded.manager : employee.manager,
    assignedManagerId: uploaded ? uploaded.assignedManagerId : employee.assignedManagerId
  };
}

// Salaried employees from the previous upload who aren't in this one. `deactivatedFrom` says
// whether someone's scorecard is already deactivated from this month onward; they're skipped
// (nothing to ask, nothing to carry).
export function findMissingSalaried(
  rippling: Record<string, Employee[]>,
  month: string,
  uploaded: Employee[],
  deactivatedFrom: (employeeName: string) => boolean = () => false
): MissingSalaried[] {
  const fromMonth = previousRipplingMonth(rippling, month);
  if (!fromMonth) return [];
  const present = new Set(uploaded.map((e) => normalizePersonName(e.name)));
  const seen = new Set<string>();
  const missing: MissingSalaried[] = [];
  for (const emp of rippling[fromMonth]) {
    const key = normalizePersonName(emp.name);
    if (emp.manual || emp.payType !== "salary" || !key || present.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (deactivatedFrom(emp.name)) continue;
    missing.push({ employee: carryForwardEmployee(emp), fromMonth });
  }
  return missing.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}

// The upload plus carried-forward rows. "keep" and "month" are carried (a one-month deactivation
// still needs them in the roster so next month's upload is checked against them); "from" is not.
export function withCarriedForward(uploaded: Employee[], missing: MissingSalaried[], decisions: Record<string, MissingSalariedDecision>): Employee[] {
  const carried = missing
    .filter((m) => (decisions[m.employee.name] ?? "keep") !== "from")
    .map((m) => m.employee);
  return [...uploaded, ...carried];
}
