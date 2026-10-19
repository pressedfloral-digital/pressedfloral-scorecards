// Effective hourly pay: what each team member actually earned per hour once their scorecard
// bonus is added on top of their hourly rate. Built from finalized scorecards, which already
// carry the period's hours, base pay, hourly rate and bonus as they were submitted.
import { scorecardPayrollMonths } from "./score";
import { isFinalizedForHistory } from "./scorecardCompletion";
import { normalizePersonName } from "./managerAssignment";
import type { Employee, PayType, Scorecard } from "./types";

// Only production team members are in the report. Uses the department on each scorecard, so
// someone who moved into or out of production counts only for their production periods.
export const PAY_REPORT_DEPARTMENTS = ["Resin", "Recreation", "Design", "Fulfillment", "Preservation", "Client Care"];
const PAY_REPORT_DEPARTMENT_SET = new Set(PAY_REPORT_DEPARTMENTS.map((d) => d.toLowerCase()));

export function isPayReportDepartment(department: string | undefined) {
  return PAY_REPORT_DEPARTMENT_SET.has((department || "").trim().toLowerCase());
}

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
  hoursFromRippling: boolean;           // the scorecard had no hours saved, so Rippling's are used
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

// The Rippling upload row for a person in an ISO month, used to fill in hours, rate or
// department that older scorecards didn't save.
export type PayrollLookup = (employeeName: string, isoMonth: string) => Pick<Employee, "hoursWorked" | "hourlyRate" | "grossEarnings" | "department"> | undefined;

export type PaySkipReason = "notFinal" | "otherDepartment" | "noHours";
export const PAY_SKIP_LABELS: Record<PaySkipReason, string> = {
  notFinal: "not approved yet",
  otherDepartment: "outside these departments",
  noHours: "no hours on the scorecard or in Rippling",
};

export function resolvePayReportEntry(scorecard: Scorecard, payroll?: PayrollLookup): { entry: PayReportEntry } | { skipped: PaySkipReason } {
  if (!isFinalizedForHistory(scorecard)) return { skipped: "notFinal" };
  const months = scorecardPayrollMonths(scorecard.scorecardMonth);
  const rows = months.map((m) => payroll?.(scorecard.employeeName, m)).filter((r) => !!r);
  const department = (scorecard.department || "").trim() || rows.find((r) => r.department)?.department || "";
  if (!isPayReportDepartment(department)) return { skipped: "otherDepartment" };

  const payrollHours = rows.reduce((s, r) => s + (Number(r.hoursWorked) || 0), 0);
  const savedHours = Number(scorecard.hours) || 0;
  const hours = savedHours > 0 ? savedHours : payrollHours;
  if (!months.length || hours <= 0) return { skipped: "noHours" };

  const savedRate = Number(scorecard.hourlyRate) || 0;
  const payrollRateHours = rows.reduce((s, r) => s + (Number(r.hourlyRate) > 0 ? Number(r.hoursWorked) || 0 : 0), 0);
  const payrollRate = payrollRateHours > 0
    ? rows.reduce((s, r) => s + (Number(r.hourlyRate) > 0 ? Number(r.hourlyRate) * (Number(r.hoursWorked) || 0) : 0), 0) / payrollRateHours
    : 0;
  const payrollGross = rows.reduce((s, r) => s + (Number(r.grossEarnings) || 0), 0);
  const savedBase = Number(scorecard.baseEarnings) || 0;
  const isSalary = scorecard.payType === "salary";
  const baseRate = !isSalary && savedRate > 0 ? savedRate
    : !isSalary && payrollRate > 0 ? payrollRate
    : savedBase > 0 ? savedBase / hours
    : payrollGross > 0 && payrollHours > 0 ? payrollGross / payrollHours
    : 0;
  const bonus = Number(scorecard.bonusAmount) || 0;
  return {
    entry: {
      scorecardId: scorecard.id,
      employeeName: scorecard.employeeName,
      department,
      location: scorecard.location || "",
      payType: scorecard.payType || "hourly",
      period: scorecard.scorecardMonth,
      periodType: scorecard.periodType === "quarterly" ? "quarterly" : "monthly",
      months,
      hours,
      hoursFromRippling: savedHours <= 0,
      baseRate,
      basePay: baseRate * hours,
      bonus,
      bonusPerHour: bonus / hours,
      effectiveRate: baseRate + bonus / hours,
    },
  };
}

export function payReportEntry(scorecard: Scorecard, payroll?: PayrollLookup): PayReportEntry | null {
  const result = resolvePayReportEntry(scorecard, payroll);
  return "entry" in result ? result.entry : null;
}

export function buildPayReport(scorecards: Scorecard[], payroll?: PayrollLookup) {
  const entries: PayReportEntry[] = [];
  const skipped: Record<PaySkipReason, number> = { notFinal: 0, otherDepartment: 0, noHours: 0 };
  for (const scorecard of scorecards) {
    const result = resolvePayReportEntry(scorecard, payroll);
    if ("entry" in result) entries.push(result.entry);
    else skipped[result.skipped] += 1;
  }
  entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.months[0].localeCompare(b.months[0]));
  return { entries, skipped };
}

// Looks people up in the saved Rippling uploads (keyed by ISO month) by name.
export function payrollLookupFromRippling(rippling: Record<string, Employee[]>): PayrollLookup {
  const index = new Map<string, Employee>();
  for (const [month, employees] of Object.entries(rippling)) {
    for (const e of employees || []) index.set(`${month}|${normalizePersonName(e.name)}`, e);
  }
  return (name, month) => index.get(`${month}|${normalizePersonName(name)}`);
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
