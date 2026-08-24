export type GoalTier = "company" | "department" | "individual";
export type PayType = "hourly" | "salary";
export type ProfileRole = "admin" | "manager" | "user";

export type ManagerProfile = {
  id: string;
  email: string;
  role: ProfileRole;
  departments: string[];
  locations: string[];
  linkedEmployeeName?: string;
  titleOverride?: string;      // overrides the role/title from Rippling on their scorecard
  supervisorId?: string;   // profile id of this manager's supervisor
  scorecardPeriodType?: "monthly" | "quarterly";
  companyGoalsGrant?: boolean; // grants this manager + their Rippling reporting tree company-goal read/write access
};

export type Goal = {
  id: string;
  goalTier: GoalTier;
  location?: string;
  department?: string;
  role?: string;         // legacy — use employeeName for individual goals going forward
  employeeName?: string; // individual goals: the specific employee this goal belongs to
  name: string;
  goalValue: number;
  minValue: number;
  weight?: number;       // default weight (%) for this goal on scorecards
  lowerBetter: boolean;
  capped: "yes" | "no";
  capPct: number;
  active: boolean;
  periodType?: "monthly" | "quarterly";
  startMonth?: string;  // ISO "YYYY-MM" — goal is hidden in months before this
  endMonth?: string;    // ISO "YYYY-MM" — goal is inactive/hidden from this month forward
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ActualsByKey = Record<string, number | null>;

export type Employee = {
  id: string;
  name: string;
  role: string;
  department: string;
  location: string;
  manager?: string;
  payType: PayType;
  hourlyRate?: number;
  annualPay?: number;
  grossEarnings?: number;
  hoursWorked?: number;
  isExempt?: boolean;
  isManager?: boolean;
  employmentType?: string;
};

export type ScorecardGoal = {
  name: string;
  goalTier: GoalTier;
  location?: string;
  department?: string;
  role?: string;
  target: number;
  min: number;
  actual: number | null;
  weight: number;
  lowerBetter: boolean;
  capped: "yes" | "no";
  capPct: number;
  achievement: number;
  weighted: number;
  bonusContribution: number;
  metMin: boolean;
};

export type Scorecard = {
  id: string;
  employeeName: string;
  role: string;
  department: string;
  location: string;
  manager?: string;
  payType: PayType;
  hourlyRate?: number;
  hours?: number;
  annualPay?: number;
  baseEarnings: number;
  bonusPotentialPct: number;
  scorecardMonth: string;
  periodType: "monthly" | "quarterly";
  weightedAchievement: number;
  bonusAmount: number;
  scorecardCapped: boolean;
  flag120: boolean;
  goals: ScorecardGoal[];
  submittedAt?: string;
  submittedBy?: string;
  reviewStatus?: "pending_review" | "approved" | "returned";
  reviewerId?: string;   // supervisor's profile id at submission time
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

// Persistent per-employee scorecard configuration — which goals are excluded,
// which extra goals were manually added, and custom weight overrides.
// Applies from the month of the change going forward; does not affect submitted scorecards.
export type EmployeeScorecardSettings = {
  id: string;
  employeeName: string;
  periodType: "monthly" | "quarterly";
  excludedGoalIds: string[];              // IDs of base goals explicitly removed
  addedGoalIds: string[];                 // IDs of extra goals manually added (not in base)
  weightOverrides: Record<string, number>; // goalName → weight %
  updatedAt?: string;
  updatedBy?: string;
};

export type GoalAssignment = {
  id: string;
  goalId: string;
  employeeName: string;
  startMonth: string;   // ISO "YYYY-MM" — assignment starts from this month
  endMonth?: string;    // ISO "YYYY-MM" — assignment ends from this month forward (optional)
  createdBy?: string;
  createdAt?: string;
};

export type AppData = {
  profile: ManagerProfile;
  goals: Goal[];
  actuals: Record<string, ActualsByKey>;
  rippling: Record<string, Employee[]>;
  scorecards: Scorecard[];
  goalAssignments: GoalAssignment[];
  employeeScorecardSettings: EmployeeScorecardSettings[];
};

export type HistoryFilters = {
  period: string;
  search: string;
  location: string;
  department: string;
  goal: string;
};

