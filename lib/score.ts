import type { Employee, Goal, PayType, Scorecard, ScorecardGoal, ScorecardGoalSplit } from "./types";

export type EditableGoal = Goal & {
  scTarget: number;
  scMin: number;
  scActual: number | null;
  scWeight: number;
  split?: ScorecardGoalSplit;
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

  const goals = input.goals.map((goal) => {
    const scored = calculateGoal({
      goal,
      target: goal.scTarget,
      min: goal.scMin,
      actual: goal.scActual,
      weight: goal.scWeight,
      baseEarnings: earnings,
      bonusPotentialPct
    });
    return goal.split ? { ...scored, split: goal.split } : scored;
  });
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

