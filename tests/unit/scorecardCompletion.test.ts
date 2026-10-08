import { describe, expect, it } from "vitest";
import { computeScorecardCompletion, isFinalizedForHistory } from "../../lib/scorecardCompletion";
import type { Employee, EmployeeScorecardSettings, Goal, Scorecard } from "../../lib/types";

const employee: Employee = {
  id: "emp-1",
  name: "Jamie Rivera",
  role: "Design Specialist",
  department: "Design",
  location: "Utah",
  payType: "salary",
  hoursWorked: 160
};

const deptGoal: Goal = {
  id: "goal-1",
  goalTier: "department",
  department: "Design",
  location: "Utah",
  name: "Ratio",
  goalValue: 100,
  minValue: 80,
  weight: 60,
  lowerBetter: false,
  capped: "no",
  capPct: 100,
  active: true,
  periodType: "monthly"
};

const secondDeptGoal: Goal = { ...deptGoal, id: "goal-2", name: "Utilization", weight: 40 };

const baseInput = {
  employee,
  isoMonth: "2026-07",
  periodType: "monthly" as const,
  allGoals: [deptGoal, secondDeptGoal],
  goalAssignments: [],
  actuals: {},
  employeeScorecardSettings: [] as EmployeeScorecardSettings[]
};

describe("computeScorecardCompletion", () => {
  it("is not_started when no goals resolve for the employee", () => {
    const result = computeScorecardCompletion({ ...baseInput, allGoals: [] });
    expect(result.status).toBe("not_started");
    expect(result.goalCount).toBe(0);
  });

  it("is in_progress when goals are attached but weights don't total 100", () => {
    const result = computeScorecardCompletion({ ...baseInput, allGoals: [deptGoal] });
    expect(result.status).toBe("in_progress");
    expect(result.goalCount).toBe(1);
    expect(result.totalWeight).toBe(60);
  });

  it("is ready when goals total exactly 100 and nothing's submitted", () => {
    const result = computeScorecardCompletion(baseInput);
    expect(result.status).toBe("ready");
    expect(result.totalWeight).toBe(100);
    expect(result.hasUnsetWeights).toBe(false);
  });

  it("treats a goal with no weight and no override as unset, blocking ready", () => {
    const unweighted: Goal = { ...secondDeptGoal, weight: undefined };
    const result = computeScorecardCompletion({ ...baseInput, allGoals: [deptGoal, unweighted] });
    expect(result.status).toBe("in_progress");
    expect(result.hasUnsetWeights).toBe(true);
  });

  it("reflects an approved submitted scorecard regardless of live goal state", () => {
    const submittedScorecard = { employeeName: employee.name, reviewStatus: "approved" } as Scorecard;
    const result = computeScorecardCompletion({ ...baseInput, submittedScorecard });
    expect(result.status).toBe("approved");
  });

  it("treats a submitted scorecard with no reviewStatus as approved (legacy)", () => {
    const submittedScorecard = { employeeName: employee.name } as Scorecard;
    const result = computeScorecardCompletion({ ...baseInput, submittedScorecard });
    expect(result.status).toBe("approved");
  });

  it("passes through pending_review and returned statuses", () => {
    const pending = computeScorecardCompletion({
      ...baseInput,
      submittedScorecard: { employeeName: employee.name, reviewStatus: "pending_review" } as Scorecard
    });
    expect(pending.status).toBe("pending_review");

    const returned = computeScorecardCompletion({
      ...baseInput,
      submittedScorecard: { employeeName: employee.name, reviewStatus: "returned" } as Scorecard
    });
    expect(returned.status).toBe("returned");
  });

  it("is no_scorecard_required for employees below the hours threshold", () => {
    const partTime = { ...employee, hoursWorked: 12 };
    const result = computeScorecardCompletion({ ...baseInput, employee: partTime });
    expect(result.status).toBe("no_scorecard_required");
  });

  it("excludes a goal via employee settings even though it's in the base set", () => {
    const settings: EmployeeScorecardSettings = {
      id: "settings-1",
      employeeName: employee.name,
      periodType: "monthly",
      excludedGoalIds: [secondDeptGoal.id],
      addedGoalIds: [],
      weightOverrides: {}
    };
    const result = computeScorecardCompletion({ ...baseInput, employeeScorecardSettings: [settings] });
    expect(result.goalCount).toBe(1);
    expect(result.totalWeight).toBe(60);
    expect(result.status).toBe("in_progress");
  });

  it("applies a weight override from employee settings", () => {
    const settings: EmployeeScorecardSettings = {
      id: "settings-2",
      employeeName: employee.name,
      periodType: "monthly",
      excludedGoalIds: [],
      addedGoalIds: [],
      weightOverrides: { Ratio: 50, Utilization: 50 }
    };
    const result = computeScorecardCompletion({ ...baseInput, employeeScorecardSettings: [settings] });
    expect(result.totalWeight).toBe(100);
    expect(result.status).toBe("ready");
  });

  it("filters out quarterly-only goals from a monthly period and vice versa", () => {
    const quarterlyGoal: Goal = { ...deptGoal, id: "goal-3", name: "Quarterly Ratio", periodType: "quarterly" };
    const monthlyResult = computeScorecardCompletion({ ...baseInput, allGoals: [deptGoal, quarterlyGoal] });
    expect(monthlyResult.goalCount).toBe(1);

    const quarterlyResult = computeScorecardCompletion({
      ...baseInput,
      periodType: "quarterly",
      allGoals: [deptGoal, quarterlyGoal]
    });
    expect(quarterlyResult.goalCount).toBe(1);
    expect(quarterlyResult.totalWeight).toBe(60);
  });
});

describe("isFinalizedForHistory", () => {
  it("includes approved and no-review scorecards, excludes pending and returned", () => {
    expect(isFinalizedForHistory({ reviewStatus: "approved" })).toBe(true);
    expect(isFinalizedForHistory({ reviewStatus: undefined })).toBe(true);
    expect(isFinalizedForHistory({ reviewStatus: "pending_review" })).toBe(false);
    expect(isFinalizedForHistory({ reviewStatus: "returned" })).toBe(false);
  });
});
