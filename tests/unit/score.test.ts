import { describe, expect, it } from "vitest";
import { fixtureEmployees, fixtureGoals, fixturePeriod } from "../../lib/fixtures";
import { baseEarnings, buildScorecard, calculateGoal, refreshScorecardEarnings, scorecardPayrollMonths, sumQuarterlyEmployee } from "../../lib/score";
import type { Employee, Scorecard } from "../../lib/types";

describe("score calculations", () => {
  it("calculates higher-is-better goals", () => {
    const result = calculateGoal({
      goal: fixtureGoals[0],
      target: 100,
      min: 80,
      actual: 120,
      weight: 50,
      baseEarnings: 1000
    });
    expect(result.metMin).toBe(true);
    expect(result.achievement).toBe(120);
    expect(result.weighted).toBe(60);
    expect(result.bonusContribution).toBe(60);
  });

  it("calculates lower-is-better goals and applies caps", () => {
    const result = calculateGoal({
      goal: { ...fixtureGoals[1], capPct: 125 },
      target: 2,
      min: 4,
      actual: 1,
      weight: 20,
      baseEarnings: 2000
    });
    expect(result.metMin).toBe(true);
    expect(result.achievement).toBe(125);
    expect(result.weighted).toBe(25);
  });

  it("zeros out goals below minimum", () => {
    const result = calculateGoal({
      goal: fixtureGoals[2],
      target: 40,
      min: 30,
      actual: 20,
      weight: 40,
      baseEarnings: 1000
    });
    expect(result.metMin).toBe(false);
    expect(result.achievement).toBe(0);
    expect(result.bonusContribution).toBe(0);
  });

  it("caps total scorecards at 200 percent", () => {
    const scorecard = buildScorecard({
      employee: { ...fixtureEmployees[0], grossEarnings: 1000 },
      month: fixturePeriod,
      periodType: "monthly",
      goals: [
        { ...fixtureGoals[2], scTarget: 10, scMin: 1, scActual: 50, scWeight: 100 }
      ]
    });
    expect(scorecard.weightedAchievement).toBeGreaterThan(200);
    expect(scorecard.scorecardCapped).toBe(true);
    expect(scorecard.bonusAmount).toBe(200);
  });

  it("handles hourly and salary base earnings", () => {
    expect(baseEarnings({ payType: "hourly", hourlyRate: 20, hours: 10 })).toBe(200);
    expect(baseEarnings({ payType: "salary", annualPay: 120000, periodType: "monthly" })).toBe(10000);
    expect(baseEarnings({ payType: "salary", annualPay: 120000, periodType: "quarterly" })).toBe(30000);
  });

  describe("sumQuarterlyEmployee", () => {
    const qMonths = ["2026-04", "2026-05", "2026-06"];
    const hourly = { ...fixtureEmployees[0] };
    const salaried = { ...fixtureEmployees[1] };

    it("sums hours and gross earnings when every month has a matched pair", () => {
      const result = sumQuarterlyEmployee({
        employeeName: hourly.name,
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...hourly, grossEarnings: 2000, hoursWorked: 120 }],
          "2026-05": [{ ...hourly, grossEarnings: 2100, hoursWorked: 125 }],
          "2026-06": [{ ...hourly, grossEarnings: 2200, hoursWorked: 130 }]
        }
      });
      expect(result.quarterlyEarnings).toBe(6300);
      expect(result.hoursWorked).toBe(375);
      expect(result.uploadFound).toBe(true);
      expect(result.estimatedMonths).toEqual([]);
    });

    it("estimates an hourly month missing its gross figure from rate × hours, and flags it", () => {
      const result = sumQuarterlyEmployee({
        employeeName: hourly.name,
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...hourly, grossEarnings: 2000, hoursWorked: 120 }],
          "2026-05": [{ ...hourly, grossEarnings: undefined, hoursWorked: 125 }],
          "2026-06": [{ ...hourly, grossEarnings: 2200, hoursWorked: 130 }]
        }
      });
      // May has no gross figure, so it's estimated at hourlyRate (24) × 125 = 3000.
      expect(result.quarterlyEarnings).toBe(2000 + 3000 + 2200);
      expect(result.hoursWorked).toBe(375);
      expect(result.uploadFound).toBe(true);
      expect(result.estimatedMonths).toEqual(["2026-05"]);
    });

    it("prices salaried months at annualPay/12 when no per-period gross exists, with no estimate flag", () => {
      const result = sumQuarterlyEmployee({
        employeeName: salaried.name,
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...salaried, grossEarnings: undefined, hoursWorked: 160 }],
          "2026-05": [{ ...salaried, grossEarnings: undefined, hoursWorked: 160 }],
          "2026-06": [{ ...salaried, grossEarnings: undefined, hoursWorked: 160 }]
        }
      });
      // annualPay 62000 / 12 per month × 3 months = 15500.
      expect(result.quarterlyEarnings).toBeCloseTo(15500, 2);
      expect(result.hoursWorked).toBe(480);
      expect(result.uploadFound).toBe(true);
      expect(result.estimatedMonths).toEqual([]);
    });

    it("blends a mid-quarter hourly → salaried role change month by month", () => {
      // April was worked hourly (actual gross reported); May–June are salaried after a role
      // change. April's real pay must be kept, and the salaried months priced at annualPay/12 —
      // neither annualPay/4 for the whole quarter nor April's gross alone.
      const result = sumQuarterlyEmployee({
        employeeName: "Role Changer",
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...hourly, name: "Role Changer", grossEarnings: 3280, hoursWorked: 162.77 }],
          "2026-05": [{ ...salaried, name: "Role Changer", annualPay: 52000, grossEarnings: undefined, hoursWorked: 162.92 }],
          "2026-06": [{ ...salaried, name: "Role Changer", annualPay: 52000, grossEarnings: undefined, hoursWorked: 153.7 }]
        }
      });
      expect(result.quarterlyEarnings).toBeCloseTo(3280 + (52000 / 12) * 2, 2);
      expect(result.hoursWorked).toBeCloseTo(479.39, 2);
      expect(result.estimatedMonths).toEqual([]);
    });

    it("keeps a salaried month's actual gross when Rippling did report one", () => {
      const result = sumQuarterlyEmployee({
        employeeName: salaried.name,
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...salaried, grossEarnings: 5100, hoursWorked: 160 }],
          "2026-05": [{ ...salaried, grossEarnings: undefined, hoursWorked: 160 }],
          "2026-06": [{ ...salaried, grossEarnings: undefined, hoursWorked: 160 }]
        }
      });
      // April uses its reported gross; May/June fall back to annualPay/12.
      expect(result.quarterlyEarnings).toBeCloseTo(5100 + (62000 / 12) * 2, 2);
    });

    it("flags months where the employee has no upload row at all", () => {
      const result = sumQuarterlyEmployee({
        employeeName: salaried.name,
        qMonths,
        ripplingByMonth: {
          "2026-04": [{ ...salaried, grossEarnings: undefined, hoursWorked: 96 }],
          "2026-05": [hourly], // upload exists, but this employee isn't in it
          "2026-06": [{ ...salaried, grossEarnings: undefined, hoursWorked: 152 }]
        }
      });
      expect(result.quarterlyEarnings).toBeCloseTo((62000 / 12) * 2, 2);
      expect(result.missingMonths).toEqual(["2026-05"]);
      expect(result.uploadFound).toBe(true);
    });

    it("reports no upload found when the employee is missing from every month", () => {
      const result = sumQuarterlyEmployee({
        employeeName: "Nobody",
        qMonths,
        ripplingByMonth: { "2026-04": [hourly], "2026-05": [hourly], "2026-06": [hourly] }
      });
      expect(result.uploadFound).toBe(false);
      expect(result.quarterlyEarnings).toBeUndefined();
      expect(result.estimatedMonths).toEqual([]);
      expect(result.missingMonths).toEqual(qMonths);
      expect(result.hoursWorked).toBeUndefined();
    });
  });

  describe("refreshScorecardEarnings", () => {
    const hourly = (name: string, hoursWorked: number, hourlyRate = 18.5): Employee => ({
      id: name, name, role: "Designer", department: "Design", location: "Georgia", manager: "",
      payType: "hourly", hourlyRate, hoursWorked
    });
    const submitted = (overrides: Partial<Scorecard> = {}): Scorecard => ({
      id: "sc-1", employeeName: "Erin Webb", role: "Designer", department: "Design", location: "Georgia",
      payType: "hourly", hourlyRate: 18.5, baseEarnings: 0, bonusPotentialPct: 10,
      scorecardMonth: "September 2026", periodType: "monthly", weightedAchievement: 110,
      bonusAmount: 0, scorecardCapped: false, flag120: false, reviewStatus: "pending_review",
      goals: [{ ...calculateGoal({ goal: fixtureGoals[0], target: 100, min: 80, actual: 110, weight: 100, baseEarnings: 0 }) }],
      ...overrides
    });

    it("maps scorecard periods to payroll months", () => {
      expect(scorecardPayrollMonths("September 2026")).toEqual(["2026-09"]);
      expect(scorecardPayrollMonths("Q3 2026")).toEqual(["2026-07", "2026-08", "2026-09"]);
      expect(scorecardPayrollMonths("garbage")).toEqual([]);
    });

    it("re-prices a scorecard submitted before payroll was uploaded", () => {
      const next = refreshScorecardEarnings({ scorecard: submitted(), ripplingByMonth: { "2026-09": [hourly("Erin Webb", 100)] } });
      expect(next?.baseEarnings).toBeCloseTo(1850);
      expect(next?.hours).toBe(100);
      expect(next?.bonusAmount).toBeCloseTo(1850 * 1.1 * 0.1);
      expect(next?.goals[0].bonusContribution).toBeCloseTo(1850 * 1.1 * 0.1);
      expect(next?.weightedAchievement).toBe(110);
      expect(next?.reviewStatus).toBe("pending_review");
    });

    it("leaves approved, unmatched and unchanged scorecards alone", () => {
      const rippling = { "2026-09": [hourly("Erin Webb", 100)] };
      expect(refreshScorecardEarnings({ scorecard: submitted({ reviewStatus: "approved" }), ripplingByMonth: rippling })).toBeNull();
      expect(refreshScorecardEarnings({ scorecard: submitted({ employeeName: "Someone Else" }), ripplingByMonth: rippling })).toBeNull();
      expect(refreshScorecardEarnings({ scorecard: submitted({ baseEarnings: 1850, hours: 100 }), ripplingByMonth: rippling })).toBeNull();
    });

    it("keeps a prorated bonus prorated", () => {
      const explicit = refreshScorecardEarnings({ scorecard: submitted(), ripplingByMonth: { "2026-09": [hourly("Erin Webb", 100)] }, prorationFactor: 0.5 });
      expect(explicit?.bonusAmount).toBeCloseTo(101.75);
      // Recovered from the stored ratio: $1000 earnings, 50%-prorated $55 bonus.
      const recovered = refreshScorecardEarnings({ scorecard: submitted({ baseEarnings: 1000, bonusAmount: 55 }), ripplingByMonth: { "2026-09": [hourly("Erin Webb", 100)] } });
      expect(recovered?.bonusAmount).toBeCloseTo(101.75);
    });

    it("sums the quarter for quarterly scorecards", () => {
      const next = refreshScorecardEarnings({
        scorecard: submitted({ scorecardMonth: "Q3 2026", periodType: "quarterly" }),
        ripplingByMonth: { "2026-07": [hourly("Erin Webb", 100)], "2026-09": [hourly("Erin Webb", 50)] }
      });
      expect(next?.baseEarnings).toBeCloseTo(150 * 18.5);
      expect(next?.hours).toBe(150);
    });
  });
});
