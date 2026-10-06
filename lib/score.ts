import type { Employee, Goal, PayType, Scorecard, ScorecardGoal } from "./types";

export type EditableGoal = Goal & {
  scTarget: number;
  scMin: number;
  scActual: number | null;
  scWeight: number;
};

export function baseEarnings(input: {
  payType: PayType;
  hourlyRate?: number;
  hours?: number;
  annualPay?: number;
  grossEarnings?: number;
  periodType?: "monthly" | "quarterly";
}) {
  if (input.grossEarnings && input.grossEarnings > 0) return input.grossEarnings;
  if (input.payType === "salary") {
    const divisor = input.periodType === "quarterly" ? 4 : 12;
    return (input.annualPay || 0) / divisor;
  }
  return (input.hourlyRate || 0) * (input.hours || 0);
}

/**
 * Sums an employee's Rippling uploads across a quarter's three months, pricing each month
 * independently by that month's own pay basis (via the monthly baseEarnings rules: actual
 * grossEarnings when reported, otherwise annualPay/12 for salaried months, otherwise
 * hourlyRate × hours). Months cannot share one pay type for the whole quarter — a mid-quarter
 * role change (hourly → salaried or vice versa) means each month's row must speak for itself,
 * and a stray partial gross figure from one month must never override the other months.
 *
 * Hourly months with no reported gross fall back to a rate × hours estimate and are returned
 * in estimatedMonths so callers can flag the quarter total as approximate. Months where the
 * employee has no upload row at all are returned in missingMonths — they contribute nothing,
 * which is correct for a mid-quarter hire but an undercount if the upload simply skipped them,
 * so callers should surface those too.
 */
export function sumQuarterlyEmployee(input: {
  employeeName: string;
  qMonths: string[];
  ripplingByMonth: Record<string, Employee[]>;
}): { quarterlyEarnings?: number; hoursWorked?: number; uploadFound: boolean; estimatedMonths: string[]; missingMonths: string[] } {
  let totalEarnings = 0;
  let totalHours = 0;
  let uploadFound = false;
  const estimatedMonths: string[] = [];
  const missingMonths: string[] = [];
  for (const qm of input.qMonths) {
    const src = (input.ripplingByMonth[qm] || []).find((e) => e.name === input.employeeName);
    if (!src) {
      missingMonths.push(qm);
      continue;
    }
    uploadFound = true;
    totalEarnings += baseEarnings({
      payType: src.payType,
      hourlyRate: src.hourlyRate,
      hours: src.hoursWorked,
      annualPay: src.annualPay,
      grossEarnings: src.grossEarnings,
      periodType: "monthly"
    });
    if (src.hoursWorked) totalHours += src.hoursWorked;
    if (src.payType === "hourly" && !(src.grossEarnings && src.grossEarnings > 0)) estimatedMonths.push(qm);
  }
  return {
    quarterlyEarnings: totalEarnings > 0 ? totalEarnings : undefined,
    hoursWorked: totalHours > 0 ? totalHours : undefined,
    uploadFound,
    estimatedMonths,
    missingMonths
  };
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** ISO months ("2026-09") a scorecard's earnings come from: one for "September 2026", three for "Q3 2026". */
export function scorecardPayrollMonths(scorecardMonth: string): string[] {
  const quarter = scorecardMonth.match(/^Q([1-4]) (\d{4})$/);
  if (quarter) {
    const start = (Number(quarter[1]) - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${quarter[2]}-${String(start + i).padStart(2, "0")}`);
  }
  const monthly = scorecardMonth.match(/^([A-Za-z]+) (\d{4})$/);
  const monthIndex = monthly ? MONTH_NAMES.indexOf(monthly[1].toLowerCase()) : -1;
  return monthIndex === -1 ? [] : [`${monthly![2]}-${String(monthIndex + 1).padStart(2, "0")}`];
}

/**
 * Re-prices an already-submitted scorecard against the current Rippling uploads, keeping its
 * frozen goals/achievement and only swapping in the new pay basis, hours and earnings (and the
 * bonus that follows from them). Lets a late or corrected payroll upload reach scorecards that
 * were submitted before it landed.
 *
 * Returns null when nothing should change: approved scorecards (final — they must be reopened),
 * employees missing from the uploads, or earnings/hours that already match.
 *
 * prorationFactor: pass the employee's last-day proration when known; otherwise it is recovered
 * from the stored bonus/earnings ratio (1 when the old earnings were 0).
 */
export function refreshScorecardEarnings(input: {
  scorecard: Scorecard;
  ripplingByMonth: Record<string, Employee[]>;
  prorationFactor?: number;
}): Scorecard | null {
  const { scorecard } = input;
  if (scorecard.reviewStatus === "approved") return null;
  const months = scorecardPayrollMonths(scorecard.scorecardMonth);
  if (months.length === 0) return null;

  const rows = months
    .map((month) => (input.ripplingByMonth[month] || []).find((e) => e.name === scorecard.employeeName))
    .filter((row): row is Employee => Boolean(row));
  if (rows.length === 0) return null;
  const latest = rows[rows.length - 1];

  let earnings: number;
  let hours: number | undefined;
  if (scorecard.periodType === "quarterly") {
    const summed = sumQuarterlyEmployee({ employeeName: scorecard.employeeName, qMonths: months, ripplingByMonth: input.ripplingByMonth });
    hours = summed.hoursWorked;
    earnings = baseEarnings({
      payType: latest.payType,
      hourlyRate: latest.hourlyRate,
      hours,
      annualPay: latest.annualPay,
      grossEarnings: summed.quarterlyEarnings,
      periodType: "quarterly"
    });
  } else {
    hours = latest.hoursWorked;
    earnings = baseEarnings({
      payType: latest.payType,
      hourlyRate: latest.hourlyRate,
      hours,
      annualPay: latest.annualPay,
      grossEarnings: latest.grossEarnings,
      periodType: "monthly"
    });
  }

  const sameEarnings = Math.abs(earnings - (scorecard.baseEarnings || 0)) < 0.005;
  const sameHours = Math.abs((hours || 0) - (scorecard.hours || 0)) < 0.00005;
  if (sameEarnings && sameHours) return null;

  const pct = scorecard.bonusPotentialPct ?? 10;
  const finalAchievement = Math.min(scorecard.weightedAchievement || 0, 200);
  const bonusFor = (base: number) => base * (finalAchievement / 100) * (pct / 100);
  const oldUnprorated = bonusFor(scorecard.baseEarnings || 0);
  const prorationFactor = input.prorationFactor
    ?? (oldUnprorated > 0 ? Math.min(scorecard.bonusAmount / oldUnprorated, 1) : 1);
  const bonus = bonusFor(earnings);

  return {
    ...scorecard,
    payType: latest.payType,
    hourlyRate: latest.hourlyRate,
    annualPay: latest.annualPay,
    hours,
    baseEarnings: earnings,
    // Match submit: a prorated bonus is stored rounded to cents.
    bonusAmount: prorationFactor < 1 ? Math.round(bonus * prorationFactor * 100) / 100 : bonus,
    goals: scorecard.goals.map((goal) => ({ ...goal, bonusContribution: earnings * (goal.weighted / 100) * (pct / 100) }))
  };
}

export function calculateGoal(input: {
  goal: Pick<Goal, "name" | "goalTier" | "location" | "department" | "role" | "lowerBetter" | "capped" | "capPct">;
  target: number;
  min: number;
  actual: number | null;
  weight: number;
  baseEarnings: number;
  bonusPotentialPct?: number;
}): ScorecardGoal {
  const bonusPotentialPct = input.bonusPotentialPct ?? 10;
  const target = Number(input.target) || 0;
  const min = Number(input.min) || 0;
  const weight = Number(input.weight) || 0;
  const actual = input.actual === null || input.actual === undefined ? null : Number(input.actual);
  const hasActual = actual !== null && !Number.isNaN(actual);
  const metMin = !hasActual
    ? false
    : input.goal.lowerBetter
      ? actual <= min
      : actual >= min;

  let achievement = 0;
  if (hasActual && metMin && target > 0 && actual !== 0) {
    achievement = input.goal.lowerBetter ? (target / actual) * 100 : (actual / target) * 100;
    if (input.goal.capped === "yes") achievement = Math.min(achievement, input.goal.capPct || 100);
  }

  const weighted = (achievement / 100) * weight;
  const bonusContribution = input.baseEarnings * (weighted / 100) * (bonusPotentialPct / 100);

  return {
    name: input.goal.name,
    goalTier: input.goal.goalTier,
    location: input.goal.location,
    department: input.goal.department,
    role: input.goal.role,
    target,
    min,
    actual: hasActual ? actual : null,
    weight,
    lowerBetter: input.goal.lowerBetter,
    capped: input.goal.capped,
    capPct: input.goal.capPct,
    achievement,
    weighted,
    bonusContribution,
    metMin
  };
}

export function buildScorecard(input: {
  employee: Employee;
  month: string;
  periodType: "monthly" | "quarterly";
  goals: EditableGoal[];
  bonusPotentialPct?: number;
  submittedBy?: string;
  /** Pass false when no Rippling payroll upload exists for this month —
   *  forces baseEarnings to 0 so estimated salary doesn't inflate live cards. */
  payrollAvailable?: boolean;
}): Scorecard {
  const bonusPotentialPct = input.bonusPotentialPct ?? 10;
  // When payroll hasn't been uploaded yet (current / future months) use 0 so we
  // never show a salary estimate as if it were real.
  const earnings = input.payrollAvailable === false ? 0 : baseEarnings({
    payType: input.employee.payType,
    hourlyRate: input.employee.hourlyRate,
    hours: input.employee.hoursWorked,
    annualPay: input.employee.annualPay,
    grossEarnings: input.employee.grossEarnings,
    periodType: input.periodType
  });

  const goals = input.goals.map((goal) =>
    calculateGoal({
      goal,
      target: goal.scTarget,
      min: goal.scMin,
      actual: goal.scActual,
      weight: goal.scWeight,
      baseEarnings: earnings,
      bonusPotentialPct
    })
  );
  const weightedAchievement = goals.reduce((sum, goal) => sum + goal.weighted, 0);
  const scorecardCapped = weightedAchievement > 200;
  const finalAchievement = scorecardCapped ? 200 : weightedAchievement;
  const bonusAmount = earnings * (finalAchievement / 100) * (bonusPotentialPct / 100);

  return {
    id: `scorecard-${input.employee.id}-${input.month.replace(/\W+/g, "-").toLowerCase()}`,
    employeeName: input.employee.name,
    role: input.employee.role,
    department: input.employee.department,
    location: input.employee.location,
    manager: input.employee.manager,
    payType: input.employee.payType,
    hourlyRate: input.employee.hourlyRate,
    hours: input.employee.hoursWorked,
    annualPay: input.employee.annualPay,
    baseEarnings: earnings,
    bonusPotentialPct,
    scorecardMonth: input.month,
    periodType: input.periodType,
    weightedAchievement,
    bonusAmount,
    scorecardCapped,
    flag120: weightedAchievement >= 120,
    goals,
    submittedAt: new Date().toISOString(),
    submittedBy: input.submittedBy
  };
}

export function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

