import type { ActualsByKey, Employee, EmployeeScorecardSettings, Goal, GoalAssignment, Scorecard } from "./types";

export type ScorecardCompletionStatus =
  | "no_scorecard_required" // below MIN_HOURS_FOR_SCORECARD threshold
  | "not_started"           // zero goals attached
  | "in_progress"           // goals attached, weights don't total 100
  | "ready"                 // goals attached, weights total exactly 100, not yet submitted
  | "pending_review"
  | "approved"
  | "returned";

export interface ScorecardCompletion {
  status: ScorecardCompletionStatus;
  goalCount: number;
  totalWeight: number;
  hasUnsetWeights: boolean;
}

// Employees who worked fewer than this many hours in the period don't need a scorecard.
// Mirrors MIN_HOURS_FOR_SCORECARD in app/ScorecardsApp.tsx.
const MIN_HOURS_FOR_SCORECARD = 40;

function goalActiveForMonth(goal: Pick<Goal, "startMonth" | "endMonth">, month: string): boolean {
  if (goal.startMonth && goal.startMonth > month) return false;
  if (goal.endMonth && goal.endMonth <= month) return false;
  return true;
}

export function actualKey(goal: Pick<Goal, "goalTier" | "location" | "department" | "name" | "role" | "employeeName">) {
  const who = goal.employeeName || goal.role;
  const name = who ? `${goal.name}::${who}` : goal.name;
  return [goal.goalTier, goal.location || "", goal.department || "", name].join("|");
}

// Storage key for an individual-tier goal's *actual* value, scoped to one real employee even
// when the goal itself is a role template (goal.employeeName unset). Unlike actualKey (which
// falls back to goal.role and so collapses everyone sharing a role into one cell — correct for
// target/min, which really are shared per tier, but wrong for an actual result, which is always
// personal), this always disambiguates by the specific employee the value belongs to. Target/min
// (metaKey) intentionally keep using actualKey/role — only the achieved number needs this.
export function personalActualKey(
  goal: Pick<Goal, "goalTier" | "location" | "department" | "name" | "role" | "employeeName">,
  employeeName: string
) {
  if (goal.goalTier !== "individual") return actualKey(goal);
  const who = goal.employeeName || employeeName;
  return [goal.goalTier, goal.location || "", goal.department || "", `${goal.name}::${who}`].join("|");
}

// Mirrors ScorecardsScreen's goalsForEmployee (app/ScorecardsApp.tsx) — the base set of goals
// a manager sees auto-attached to an employee's scorecard, before per-employee settings
// (excluded/added goals) are applied.
export function resolveBaseGoalsForEmployee(
  employee: Employee,
  allGoals: Goal[],
  goalAssignments: GoalAssignment[],
  actuals: ActualsByKey,
  month: string
): Goal[] {
  const regularGoals = allGoals.filter((goal) => {
    if (actuals["__monthly_inactive__" + actualKey(goal)]) return false;
    if (month && !goalActiveForMonth(goal, month)) return false;
    if (goal.goalTier === "company") return false;
    if (goal.goalTier === "department") return goal.department === employee.department && (!goal.location || goal.location === employee.location);
    return goal.role === employee.role && goal.department === employee.department && (!goal.location || goal.location === employee.location);
  });

  // Company goals individually assigned to this employee that are active for this month.
  const assignedCompanyGoalIds = new Set<string>();
  const assignedCompanyGoals = goalAssignments
    .filter((a) => a.employeeName === employee.name && goalActiveForMonth({ startMonth: a.startMonth, endMonth: a.endMonth }, month))
    .map((a) => allGoals.find((g) => g.id === a.goalId))
    .filter((g): g is Goal => !!g && g.goalTier === "company" && goalActiveForMonth(g, month))
    .filter((g) => (assignedCompanyGoalIds.has(g.id) ? false : (assignedCompanyGoalIds.add(g.id), true)));

  const alreadyIncluded = new Set(regularGoals.map((g) => g.id));
  const extraGoals = assignedCompanyGoals.filter((g) => !alreadyIncluded.has(g.id));

  return [...regularGoals, ...extraGoals];
}

function baseIdsForPeriod(baseGoals: Goal[], periodType: "monthly" | "quarterly"): string[] {
  return baseGoals
    .filter((g) => (periodType === "quarterly" ? g.periodType === "quarterly" : g.periodType !== "quarterly"))
    .map((g) => g.id);
}

function computeGoalIds(
  baseGoals: Goal[],
  allGoals: Goal[],
  periodType: "monthly" | "quarterly",
  settings: EmployeeScorecardSettings | undefined
): string[] {
  const base = baseIdsForPeriod(baseGoals, periodType);
  if (!settings) return base;
  const excluded = new Set(settings.excludedGoalIds);
  const kept = base.filter((id) => !excluded.has(id));
  const extras = settings.addedGoalIds.filter((id) => !base.includes(id) && allGoals.some((g) => g.id === id));
  return [...kept, ...extras];
}

// Read-only counterpart to LiveScorecardCard's live weight math (app/ScorecardsApp.tsx) — computes
// the same goal set and weight total a manager would see opening that employee's scorecard, without
// mounting the live-editing component. Used by the Team Scorecards "Progress" rollup view.
export function computeScorecardCompletion(input: {
  employee: Employee;
  isoMonth: string;
  periodType: "monthly" | "quarterly";
  allGoals: Goal[];
  goalAssignments: GoalAssignment[];
  actuals: ActualsByKey;
  employeeScorecardSettings: EmployeeScorecardSettings[];
  submittedScorecard?: Scorecard;
}): ScorecardCompletion {
  const { employee, isoMonth, periodType, allGoals, goalAssignments, actuals, employeeScorecardSettings, submittedScorecard } = input;

  if ((employee.hoursWorked ?? MIN_HOURS_FOR_SCORECARD) < MIN_HOURS_FOR_SCORECARD) {
    return { status: "no_scorecard_required", goalCount: 0, totalWeight: 0, hasUnsetWeights: false };
  }

  const baseGoals = resolveBaseGoalsForEmployee(employee, allGoals, goalAssignments, actuals, isoMonth);
  const settings = employeeScorecardSettings.find((s) => s.employeeName === employee.name && s.periodType === periodType);
  const goalIds = computeGoalIds(baseGoals, allGoals, periodType, settings);
  const weightOverrides = settings?.weightOverrides ?? {};

  const goals = goalIds
    .map((id) => allGoals.find((g) => g.id === id))
    .filter((g): g is Goal => !!g && goalActiveForMonth(g, isoMonth));

  const goalCount = goals.length;
  const hasUnsetWeights = goals.some((g) => (g.weight == null || g.weight === 0) && weightOverrides[g.name] === undefined);
  const totalWeight = Number(goals.reduce((sum, g) => sum + (weightOverrides[g.name] ?? g.weight ?? 0), 0).toFixed(1));

  // A scorecard without a reviewStatus is a legacy/simple submission — treated as done,
  // same as the "Hide completed" check in ScorecardsScreen (sc.reviewStatus === "approved" || !sc.reviewStatus).
  if (submittedScorecard) {
    const status = submittedScorecard.reviewStatus ?? "approved";
    return { status, goalCount, totalWeight, hasUnsetWeights };
  }

  if (goalCount === 0) return { status: "not_started", goalCount, totalWeight, hasUnsetWeights };
  if (hasUnsetWeights || totalWeight !== 100) return { status: "in_progress", goalCount, totalWeight, hasUnsetWeights };
  return { status: "ready", goalCount, totalWeight, hasUnsetWeights };
}
