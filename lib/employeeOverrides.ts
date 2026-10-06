import type { Employee, EmployeeOverride } from "./types";

export function employeeOverrideFromRow(row: Record<string, any>): EmployeeOverride {
  return {
    employeeName: row.employee_name,
    department: row.department || undefined,
    managerId: row.manager_id || undefined,
    managerName: row.manager_name || undefined,
    effectiveFrom: row.effective_from,
    updatedBy: row.updated_by || undefined,
    updatedAt: row.updated_at || undefined
  };
}

export function employeeOverrideToRow(override: EmployeeOverride) {
  return {
    employee_name: override.employeeName,
    department: override.department || null,
    manager_id: override.managerId || null,
    manager_name: override.managerName || null,
    effective_from: override.effectiveFrom,
    updated_by: override.updatedBy || null,
    updated_at: override.updatedAt || new Date().toISOString()
  };
}

export function activeOverride(employeeName: string, period: string, overrides: EmployeeOverride[] = []): EmployeeOverride | undefined {
  return overrides.find((o) => o.employeeName === employeeName && period >= o.effectiveFrom);
}

// Applies overrides to one month's rows. Idempotent: rows already carrying an override are
// first restored to their uploaded values, so re-applying after an override is edited or
// cleared always lands on the right result.
export function applyEmployeeOverrides(period: string, employees: Employee[], overrides: EmployeeOverride[] = []): Employee[] {
  return employees.map((emp) => {
    const base = emp.uploaded ?? { department: emp.department, manager: emp.manager, assignedManagerId: emp.assignedManagerId };
    const { uploaded: _uploaded, ...rest } = emp;
    const restored: Employee = { ...rest, department: base.department, manager: base.manager, assignedManagerId: base.assignedManagerId };
    const override = activeOverride(emp.name, period, overrides);
    if (!override || (!override.department && !override.managerId)) return restored;
    return {
      ...restored,
      ...(override.department ? { department: override.department } : {}),
      ...(override.managerId ? { assignedManagerId: override.managerId, manager: override.managerName || base.manager } : {}),
      uploaded: base
    };
  });
}

export function applyEmployeeOverridesToAll(rippling: Record<string, Employee[]>, overrides: EmployeeOverride[] = []): Record<string, Employee[]> {
  return Object.fromEntries(Object.entries(rippling).map(([period, employees]) => [period, applyEmployeeOverrides(period, employees, overrides)]));
}
