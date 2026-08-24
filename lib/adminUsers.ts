import type { ManagerProfile, ProfileRole } from "./types";

export const PROFILE_ROLES: ProfileRole[] = ["admin", "manager", "user"];

export const SCORECARD_DEPARTMENTS = [
  "Client Care",
  "Design",
  "Experience",
  "Fulfillment",
  "General & Administrative",
  "Growth",
  "Marketing",
  "Operations",
  "Preservation",
  "Recreation",
  "Resin"
];

export const SCORECARD_LOCATIONS = ["Utah", "Georgia", "Remote"];

export type AdminManagedUser = {
  id: string;
  email: string;
  role: ProfileRole;
  departments: string[];
  locations: string[];
  linkedEmployeeName?: string;
  titleOverride?: string;
  supervisorId?: string;
  scorecardPeriodType?: "monthly" | "quarterly";
  companyGoalsGrant?: boolean;
  hasProfile: boolean;
  status: "active" | "invited" | "unconfirmed" | "deactivated";
  deactivatedAt?: string;
  invitedAt?: string;
  confirmedAt?: string;
  lastSignInAt?: string;
  createdAt?: string;
};

export type AdminUserPayload = {
  id?: string;
  email?: string;
  role: ProfileRole;
  departments: string[];
  locations: string[];
  linkedEmployeeName?: string;
  titleOverride?: string;
  supervisorId?: string;
  scorecardPeriodType?: "monthly" | "quarterly";
  companyGoalsGrant?: boolean;
  allDepartments?: boolean;
  allLocations?: boolean;
};

type NormalizeOptions = {
  requireEmail?: boolean;
  requireId?: boolean;
  departments?: string[];
  locations?: string[];
};

type NormalizeResult =
  | { ok: true; value: AdminUserPayload }
  | { ok: false; error: string };

export function parseProfileRole(value: unknown): ProfileRole | null {
  return PROFILE_ROLES.includes(value as ProfileRole) ? value as ProfileRole : null;
}

export function isConfiguredProfile(profile: ManagerProfile | null): profile is ManagerProfile {
  if (!profile || !parseProfileRole(profile.role)) return false;
  if (profile.role === "user" && !profile.linkedEmployeeName) return false;
  return true;
}

export function normalizeAdminUserPayload(input: unknown, options: NormalizeOptions = {}): NormalizeResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid user payload." };
  const source = input as Record<string, unknown>;
  const role = parseProfileRole(source.role);
  if (!role) return { ok: false, error: "Choose a valid role." };

  const id = normalizeOptionalString(source.id);
  if (options.requireId && !id) return { ok: false, error: "User id is required." };

  const email = normalizeEmail(source.email);
  if (options.requireEmail && !email) return { ok: false, error: "Enter a valid email address." };

  const allowedDepartments = options.departments ?? SCORECARD_DEPARTMENTS;
  const allowedLocations = options.locations ?? SCORECARD_LOCATIONS;
  const allDepartments = source.allDepartments === true;
  const allLocations = source.allLocations === true;
  const departments = uniqueAllowedStrings(source.departments, allowedDepartments);
  const locations = uniqueAllowedStrings(source.locations, allowedLocations);
  const linkedEmployeeName = normalizeOptionalString(source.linkedEmployeeName);
  const supervisorId = normalizeOptionalString(source.supervisorId);
  const scorecardPeriodType: "monthly" | "quarterly" = source.scorecardPeriodType === "quarterly" ? "quarterly" : "monthly";
  const companyGoalsGrant = source.companyGoalsGrant === true;

  if (role === "admin") {
    return {
      ok: true,
      value: { id, email, role, departments: [], locations: [], allDepartments: true, allLocations: true, linkedEmployeeName, scorecardPeriodType }
    };
  }

  if (role === "user") {
    if (!linkedEmployeeName) return { ok: false, error: "Choose the employee this viewer can access." };
    return {
      ok: true,
      value: { id, email, role, departments: [], locations: [], linkedEmployeeName, allDepartments: true, allLocations: true, scorecardPeriodType, companyGoalsGrant }
    };
  }

  if (!allDepartments && departments.length === 0) {
    return { ok: false, error: "Choose at least one department or select all departments." };
  }
  if (!allLocations && locations.length === 0) {
    return { ok: false, error: "Choose at least one location or select all locations." };
  }

  return {
    ok: true,
    value: {
      id,
      email,
      role,
      departments: allDepartments ? [] : departments,
      locations: allLocations ? [] : locations,
      linkedEmployeeName,
      supervisorId: supervisorId || undefined,
      scorecardPeriodType,
      companyGoalsGrant,
      allDepartments,
      allLocations
    }
  };
}

export function adminProfileToRow(userId: string, payload: AdminUserPayload) {
  return {
    id: userId,
    role: payload.role,
    departments: payload.departments,
    locations: payload.locations,
    linked_employee_name: payload.linkedEmployeeName || null,
    title_override: payload.titleOverride || null,
    supervisor_id: payload.supervisorId || null,
    scorecard_period_type: payload.scorecardPeriodType || "monthly",
    company_goals_grant: payload.companyGoalsGrant === true
  };
}

export function scopeSummary(profile: Pick<ManagerProfile, "role" | "departments" | "locations" | "linkedEmployeeName" | "companyGoalsGrant">) {
  const companyGoals = profile.role !== "admin" && profile.companyGoalsGrant ? " · company goals" : "";
  if (profile.role === "admin") return "Full access";
  if (profile.role === "user") return (profile.linkedEmployeeName ? `Viewer for ${profile.linkedEmployeeName}` : "Viewer not linked") + companyGoals;
  const departments = profile.departments.length ? profile.departments.join(", ") : "all departments";
  const locations = profile.locations.length ? profile.locations.join(", ") : "all locations";
  const linked = profile.linkedEmployeeName ? ` · ${profile.linkedEmployeeName}'s team` : "";
  return `${departments} · ${locations}${linked}${companyGoals}`;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeEmail(value: unknown) {
  const email = normalizeOptionalString(value)?.toLowerCase();
  if (!email) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function uniqueAllowedStrings(value: unknown, allowed: string[]) {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set(allowed);
  const selected = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (allowedSet.has(normalized)) selected.add(normalized);
  }
  return Array.from(selected);
}
