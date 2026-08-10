/**
 * Monthly KPI auto-sync from pf-dashboard into this app's `actuals` table.
 *
 * Triggered by Vercel Cron (see vercel.json → 0 14 3 * * = 8 AM MDT on the 3rd
 * of each month, a few days after month-close so payroll/production data has
 * time to land in pf-dashboard). Vercel automatically adds
 * `Authorization: Bearer $CRON_SECRET` to the request.
 *
 * Can also be triggered manually — by an admin from the Scorecards UI (bearer
 * = their Supabase session token) or with `?month=2026-06` to backfill/re-run
 * a specific past month.
 *
 * Fill-only-if-empty: this route never overwrites a cell that already has a
 * value, whether that value came from a manager typing it in or from a prior
 * run of this same sync. If a cell already has a value that disagrees with
 * what pf-dashboard now computes (e.g. because pf-dashboard's numbers were
 * corrected after the manual entry was made), it's surfaced in
 * `reviewRecommended` instead of being silently overwritten or silently
 * ignored — so a human can decide whether to update it.
 *
 * Required env vars:
 *   CRON_SECRET             — this app's own Vercel cron secret
 *   SCORECARDS_SYNC_SECRET  — shared secret, must match pf-dashboard's env
 *   PF_DASHBOARD_API_URL    — pf-dashboard's deployed base URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { goalFromRow } from "@/lib/supabase";
import { computePfDashboardSync } from "@/lib/pfDashboardSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A computed value counts as "matching" an existing manual value within this
// tolerance — small differences are just rounding from how the number was
// originally typed in.
const MATCH_TOLERANCE_PCT = 0.5;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Server not configured.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : "";
}

// Vercel Cron sends CRON_SECRET; the "Sync from Ops Dashboard" button in the
// UI sends the signed-in user's Supabase session token instead — either is
// accepted, but a session token must belong to an admin.
async function authorizeCaller(request: NextRequest, sb: SupabaseClient): Promise<NextResponse | null> {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return null;

  const userResult = await sb.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }
  const profileResult = await sb.from("manager_profiles").select("role").eq("id", userResult.data.user.id).maybeSingle();
  if (profileResult.error || profileResult.data?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
}

// Last fully-completed calendar month, as "YYYY-MM", relative to now.
function lastCompletedMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  let sb: SupabaseClient;
  try {
    sb = serviceClient();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  const authError = await authorizeCaller(request, sb);
  if (authError) return authError;

  const baseUrl = process.env.PF_DASHBOARD_API_URL;
  const syncSecret = process.env.SCORECARDS_SYNC_SECRET;
  if (!baseUrl || !syncSecret) {
    return NextResponse.json({ error: "PF_DASHBOARD_API_URL or SCORECARDS_SYNC_SECRET not set" }, { status: 500 });
  }

  const targetMonth = request.nextUrl.searchParams.get("month") ?? lastCompletedMonth();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    return NextResponse.json({ error: 'Invalid "month" — expected "YYYY-MM"' }, { status: 400 });
  }

  const audit = request.nextUrl.searchParams.get("audit") === "1";

  try {
    const { data: goalRows, error: goalsError } = await sb.from("goals_bank").select("*").eq("active", true);
    if (goalsError) throw goalsError;
    const goals = (goalRows ?? []).map(goalFromRow);

    // Roster for the target month — needed to resolve role-templated individual goals
    // (no employeeName on the goal row) to the specific people who currently hold that
    // role/department/location, same as the app's own scorecard-rendering logic.
    const { data: rosterRows, error: rosterError } = await sb
      .from("rippling_employees")
      .select("full_name,role,department,location")
      .eq("period", targetMonth);
    if (rosterError) throw rosterError;
    const roster = (rosterRows ?? []).map((r) => ({
      name: r.full_name,
      role: r.role ?? "",
      department: r.department ?? "",
      location: r.location ?? "",
    }));

    const { period, considered, writes } = await computePfDashboardSync({
      targetMonth,
      baseUrl,
      syncSecret,
      goals,
      roster,
    });

    // Multiple goals_bank rows can share the same (tier, location, department,
    // name) — e.g. duplicate goals entered twice by mistake. They'd all write
    // the identical value anyway, so dedupe by conflict-target key up front: a
    // single upsert() batch can't affect the same row twice, and it keeps the
    // synced/skipped counts meaningful (per unique cell, not per raw goal row).
    const keyOf = (w: { goalTier: string; location: string; department: string; goalName: string }) =>
      [w.goalTier, w.location, w.department, w.goalName].join("|");
    const uniqueWrites = Array.from(new Map(writes.map((w) => [keyOf(w), w])).values());

    // Existing actuals for this period, regardless of value — used both for
    // fill-only-if-empty (normal mode) and for the manual-vs-computed diff
    // (audit mode, and the "review recommended" list in normal mode).
    const { data: existingRows, error: existingError } = await sb
      .from("actuals")
      .select("goal_tier,location,department,goal_name,actual_value")
      .eq("period", period);
    if (existingError) throw existingError;

    const existingByKey = new Map(
      (existingRows ?? [])
        .filter((r) => r.goal_tier !== "__meta__")
        .map((r) => [[r.goal_tier, r.location || "", r.department || "", r.goal_name].join("|"), r.actual_value])
    );

    // A percentage difference is undefined when manual is exactly 0 — except the special case
    // where computed is also exactly 0, which is a genuine exact match (e.g. a flex-department
    // goal correctly resolving to "no work there this period" on both sides), not a null/unknown.
    const diffPct = (computed: number, manual: number) => {
      if (manual === 0) return computed === 0 ? 0 : null;
      return Math.round((Math.abs(computed - manual) / manual) * 10000) / 100;
    };

    // Already-submitted scorecards whose frozen goal.actual no longer matches what Ops
    // Dashboard now computes — e.g. submitted before a mapping fix landed, or before a
    // correction was pushed into the actuals table. A submitted scorecard renders from this
    // frozen snapshot, never from the live actuals table, so a corrected value sitting in
    // actuals has zero visible effect here until the scorecard is explicitly reopened.
    //
    // Scoped to `pending_review` only — approved (or legacy no-reviewer "submitted") scorecards
    // are treated as final/already paid out, so they're deliberately left out of this automatic
    // check. An admin can still reopen one of those by hand from its own card if truly needed.
    const { data: pendingScorecardRows, error: pendingError } = await sb
      .from("scorecards")
      .select("id,employee_name,goals")
      .eq("scorecard_month", period)
      .eq("review_status", "pending_review");
    if (pendingError) throw pendingError;

    interface PendingScorecardGoal { name: string; goalTier: string; location?: string; department?: string; actual: number | null; }
    const pendingScorecards = (pendingScorecardRows ?? []) as {
      id: string; employee_name: string; goals: PendingScorecardGoal[];
    }[];

    const submittedMismatches = uniqueWrites.flatMap((w) => {
      if (w.goalTier === "individual") {
        // personalActualKey embeds the specific employee as "<goal name>::<employee name>".
        const sepIdx = w.goalName.lastIndexOf("::");
        if (sepIdx === -1) return [];
        const plainName = w.goalName.slice(0, sepIdx);
        const employeeName = w.goalName.slice(sepIdx + 2);
        const sc = pendingScorecards.find((s) => s.employee_name === employeeName);
        const g = sc?.goals.find((gg) => gg.name === plainName && gg.goalTier === "individual");
        if (!sc || !g || g.actual === null || g.actual === undefined) return [];
        const pct = diffPct(w.value, g.actual);
        if (pct !== null && pct < MATCH_TOLERANCE_PCT) return [];
        return [{
          scorecardId: sc.id, employeeName,
          goalTier: w.goalTier, location: w.location, department: w.department, goalName: w.goalName,
          frozenValue: g.actual, computedValue: w.value, diffPct: pct,
        }];
      }
      // Department/company tier: shared across everyone that goal appears on — check every
      // pending scorecard's snapshot for a matching goal, not just one.
      return pendingScorecards.flatMap((sc) => {
        const g = sc.goals.find(
          (gg) => gg.name === w.goalName && gg.goalTier === w.goalTier &&
            (gg.department || "") === w.department && (gg.location || "") === w.location
        );
        if (!g || g.actual === null || g.actual === undefined) return [];
        const pct = diffPct(w.value, g.actual);
        if (pct !== null && pct < MATCH_TOLERANCE_PCT) return [];
        return [{
          scorecardId: sc.id, employeeName: sc.employee_name,
          goalTier: w.goalTier, location: w.location, department: w.department, goalName: w.goalName,
          frozenValue: g.actual, computedValue: w.value, diffPct: pct,
        }];
      });
    });

    if (audit) {
      // Every goal we know how to map, compared against whatever's already in
      // the cell (manual entry, prior sync, or nothing) — no writes happen.
      const comparisons = uniqueWrites
        .map((w) => {
          const manualValue = existingByKey.get(keyOf(w));
          const hasManual = manualValue !== undefined && manualValue !== null;
          const pct = hasManual ? diffPct(w.value, manualValue) : null;
          return {
            goalTier: w.goalTier,
            location: w.location,
            department: w.department,
            goalName: w.goalName,
            computedValue: w.value,
            manualValue: hasManual ? manualValue : null,
            match: hasManual ? pct !== null && pct < MATCH_TOLERANCE_PCT : null,
            diffPct: pct,
          };
        })
        .sort((a, b) => (a.match === b.match ? 0 : a.match ? 1 : -1)); // mismatches first

      // Existing non-meta actuals in our covered departments that we could NOT
      // compute a value for at all — worth a look, since it's either a naming
      // pattern the mapping missed or something intentionally left manual.
      const coveredDepts = new Set(["Design", "Preservation", "Fulfillment", "Resin", "Operations"]);
      const mappedKeys = new Set(uniqueWrites.map(keyOf));
      const unmatchedManualEntries = (existingRows ?? [])
        .filter(
          (r) =>
            r.goal_tier !== "__meta__" &&
            r.actual_value !== null &&
            coveredDepts.has(r.department || "") &&
            !mappedKeys.has([r.goal_tier, r.location || "", r.department || "", r.goal_name].join("|"))
        )
        .map((r) => ({ goalTier: r.goal_tier, location: r.location, department: r.department, goalName: r.goal_name, manualValue: r.actual_value }));

      return NextResponse.json({
        period,
        considered,
        mapped: uniqueWrites.length,
        comparisons,
        unmatchedManualEntries,
        submittedMismatches,
      });
    }

    const filled = new Set(
      Array.from(existingByKey.entries()).filter(([, v]) => v !== null).map(([k]) => k)
    );

    const toWrite = uniqueWrites.filter((w) => !filled.has(keyOf(w)));

    // Cells that already had a value we're leaving alone (fill-only-if-empty),
    // but where pf-dashboard now computes something meaningfully different —
    // surfaced so a human can double-check rather than silently trusting a
    // manual entry that might be stale.
    const reviewRecommended = uniqueWrites
      .filter((w) => filled.has(keyOf(w)))
      .map((w) => {
        const manualValue = existingByKey.get(keyOf(w))!;
        return {
          goalTier: w.goalTier,
          location: w.location,
          department: w.department,
          goalName: w.goalName,
          manualValue,
          computedValue: w.value,
          diffPct: diffPct(w.value, manualValue),
        };
      })
      .filter((r) => r.diffPct === null || r.diffPct >= MATCH_TOLERANCE_PCT);

    if (toWrite.length > 0) {
      const { error: upsertError } = await sb.from("actuals").upsert(
        toWrite.map((w) => ({
          period: w.period,
          goal_tier: w.goalTier,
          location: w.location || null,
          department: w.department || null,
          goal_name: w.goalName,
          actual_value: w.value,
        })),
        { onConflict: "period,goal_tier,location,department,goal_name" }
      );
      if (upsertError) throw upsertError;
    }

    return NextResponse.json({
      period,
      considered,
      synced: toWrite,
      skippedExisting: uniqueWrites.length - toWrite.length,
      unmapped: considered - writes.length,
      reviewRecommended,
      submittedMismatches,
    });
  } catch (e) {
    console.error("sync-pf-kpis error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
