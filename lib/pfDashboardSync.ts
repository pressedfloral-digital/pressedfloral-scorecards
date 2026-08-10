// Maps pf-dashboard's computed monthly KPIs onto this app's `actuals` table so
// managers don't have to hand-type numbers that already exist upstream.
//
// Scope is deliberately narrow: only goals in departments pf-dashboard actually
// computes (Design, Preservation, Fulfillment, Resin, or the Georgia/Utah
// "Operations" rollup bucket) whose name is ratio/CPO-shaped. Anything else is
// left completely alone — see the mapping table in the implementation plan for
// the full rationale, including the two cases intentionally left unmapped
// ("Team Ratio Attainment" for Resin, and any goal outside the patterns below).

import { actualKey, personalActualKey } from "./scorecardCompletion";
import { formatMonthLabel } from "./periods";
import type { Goal } from "./types";

// ── Minimal shapes of pf-dashboard's API responses (can't import cross-repo) ───

interface PfKpiMetrics {
  ratio: number | null;
  cpo: number | null;
  cpoWithGM: number | null;
  production: number;
}

interface PfPeriodKpis {
  design: PfKpiMetrics;
  preservation: PfKpiMetrics;
  fulfillment: PfKpiMetrics;
  resin: PfKpiMetrics;
  ga: PfKpiMetrics;
  combined: PfKpiMetrics;
}

interface PfWindowResult {
  periodStart: string; // "YYYY-MM-DD"
  utah: PfPeriodKpis;
  georgia: PfPeriodKpis;
  combined: PfPeriodKpis;
}

interface PfMemberRatio {
  name: string;
  department: string;
  ratio: number | null;
}

interface PfScorecardMonthData {
  memberRatios: PfMemberRatio[];
}

// A role-templated individual goal (goal.employeeName unset) applies to whoever currently
// holds that role/department/location — same roster this app's own UI uses to decide who
// sees the goal on their scorecard (see isGoalApplicable / resolveBaseGoalsForEmployee).
export interface PfRosterEmployee {
  name: string;
  role: string;
  department: string;
  location: string;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface PfSyncWrite {
  goalId: string;
  period: string;
  goalTier: string;
  location: string;
  department: string;
  goalName: string;
  value: number;
}

export interface PfSyncResult {
  period: string;
  considered: number;
  writes: PfSyncWrite[];
}

// ── Department bucket helpers ───────────────────────────────────────────────

const PF_DEPTS = new Set(["Design", "Preservation", "Fulfillment", "Resin"]);

const DEPT_KEY: Record<string, keyof PfPeriodKpis> = {
  Design: "design",
  Preservation: "preservation",
  Fulfillment: "fulfillment",
  Resin: "resin",
};

const RATIO_RE = /ratio/i;
const CPO_RE = /cost per order|\bcpo\b/i;

function pickLocation(window: PfWindowResult, location: string): PfPeriodKpis {
  if (location === "Utah") return window.utah;
  if (location === "Georgia") return window.georgia;
  return window.combined;
}

// ── Value resolution ─────────────────────────────────────────────────────────

// Which real employees a given individual-tier goal currently applies to. Mirrors the exact
// matching rule the app itself uses (LiveScorecardCard.isGoalApplicable /
// resolveBaseGoalsForEmployee): an employeeName on the goal means it's already scoped to one
// person; otherwise it's a role template and applies to everyone in the roster holding that
// role/department/location right now.
function employeesForIndividualGoal(goal: Goal, roster: PfRosterEmployee[]): string[] {
  if (goal.employeeName) return [goal.employeeName];
  return roster
    .filter(
      (e) =>
        e.department === (goal.department || "") &&
        (!goal.location || e.location === goal.location) &&
        (!goal.role || e.role === goal.role)
    )
    .map((e) => e.name);
}

// Some individual goals track a person's ratio in a *different* department than the goal's own
// department field — e.g. "Ratio- Preservation" filed under department=Fulfillment, for someone
// who occasionally flexes into Preservation. goal.department is where the goal lives on the
// employee's scorecard (used for roster matching above); the name suffix says which department's
// ratio to actually pull. Mirrors the identical suffix pattern already used for the Operations
// department-tier bucket further down.
const FLEX_DEPT_SUFFIX_RE = /-\s*(Design|Preservation|Fulfillment|Resin)\s*$/i;

function individualLookupDept(goal: Goal): { dept: string; isFlex: boolean } {
  const suffixMatch = goal.name.match(FLEX_DEPT_SUFFIX_RE);
  if (suffixMatch) {
    const dept = suffixMatch[1][0].toUpperCase() + suffixMatch[1].slice(1).toLowerCase();
    return { dept, isFlex: true };
  }
  return { dept: goal.department || "", isFlex: false };
}

function resolveIndividualValueForEmployee(
  goal: Goal,
  employeeName: string,
  memberRatiosByLoc: Record<string, PfMemberRatio[]>
): number | null {
  if (!RATIO_RE.test(goal.name)) return null;
  const { dept, isFlex } = individualLookupDept(goal);
  if (!PF_DEPTS.has(dept)) return null;

  const pool = memberRatiosByLoc[goal.location || ""] || [];
  const norm = (s: string) => s.trim().toLowerCase();
  const match = pool.find((m) => norm(m.name) === norm(employeeName) && m.department === dept);
  if (match) return match.ratio ?? (isFlex ? 0 : null);
  // No record at all for this employee in that department this period. For a flex-department
  // goal that reliably means "didn't work there this month" — a real, reportable zero. For a
  // goal's own primary department, absence more likely means missing data, so leave it unmapped
  // instead of asserting a value.
  return isFlex ? 0 : null;
}

function resolveDepartmentValue(goal: Goal, window: PfWindowResult): number | null {
  const dept = goal.department || "";
  const name = goal.name;
  const period = pickLocation(window, goal.location || "");

  if (PF_DEPTS.has(dept)) {
    const metrics = period[DEPT_KEY[dept]];
    // Production-count goals — verified against live June actuals: Georgia
    // Design production (317) matched both "Monthly Frame Goal" and
    // "Frames Completed"; Georgia Fulfillment production (261) matched both
    // "Frames Sealed" entries; Utah Design production (488) matched "Monthly
    // Frame Goal". "Boxes Shipped" (Utah/Fulfillment) follows the same
    // Fulfillment-production pattern by analogy — no manual June value existed
    // yet to cross-check it directly.
    if (dept === "Design" && name.trim() === "Monthly Frame Goal") return metrics.production;
    if (dept === "Fulfillment" && /frames sealed|boxes shipped/i.test(name)) return metrics.production;
    if (dept === "Resin") {
      // The only ratio-named goal actually filed under department=Resin today
      // is "Team Ratio Attainment", intentionally left unmapped pending
      // clarification of what it measures relative to "Resin Ratio
      // Attainment" (which lives under department=Operations — see below).
      if (CPO_RE.test(name)) return metrics.cpo;
      return null;
    }
    if (RATIO_RE.test(name)) return metrics.ratio;
    if (CPO_RE.test(name)) return metrics.cpo;
    return null;
  }

  if (dept === "Operations") {
    const suffixMatch = name.match(/-\s*(Design|Fulfillment|Preservation)\s*$/i);
    if (suffixMatch) {
      const subDept = suffixMatch[1][0].toUpperCase() + suffixMatch[1].slice(1).toLowerCase();
      const metrics = period[DEPT_KEY[subDept]];
      if (RATIO_RE.test(name)) return metrics.ratio;
      if (CPO_RE.test(name)) return metrics.cpo;
      return null;
    }
    // Unsuffixed "Frames Completed"/"Frames Sealed" under the Operations
    // rollup are Design's and Fulfillment's own production counts,
    // respectively — confirmed exact-match against live June actuals (see
    // above).
    if (name.trim() === "Frames Completed") return period.design.production;
    if (/frames sealed/i.test(name)) return period.fulfillment.production;
    // "- GM" is the GM's own scorecard slice of the location-wide CPO — the
    // same standard (Excl. GM) figure as Utah's unsuffixed goal below, not the
    // Incl.-GM number. "Incl. GM" on the dashboard is an internal-awareness
    // view only, never what a goal actual should hold (confirmed with the user).
    if (/cost per order\s*-\s*gm/i.test(name)) return period.combined.cpo;
    // Utah's Operations bucket doesn't split into per-sub-department goals the
    // way Georgia's does — its plain, unsuffixed ratio/CPO goal represents the
    // location's own blended figure (confirmed with the user).
    if (goal.location === "Utah" && name.trim() === "Combined Ratio Attainment") return period.combined.ratio;
    if (goal.location === "Utah" && name.trim() === "Cost Per Order") return period.combined.cpo;
    // "Resin Ratio Attainment" is filed under the Operations bucket, not
    // department=Resin (confirmed against live goals_bank data).
    if (goal.location === "Utah" && name.trim() === "Resin Ratio Attainment") return period.resin.ratio;
    return null;
  }

  return null;
}

function resolveCompanyValue(goal: Goal, window: PfWindowResult): number | null {
  if (goal.department !== "Operations") return null;
  if (!/Company Ratio attainment/i.test(goal.name)) return null;
  return pickLocation(window, goal.location || "").combined.ratio;
}

// Company/department tiers only — individual tier is resolved separately, per matching
// employee, since one goal can now produce several distinct writes (see computePfDashboardSync).
function resolveValue(goal: Goal, window: PfWindowResult): number | null {
  if (goal.goalTier === "department") return resolveDepartmentValue(goal, window);
  if (goal.goalTier === "company") return resolveCompanyValue(goal, window);
  return null;
}

// ── pf-dashboard fetch helpers ──────────────────────────────────────────────

async function fetchPfDashboard(baseUrl: string, syncSecret: string, path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${syncSecret}` },
  });
  if (!res.ok) {
    throw new Error(`pf-dashboard request failed (${res.status}): ${path}`);
  }
  return res.json();
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function computePfDashboardSync(params: {
  targetMonth: string; // "YYYY-MM"
  baseUrl: string;
  syncSecret: string;
  goals: Goal[]; // active goals only
  roster: PfRosterEmployee[]; // this app's rippling_employees for targetMonth
}): Promise<PfSyncResult> {
  const { targetMonth, baseUrl, syncSecret, goals, roster } = params;
  const period = formatMonthLabel(targetMonth);

  const [kpisData, scorecardData] = await Promise.all([
    fetchPfDashboard(baseUrl, syncSecret, `/api/kpis?windows=${encodeURIComponent("monthly-24")}`),
    fetchPfDashboard(
      baseUrl,
      syncSecret,
      `/api/scorecard?location=both&month=${encodeURIComponent(targetMonth)}&months=24`
    ),
  ]);

  const windows: PfWindowResult[] = kpisData.windows ?? [];
  const targetWindow = windows.find((w) => w.periodStart === `${targetMonth}-01`);
  if (!targetWindow) {
    throw new Error(`No pf-dashboard KPI window found for ${targetMonth} — is that month in range?`);
  }

  const byLocation = scorecardData.byLocation ?? {};
  const memberRatiosByLoc: Record<string, PfMemberRatio[]> = {
    Utah: (byLocation.Utah?.[targetMonth] as PfScorecardMonthData | undefined)?.memberRatios ?? [],
    Georgia: (byLocation.Georgia?.[targetMonth] as PfScorecardMonthData | undefined)?.memberRatios ?? [],
  };

  const writes: PfSyncWrite[] = [];

  for (const goal of goals) {
    if (goal.goalTier === "individual") {
      // A role template can apply to several people at once — write each of them their own
      // value under their own key instead of guessing which one person it's "for".
      for (const employeeName of employeesForIndividualGoal(goal, roster)) {
        const value = resolveIndividualValueForEmployee(goal, employeeName, memberRatiosByLoc);
        if (value === null || value === undefined || Number.isNaN(value)) continue;
        const [goalTier, location, department, goalName] = personalActualKey(goal, employeeName).split("|");
        writes.push({ goalId: goal.id, period, goalTier, location, department, goalName, value });
      }
      continue;
    }

    const value = resolveValue(goal, targetWindow);
    if (value === null || value === undefined || Number.isNaN(value)) continue;

    const [goalTier, location, department, goalName] = actualKey(goal).split("|");
    writes.push({ goalId: goal.id, period, goalTier, location, department, goalName, value });
  }

  return { period, considered: goals.length, writes };
}
