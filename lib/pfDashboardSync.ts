// Maps pf-dashboard's computed monthly KPIs onto this app's `actuals` table so
// managers don't have to hand-type numbers that already exist upstream.
//
// Scope is deliberately narrow: only goals in departments pf-dashboard actually
// computes (Design, Preservation, Fulfillment, Resin, or the Georgia/Utah
// "Operations" rollup bucket) whose name is ratio/CPO-shaped. Anything else is
// left completely alone — see the mapping table in the implementation plan for
// the full rationale, including the two cases intentionally left unmapped
// ("Team Ratio Attainment" for Resin, and any goal outside the patterns below).
//
// Alongside the achieved-value sync above, this also fills in the *target*
// numbers (Goal/Min) for the current and next calendar month, for the same
// CPO- and production-shaped goals, from pf-dashboard's own forward-looking
// "goal"/"expected" projections (`estimated.current`/`estimated.next`). Ratio
// goals are intentionally excluded from this half — pf-dashboard's ratio
// targets aren't part of this request, only CPO and the two named
// production goals ("Monthly Frame Goal", "Frames Sealed").

import { actualKey, personalActualKey } from "./scorecardCompletion";
import { formatMonthLabel, currentMonthValue, nextMonthValue } from "./periods";
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

// Shape shared by a plain KPI window (utah/georgia/combined "actual" figures)
// and by any of pf-dashboard's forward-looking "estimate/expected/goal"
// variants — both are just a location-keyed bucket of PfPeriodKpis.
interface PfRatioVariant {
  utah: PfPeriodKpis;
  georgia: PfPeriodKpis;
  combined: PfPeriodKpis;
}

interface PfWindowResult extends PfRatioVariant {
  periodStart: string; // "YYYY-MM-DD"
}

// pf-dashboard's forward-looking projection for "this calendar month" or "next
// calendar month" — same estimate/expected/goal trio as historical windows'
// `planned`, just computed from schedule + role-tier targets instead of
// trailing actuals, since these months haven't happened (or finished) yet.
interface PfEstimatedMonthResult {
  estimate: PfRatioVariant;
  expected: PfRatioVariant;
  goal: PfRatioVariant;
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
  // Set only for Goal/Min writes (goalTier "__meta__"), whose goalName is an
  // opaque metaKey string — these carry the human-readable goal/location/
  // department so the review-banner UI doesn't have to decode the key.
  displayLocation?: string;
  displayDepartment?: string;
  displayGoalName?: string;
  variant?: "goal" | "min";
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

function pickLocation(variant: PfRatioVariant, location: string): PfPeriodKpis {
  if (location === "Utah") return variant.utah;
  if (location === "Georgia") return variant.georgia;
  return variant.combined;
}

// Storage key for a goal's per-period Goal/Min override — mirrors the identical
// helper duplicated in app/ScorecardsApp.tsx and app/api/cron/daily-todos/route.ts.
function metaKey(type: "target" | "min", goal: Pick<Goal, "goalTier" | "location" | "department" | "name" | "role" | "employeeName">) {
  return `__${type}__${actualKey(goal)}`;
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

type TierResolution = { value: number; kind: "ratio" | "cpo" | "production" };

function wrap(value: number | null, kind: TierResolution["kind"]): TierResolution | null {
  return value == null ? null : { value, kind };
}

function resolveDepartmentValue(goal: Goal, variant: PfRatioVariant): TierResolution | null {
  const dept = goal.department || "";
  const name = goal.name;
  const period = pickLocation(variant, goal.location || "");

  if (PF_DEPTS.has(dept)) {
    const metrics = period[DEPT_KEY[dept]];
    // Production-count goals — verified against live June actuals: Georgia
    // Design production (317) matched both "Monthly Frame Goal" and
    // "Frames Completed"; Georgia Fulfillment production (261) matched both
    // "Frames Sealed" entries; Utah Design production (488) matched "Monthly
    // Frame Goal". "Boxes Shipped" (Utah/Fulfillment) follows the same
    // Fulfillment-production pattern by analogy — no manual June value existed
    // yet to cross-check it directly.
    if (dept === "Design" && name.trim() === "Monthly Frame Goal") return wrap(metrics.production, "production");
    if (dept === "Fulfillment" && /frames sealed|boxes shipped/i.test(name)) return wrap(metrics.production, "production");
    if (dept === "Resin") {
      // The only ratio-named goal actually filed under department=Resin today
      // is "Team Ratio Attainment", intentionally left unmapped pending
      // clarification of what it measures relative to "Resin Ratio
      // Attainment" (which lives under department=Operations — see below).
      if (CPO_RE.test(name)) return wrap(metrics.cpo, "cpo");
      return null;
    }
    if (RATIO_RE.test(name)) return wrap(metrics.ratio, "ratio");
    if (CPO_RE.test(name)) return wrap(metrics.cpo, "cpo");
    return null;
  }

  if (dept === "Operations") {
    const suffixMatch = name.match(/-\s*(Design|Fulfillment|Preservation|Resin)\s*$/i);
    if (suffixMatch) {
      const subDept = suffixMatch[1][0].toUpperCase() + suffixMatch[1].slice(1).toLowerCase();
      const metrics = period[DEPT_KEY[subDept]];
      if (RATIO_RE.test(name)) return wrap(metrics.ratio, "ratio");
      if (CPO_RE.test(name)) return wrap(metrics.cpo, "cpo");
      return null;
    }
    // Unsuffixed "Frames Completed"/"Frames Sealed" under the Operations
    // rollup are Design's and Fulfillment's own production counts,
    // respectively — confirmed exact-match against live June actuals (see
    // above).
    if (name.trim() === "Frames Completed") return wrap(period.design.production, "production");
    if (/frames sealed/i.test(name)) return wrap(period.fulfillment.production, "production");
    // "- GM" is the GM's own scorecard slice of the location-wide CPO — the
    // same standard (Excl. GM) figure as Utah's unsuffixed goal below, not the
    // Incl.-GM number. "Incl. GM" on the dashboard is an internal-awareness
    // view only, never what a goal actual should hold (confirmed with the user).
    if (/cost per order\s*-\s*gm/i.test(name)) return wrap(period.combined.cpo, "cpo");
    // Utah's Operations bucket doesn't split into per-sub-department goals the
    // way Georgia's does — its plain, unsuffixed ratio/CPO goal represents the
    // location's own blended figure (confirmed with the user).
    if (goal.location === "Utah" && name.trim() === "Combined Ratio Attainment") return wrap(period.combined.ratio, "ratio");
    if (goal.location === "Utah" && name.trim() === "Cost Per Order") return wrap(period.combined.cpo, "cpo");
    // Georgia also has a plain, unsuffixed "Cost Per Order" goal at the
    // Operations-rollup level — its own blended (Design+Fulfillment+
    // Preservation) figure, same as Utah's above.
    if (goal.location === "Georgia" && name.trim() === "Cost Per Order") return wrap(period.combined.cpo, "cpo");
    // "Resin Ratio Attainment" is filed under the Operations bucket, not
    // department=Resin (confirmed against live goals_bank data).
    if (goal.location === "Utah" && name.trim() === "Resin Ratio Attainment") return wrap(period.resin.ratio, "ratio");
    return null;
  }

  return null;
}

function resolveCompanyValue(goal: Goal, variant: PfRatioVariant): TierResolution | null {
  if (goal.department !== "Operations") return null;
  if (!/Company Ratio attainment/i.test(goal.name)) return null;
  return wrap(pickLocation(variant, goal.location || "").combined.ratio, "ratio");
}

// Company/department tiers only — individual tier is resolved separately, per matching
// employee, since one goal can now produce several distinct writes (see computePfDashboardSync).
function resolveTierValue(goal: Goal, variant: PfRatioVariant): TierResolution | null {
  if (goal.goalTier === "department") return resolveDepartmentValue(goal, variant);
  if (goal.goalTier === "company") return resolveCompanyValue(goal, variant);
  return null;
}

function resolveValue(goal: Goal, window: PfWindowResult): number | null {
  return resolveTierValue(goal, window)?.value ?? null;
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
    fetchPfDashboard(baseUrl, syncSecret, `/api/kpis?windows=${encodeURIComponent("monthly-24,est-current,est-next")}`),
    fetchPfDashboard(
      baseUrl,
      syncSecret,
      `/api/scorecard?location=both&month=${encodeURIComponent(targetMonth)}&months=24`
    ),
  ]);

  const windows: PfWindowResult[] = kpisData.windows ?? [];
  // Absent for a month pf-dashboard has no historical KPI window for yet — a genuinely
  // future month (nothing has happened there to compute an "actual" from). That's expected,
  // not an error: department/company-tier Actuals resolution below is simply skipped for it
  // (individual-tier goals still resolve, since those come from the roster/scorecard fetch
  // below, not this window), and the Goal/Min sync further down is entirely independent of
  // `targetMonth` — it always targets the real current/next calendar month regardless.
  const targetWindow = windows.find((w) => w.periodStart === `${targetMonth}-01`);

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

    const value = targetWindow ? resolveValue(goal, targetWindow) : null;
    if (value === null || value === undefined || Number.isNaN(value)) continue;

    const [goalTier, location, department, goalName] = actualKey(goal).split("|");
    writes.push({ goalId: goal.id, period, goalTier, location, department, goalName, value });
  }

  // ── Goal/Min sync — this month and next month's forward-looking targets ──
  // Only department/company-tier, CPO- or production-shaped goals (ratio goals
  // are out of scope for this — see file header). Sourced from pf-dashboard's
  // own "goal"/"expected" projections for the current and next calendar month,
  // independent of whatever historical `targetMonth` the Actuals half above is
  // backfilling.
  const estimated: { current?: PfEstimatedMonthResult; next?: PfEstimatedMonthResult } = kpisData.estimated ?? {};
  const thisMonth = currentMonthValue();
  const monthBuckets: { period: string; goalVariant?: PfRatioVariant; expectedVariant?: PfRatioVariant }[] = [
    { period: thisMonth, goalVariant: estimated.current?.goal, expectedVariant: estimated.current?.expected },
    { period: nextMonthValue(thisMonth), goalVariant: estimated.next?.goal, expectedVariant: estimated.next?.expected },
  ];

  for (const bucket of monthBuckets) {
    if (!bucket.goalVariant || !bucket.expectedVariant) continue;
    const bucketPeriod = formatMonthLabel(bucket.period);

    for (const goal of goals) {
      if (goal.goalTier !== "department" && goal.goalTier !== "company") continue;

      const goalResult = resolveTierValue(goal, bucket.goalVariant);
      if (!goalResult || goalResult.kind === "ratio") continue;
      const expectedResult = resolveTierValue(goal, bucket.expectedVariant);
      if (!expectedResult) continue;

      const displayLocation = goal.location || "";
      const displayDepartment = goal.department || "";
      const displayGoalName = goal.name;

      writes.push({
        goalId: goal.id, period: bucketPeriod, goalTier: "__meta__", location: "", department: "",
        goalName: metaKey("target", goal), value: goalResult.value,
        displayLocation, displayDepartment, displayGoalName, variant: "goal",
      });
      writes.push({
        goalId: goal.id, period: bucketPeriod, goalTier: "__meta__", location: "", department: "",
        goalName: metaKey("min", goal), value: expectedResult.value,
        displayLocation, displayDepartment, displayGoalName, variant: "min",
      });
    }
  }

  return { period, considered: goals.length, writes };
}
