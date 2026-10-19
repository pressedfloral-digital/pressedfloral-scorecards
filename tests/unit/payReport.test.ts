import { describe, expect, it } from "vitest";
import { buildPayReport, changePct, entriesForMonth, entriesForYear, payReportEntry, payTotals, reportYears } from "../../lib/payReport";
import type { Scorecard } from "../../lib/types";

function card(overrides: Partial<Scorecard>): Scorecard {
  return {
    id: "sc-1",
    employeeName: "Jamie Rivera",
    role: "Designer",
    department: "Design",
    location: "Utah",
    payType: "hourly",
    hourlyRate: 20,
    hours: 100,
    baseEarnings: 2000,
    bonusPotentialPct: 10,
    scorecardMonth: "May 2026",
    periodType: "monthly",
    weightedAchievement: 100,
    bonusAmount: 200,
    scorecardCapped: false,
    flag120: false,
    goals: [],
    ...overrides,
  };
}

describe("payReportEntry", () => {
  it("adds the bonus per hour worked to the hourly rate", () => {
    const entry = payReportEntry(card({}))!;
    expect(entry.months).toEqual(["2026-05"]);
    expect(entry.bonusPerHour).toBe(2);
    expect(entry.effectiveRate).toBe(22);
  });

  it("uses the hourly rate even when gross earnings include overtime", () => {
    expect(payReportEntry(card({ baseEarnings: 2300 }))!.baseRate).toBe(20);
  });

  it("derives a base rate from earnings for salaried people", () => {
    const entry = payReportEntry(card({ payType: "salary", hourlyRate: undefined, baseEarnings: 5000, hours: 160, bonusAmount: 320 }))!;
    expect(entry.baseRate).toBe(31.25);
    expect(entry.effectiveRate).toBe(33.25);
  });

  it("skips scorecards without hours or still in review", () => {
    expect(payReportEntry(card({ hours: 0 }))).toBeNull();
    expect(payReportEntry(card({ reviewStatus: "pending_review" }))).toBeNull();
    expect(payReportEntry(card({ reviewStatus: "returned" }))).toBeNull();
    expect(payReportEntry(card({ reviewStatus: "approved" }))).not.toBeNull();
  });

  it("only includes production departments", () => {
    expect(payReportEntry(card({ department: "Marketing" }))).toBeNull();
    expect(payReportEntry(card({ department: "General & Administrative" }))).toBeNull();
    expect(payReportEntry(card({ department: "" }))).toBeNull();
    for (const department of ["Resin", "Recreation", "Design", "Fulfillment", "Preservation", "client care"]) {
      expect(payReportEntry(card({ department }))).not.toBeNull();
    }
  });

  it("spreads a quarterly scorecard over its three months", () => {
    const entry = payReportEntry(card({ scorecardMonth: "Q2 2026", periodType: "quarterly" }))!;
    expect(entry.months).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("totals", () => {
  const entries = buildPayReport([
    card({ id: "a", hours: 100, hourlyRate: 20, bonusAmount: 200 }),
    card({ id: "b", scorecardMonth: "June 2026", hours: 50, hourlyRate: 22, bonusAmount: 0 }),
    card({ id: "c", scorecardMonth: "Q4 2025", periodType: "quarterly", hours: 300, hourlyRate: 18, bonusAmount: 300 }),
  ]);

  it("weights the year's rate by hours worked", () => {
    const totals = payTotals(entriesForYear(entries, "2026"));
    expect(totals.hours).toBe(150);
    expect(totals.effectiveRate).toBeCloseTo((2000 + 200 + 1100) / 150);
  });

  it("finds years and month coverage", () => {
    expect(reportYears(entries)).toEqual(["2026", "2025"]);
    expect(entriesForMonth(entries, "2025-11").map((e) => e.scorecardId)).toEqual(["c"]);
  });

  it("returns null totals and change when there are no hours", () => {
    expect(payTotals([]).effectiveRate).toBeNull();
    expect(changePct(22, null)).toBeNull();
    expect(changePct(22, 20)).toBeCloseTo(10);
  });
});
