// Cross-department Individual Ratio split.
//
// Production team members sometimes clock into a department other than their home one. Their
// home "Individual Ratio" goal is split by where their production hours actually went: e.g. a
// Senior Design Specialist with 80 hrs in Design and 20 hrs in Preservation on a 30%-weighted
// Individual Ratio gets a 24% Design ratio row and a 6% Preservation ratio row. Non-production
// time (G&A etc.) is ignored for the split — it still counts toward total hours/pay elsewhere.
//
// The home slice keeps the goal's own Goal/Min and actual. Other-department slices use the
// company-wide ratio tier table (same at every location): Goal = the target for the employee's
// seniority tier in that department, Min = that department's Specialist target.
//
// Per-department hours/orders come from pf-dashboard's memberRatios via the Ops Dashboard sync
// (lib/pfDashboardSync.ts), stored in `actuals` under DEPT_SPLIT_TIER — see deptSplitKey.

import type { EditableGoal } from "./score";
import type { ActualsByKey, Goal } from "./types";

export const PRODUCTION_DEPTS = ["Design", "Preservation", "Fulfillment", "Resin"] as const;
export type ProductionDept = (typeof PRODUCTION_DEPTS)[number];

export type RatioTier = "specialist" | "senior" | "master";
export const RATIO_TIERS: RatioTier[] = ["specialist", "senior", "master"];
export const RATIO_TIER_LABELS: Record<RatioTier, string> = { specialist: "Specialist", senior: "Senior", master: "Master" };

// Only departments with a row here can receive a cross-department slice. Defaults mirror
// pf-dashboard's src/lib/ratioTargets.ts (RATIO_TARGETS), its single source of truth.
export type RatioTierTargets = Partial<Record<ProductionDept, Record<RatioTier, number>>>;

export const DEFAULT_RATIO_TIER_TARGETS: RatioTierTargets = {
  Preservation: { specialist: 1.0, senior: 0.8, master: 0.6 },
  Design: { specialist: 2.0, senior: 1.6, master: 1.2 },
  Fulfillment: { specialist: 0.5, senior: 0.4, master: 0.3 },
  Resin: { specialist: 0.6, senior: 0.45, master: 0.3 }
};

export const RATIO_TIER_TARGETS_SETTING_KEY = "ratio_tier_targets";

// Other-department slices below this share of production hours fold back into the home slice.
export const MIN_SPLIT_SHARE = 0.05;

export const DEPT_SPLIT_TIER = "__dept_split__";

// First month ("YYYY-MM") scorecards are split. Earlier months keep their original weights.
export const SPLIT_START_MONTH = "2026-09";

export const SPLIT_NOTE = "Worked in multiple departments. Individual Ratio weight is split by time spent in each.";

// One line summarizing a scorecard's split rows, e.g. "Design 80% (80.0 hrs) · Preservation 20% (20.0 hrs)".
export function splitSummary(goals: { department?: string; split?: { share: number; hours: number } }[]): string | null {
  const rows = goals.filter((g) => g.split);
  if (rows.length === 0) return null;
  return rows.map((g) => `${g.department} ${(g.split!.share * 100).toFixed(0)}% (${g.split!.hours.toFixed(1)} hrs)`).join(" · ");
}

export function parseRatioTierTargets(raw: string | null | undefined): RatioTierTargets {
  if (!raw) return DEFAULT_RATIO_TIER_TARGETS;
  try {
    const parsed = JSON.parse(raw) as RatioTierTargets;
    const result: RatioTierTargets = {};
    for (const dept of PRODUCTION_DEPTS) {
      const row = parsed[dept];
      if (!row) continue;
      if (RATIO_TIERS.every((t) => typeof row[t] === "number" && row[t] > 0)) result[dept] = row;
    }
    return Object.keys(result).length > 0 ? result : DEFAULT_RATIO_TIER_TARGETS;
  } catch {
    return DEFAULT_RATIO_TIER_TARGETS;
  }
}

// Seniority from a Rippling title. Team Managers use Master targets; Leads use Senior.
export function ratioTierForRole(role: string): RatioTier {
  if (/\b(master|manager)\b/i.test(role)) return "master";
  if (/\b(senior|lead)\b/i.test(role)) return "senior";
  return "specialist";
}

// Storage key (actuals table, per period) for one employee's hours or orders in one department.
// The row itself is { goal_tier: DEPT_SPLIT_TIER, location: null, department, goal_name: `${metric}::${name}` }.
export function deptSplitGoalName(metric: "hours" | "orders", employeeName: string) {
  return `${metric}::${employeeName.trim()}`;
}

export function deptSplitKey(metric: "hours" | "orders", dept: string, employeeName: string) {
  return [DEPT_SPLIT_TIER, "", dept, deptSplitGoalName(metric, employeeName)].join("|");
}

const RATIO_RE = /ratio/i;
const DEPT_MENTION_RE = /\b(Design|Preservation|Fulfillment|Resin)\b/i;

function mentionedDept(name: string): ProductionDept | null {
  const m = name.match(DEPT_MENTION_RE);
  return m ? ((m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as ProductionDept) : null;
}

function isProductionDept(dept: string | undefined): dept is ProductionDept {
  return !!dept && (PRODUCTION_DEPTS as readonly string[]).includes(dept);
}

// An individual ratio goal for the goal's own production department ("Individual Ratio",
// "Individual Ratio Design" on a Design goal, …) — the one that gets split by hours.
export function isHomeIndividualRatioGoal(goal: Pick<Goal, "goalTier" | "name" | "department">): boolean {
  if (goal.goalTier !== "individual" || !RATIO_RE.test(goal.name) || !isProductionDept(goal.department)) return false;
  const dept = mentionedDept(goal.name);
  return !dept || dept === goal.department;
}

// A manually-added individual ratio goal for a *different* department than the goal's own
// ("Ratio- Preservation" filed under Fulfillment). Superseded by the automatic split.
export function isManualCrossDeptRatioGoal(goal: Pick<Goal, "goalTier" | "name" | "department">): boolean {
  if (goal.goalTier !== "individual" || !RATIO_RE.test(goal.name) || !isProductionDept(goal.department)) return false;
  const dept = mentionedDept(goal.name);
  return !!dept && dept !== goal.department;
}

export type DeptHours = Partial<Record<ProductionDept, { hours: number; orders: number }>>;

export function readDeptHours(actuals: ActualsByKey, employeeName: string): DeptHours {
  const result: DeptHours = {};
  for (const dept of PRODUCTION_DEPTS) {
    const hours = actuals[deptSplitKey("hours", dept, employeeName)];
    if (hours == null || hours <= 0) continue;
    const orders = actuals[deptSplitKey("orders", dept, employeeName)];
    result[dept] = { hours, orders: orders ?? 0 };
  }
  return result;
}

export type RatioSlice = {
  dept: ProductionDept;
  share: number;   // share of weight-eligible production hours (after folding)
  hours: number;
  weight: number;
  target: number;
  min: number;
  actual: number | null;
  isHome: boolean;
};

// Splits one home ratio goal's weight across the departments the employee produced in.
// Returns null when there's nothing to split (no hours data, or all eligible time was home).
export function splitRatioWeight(input: {
  homeDept: ProductionDept;
  role: string;
  weight: number;
  deptHours: DeptHours;
  tierTargets: RatioTierTargets;
  skipDepts?: ReadonlySet<string>; // departments already covered by another goal — fold into home
}): RatioSlice[] | null {
  const { homeDept, role, weight, deptHours, tierTargets, skipDepts } = input;
  const totalHours = PRODUCTION_DEPTS.reduce((sum, d) => sum + (deptHours[d]?.hours ?? 0), 0);
  if (totalHours <= 0) return null;

  const tier = ratioTierForRole(role);
  const others: RatioSlice[] = [];
  for (const dept of PRODUCTION_DEPTS) {
    if (dept === homeDept || skipDepts?.has(dept)) continue;
    const data = deptHours[dept];
    const targets = tierTargets[dept];
    if (!data || !targets) continue;
    const share = data.hours / totalHours;
    if (share < MIN_SPLIT_SHARE) continue;
    others.push({
      dept,
      share,
      hours: data.hours,
      weight: Math.round(weight * share * 100) / 100,
      target: targets[tier],
      min: targets.specialist,
      actual: data.orders > 0 ? data.hours / data.orders : null,
      isHome: false
    });
  }
  if (others.length === 0) return null;

  // Home absorbs its own share plus every folded-back slice; computed as the remainder so the
  // slices always add back up to exactly the original weight.
  const otherWeight = others.reduce((sum, s) => sum + s.weight, 0);
  const otherShare = others.reduce((sum, s) => sum + s.share, 0);
  const home: RatioSlice = {
    dept: homeDept,
    share: 1 - otherShare,
    hours: deptHours[homeDept]?.hours ?? 0,
    weight: Math.round((weight - otherWeight) * 100) / 100,
    target: 0,
    min: 0,
    actual: null,
    isHome: true
  };
  return [home, ...others];
}

export function sliceGoalName(goalName: string, dept: string) {
  return `${goalName.trim()} — ${dept}`;
}

// Expands each home Individual Ratio goal on a live scorecard into per-department rows.
// Goals that aren't home ratio goals, or employees with no cross-department time, pass through
// unchanged. Only applies to monthly scorecards — hours data is stored per month — from
// SPLIT_START_MONTH on.
export function applyCrossDeptSplit(input: {
  goals: EditableGoal[];
  isoMonth: string;
  role: string;
  deptHours: DeptHours;
  tierTargets: RatioTierTargets;
}): EditableGoal[] {
  const { goals, isoMonth, role, deptHours, tierTargets } = input;
  if (isoMonth < SPLIT_START_MONTH) return goals;
  // A manually-added cross-department ratio goal still on the card (e.g. "Ratio- Preservation")
  // already scores that department — never count the same time twice.
  const manuallyCovered = new Set(goals.filter(isManualCrossDeptRatioGoal).map((g) => mentionedDept(g.name)!));
  return goals.flatMap((goal): EditableGoal[] => {
    if (!isHomeIndividualRatioGoal(goal)) return [goal];
    const slices = splitRatioWeight({ homeDept: goal.department as ProductionDept, role, weight: goal.scWeight, deptHours, tierTargets, skipDepts: manuallyCovered });
    if (!slices) return [goal];
    return slices.map((s) => {
      const split = { of: goal.id, share: s.share, hours: s.hours, isHome: s.isHome };
      if (s.isHome) return { ...goal, split, scWeight: s.weight };
      return {
        ...goal,
        split,
        id: `${goal.id}::${s.dept}`,
        name: sliceGoalName(goal.name, s.dept),
        department: s.dept,
        scTarget: s.target,
        scMin: s.min,
        scActual: s.actual,
        scWeight: s.weight
      };
    });
  });
}
