import type { Employee, ProfileRole } from "./types";

// Matching Rippling upload rows to the app user who manages them. A row whose Manager name
// matches exactly one app user (by linked employee name or any of their alternate names) — and doesn't contradict the team member's own supervisor on
// the Users page — is assigned automatically. Everything else becomes an issue the uploader
// has to resolve before the upload saves.

export type AssignableUser = {
  id: string;
  email: string;
  role: ProfileRole;
  departments: string[];
  locations: string[];
  linkedEmployeeName?: string;
  linkedNameAliases?: string[];
  supervisorId?: string;
};

export type ManagerIssueReason =
  | "conflict"       // CSV manager matches a user, but the team member's app supervisor is someone else
  | "unmatched"      // CSV manager name doesn't match any app user
  | "ambiguous"      // CSV manager name matches more than one app user
  | "missing";       // CSV has no manager, but the team member has an app supervisor

export type ManagerIssue = {
  employeeName: string;
  department: string;
  location: string;
  csvManager: string;
  reason: ManagerIssueReason;
  appSupervisorId?: string;
  csvMatchIds: string[];
  // Best guesses, most likely first: app supervisor, CSV match(es), then managers whose
  // department/location scope covers the team member.
  suggestedIds: string[];
};

export function normalizePersonName(name: string | undefined): string {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function canManage(user: AssignableUser) {
  return user.role === "manager" || user.role === "admin";
}

// Managers whose department/location scope covers the employee, explicit matches first.
export function scopeMatches(emp: Pick<Employee, "department" | "location">, users: AssignableUser[]): AssignableUser[] {
  const score = (u: AssignableUser) => {
    const deptOk = u.departments.length === 0 || u.departments.includes(emp.department);
    const locOk = u.locations.length === 0 || u.locations.includes(emp.location);
    if (!deptOk || !locOk) return -1;
    return (u.departments.includes(emp.department) ? 2 : 0) + (u.locations.includes(emp.location) ? 1 : 0);
  };
  return users
    .filter((u) => u.role === "manager")
    .map((u) => ({ u, s: score(u) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u);
}

export function resolveUploadManagers(employees: Employee[], users: AssignableUser[]): { employees: Employee[]; issues: ManagerIssue[] } {
  const byLinkedName = new Map<string, AssignableUser[]>();
  for (const u of users) {
    const keys = new Set([u.linkedEmployeeName, ...(u.linkedNameAliases || [])].map(normalizePersonName).filter(Boolean));
    for (const key of keys) byLinkedName.set(key, [...(byLinkedName.get(key) || []), u]);
  }
  const userIds = new Set(users.map((u) => u.id));

  const issues: ManagerIssue[] = [];
  const resolved = employees.map((emp) => {
    const csvManager = (emp.manager || "").trim();
    const csvMatches = csvManager ? (byLinkedName.get(normalizePersonName(csvManager)) || []).filter(canManage) : [];
    const ownUser = (byLinkedName.get(normalizePersonName(emp.name)) || [])[0];
    const appSupervisorId = ownUser?.supervisorId && userIds.has(ownUser.supervisorId) ? ownUser.supervisorId : undefined;

    let reason: ManagerIssueReason | null = null;
    if (csvMatches.length === 1) {
      if (appSupervisorId && appSupervisorId !== csvMatches[0].id) reason = "conflict";
      else return { ...emp, assignedManagerId: csvMatches[0].id };
    } else if (csvMatches.length > 1) {
      reason = "ambiguous";
    } else if (csvManager) {
      reason = "unmatched";
    } else if (appSupervisorId) {
      reason = "missing";
    } else {
      // No manager anywhere (e.g. the top of the org) — nothing to reconcile.
      return { ...emp, assignedManagerId: undefined };
    }

    const suggested = [
      ...(appSupervisorId ? [appSupervisorId] : []),
      ...csvMatches.map((u) => u.id),
      ...scopeMatches(emp, users).map((u) => u.id),
    ];
    issues.push({
      employeeName: emp.name,
      department: emp.department,
      location: emp.location,
      csvManager,
      reason,
      appSupervisorId,
      csvMatchIds: csvMatches.map((u) => u.id),
      suggestedIds: [...new Set(suggested)],
    });
    return { ...emp, assignedManagerId: undefined };
  });

  return { employees: resolved, issues };
}

// Applies the uploader's choices. The row's Manager name is rewritten to the chosen user's
// linked employee name so the Rippling name chain agrees with the assignment.
export const LEAVE_UNASSIGNED = "__unassigned__";

export function applyManagerChoices(employees: Employee[], choices: Record<string, string>, users: AssignableUser[]): Employee[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  return employees.map((emp) => {
    const choice = choices[emp.name];
    if (!choice || choice === LEAVE_UNASSIGNED) return emp;
    const user = byId.get(choice);
    if (!user) return emp;
    return { ...emp, assignedManagerId: user.id, manager: user.linkedEmployeeName || user.email };
  });
}

export function describeIssue(issue: ManagerIssue): string {
  switch (issue.reason) {
    case "conflict": return "CSV manager differs from the supervisor set in the app";
    case "unmatched": return "CSV manager doesn't match any app user";
    case "ambiguous": return "CSV manager matches more than one app user";
    case "missing": return "CSV has no manager, but a supervisor is set in the app";
  }
}
