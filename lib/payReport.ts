// Effective hourly pay: what each team member actually earned per hour once their scorecard
// bonus is added on top of their hourly rate. Built from finalized scorecards, which already
// carry the period's hours, base pay, hourly rate and bonus as they were submitted.
import { scorecardPayrollMonths } from "./score";
import { isFinalizedForHistory } from "./scorecardCompletion";
import type { PayType, Scorecard } from "./types";

export type PayReportEntry = {
  scorecardId: string;
  employeeName: string;
  department: string;
  location: string;
  payType: PayType;
  period: string;                       // scorecard label, e.g. "May 2026" or "Q2 2026"
  periodType: "monthly" | "quarterly";
  months: string[];                     // ISO months the period covers
  hours: number;
  baseRate: number;                     // hourly rate, or base earnings ÷ hours for salaried people
  basePay: number;                      // baseRate × hours
  bonus: number;
  bonusPerHour: number;
  effectiveRate: number;                // baseRate + bonus ÷ hours
};

// Hours-weighted totals over any set of entries (a year, a team, a month across people).
export type PayTotals = {
  hours: number;
  basePay: number;
  bonus: number;
  baseRate: number | null;
  bonusPerHour: number | null;
  effectiveRate: number | null;
  periods: number;
};

export function payReportEntry(scorecard: Scorecard): PayReportEntry | null {
  if (!isFinalizedForHistory(scorecard)) return null;
  const hours = Number(scorecard.hours) || 0;
  if (hours <= 0) return null;
  const months = scorecardPayrollMonths(scorecard.scorecardMonth);
  if (!months.length) return null;
  const rate = Number(scorecard.hourlyRate) || 0;
  const baseRate = scorecard.payType === "hourly" && rate > 0 ? rate : (Number(scorecard.baseEarnings) || 0) / hours;
  const bonus = Number(scorecard.bonusAmount) || 0;
  return {
    scorecardId: scorecard.id,
    employeeName: scorecard.employeeName,
    department: scorecard.department || "",
    location: scorecard.location || "",
    payType: scorecard.payType,
    period: scorecard.scorecardMonth,
    periodType: scorecard.periodType === "quarterly" ? "quarterly" : "monthly",
    months,
    hours,
    baseRate,
    basePay: baseRate * hours,
    bonus,
    bonusPerHour: bonus / hours,
    effectiveRate: baseRate + bonus / hours,
  };
}

export function buildPayReport(scorecards: Scorecard[]): PayReportEntry[] {
  return scorecards
    .map(payReportEntry)
    .filter((e): e is PayReportEntry => e !== null)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.months[0].localeCompare(b.months[0]));
}

export function payTotals(entries: PayReportEntry[]): PayTotals {
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const basePay = entries.reduce((s, e) => s + e.basePay, 0);
  const bonus = entries.reduce((s, e) => s + e.bonus, 0);
  return {
    hours,
    basePay,
    bonus,
    baseRate: hours > 0 ? basePay / hours : null,
    bonusPerHour: hours > 0 ? bonus / hours : null,
    effectiveRate: hours > 0 ? (basePay + bonus) / hours : null,
    periods: entries.length,
  };
}

// Entries covering an ISO month. A quarterly scorecard covers each of its three months, so
// its quarter-wide rate shows in all three.
export function entriesForMonth(entries: PayReportEntry[], isoMonth: string) {
  return entries.filter((e) => e.months.includes(isoMonth));
}

// Entries in a calendar year, each counted once (a quarter belongs to the year it's in).
export function entriesForYear(entries: PayReportEntry[], year: string) {
  return entries.filter((e) => e.months[0].startsWith(`${year}-`));
}

export function reportYears(entries: PayReportEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.months[0].slice(0, 4)))).sort().reverse();
}

export function changePct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
