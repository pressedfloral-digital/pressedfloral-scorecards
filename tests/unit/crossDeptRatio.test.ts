import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATIO_TIER_TARGETS,
  applyCrossDeptSplit,
  deptSplitKey,
  isHomeIndividualRatioGoal,
  isManualCrossDeptRatioGoal,
  parseRatioTierTargets,
  ratioTierForRole,
  readDeptHours,
  splitRatioWeight,
  splitSummary as sc_note
} from "../../lib/crossDeptRatio";
import { buildScorecard, type EditableGoal } from "../../lib/score";

const ratioGoal: EditableGoal = {
  id: "g-ratio",
  goalTier: "individual",
  location: "Georgia",
  department: "Design",
  role: "Senior Design Specialist",
  name: "Individual Ratio",
  goalValue: 0,
  minValue: 0,
  weight: 30,
  lowerBetter: true,
  capped: "no",
  capPct: 100,
  active: true,
  scTarget: 1.6,
  scMin: 1.6,
  scActual: 1.5,
  scWeight: 30
};

const otherGoal: EditableGoal = { ...ratioGoal, id: "g-frames", goalTier: "department", name: "Monthly Frame Goal", lowerBetter: false, scTarget: 590, scMin: 553, scActual: 600, scWeight: 70, weight: 70 };

describe("ratioTierForRole", () => {
  it("maps titles to seniority tiers", () => {
    expect(ratioTierForRole("Design Specialist")).toBe("specialist");
    expect(ratioTierForRole("Senior Design Specialist")).toBe("senior");
    expect(ratioTierForRole("Master Preservation Specialist")).toBe("master");
    expect(ratioTierForRole("Preservation Team Manager")).toBe("master");
    expect(ratioTierForRole("Client Care Lead")).toBe("senior");
  });
});

describe("goal classification", () => {
  it("treats a ratio goal for its own department as the home goal", () => {
    expect(isHomeIndividualRatioGoal(ratioGoal)).toBe(true);
    expect(isHomeIndividualRatioGoal({ ...ratioGoal, name: "Individual Ratio Design" })).toBe(true);
    expect(isHomeIndividualRatioGoal({ ...ratioGoal, name: "Ratio- Preservation" })).toBe(false);
    expect(isHomeIndividualRatioGoal({ ...ratioGoal, department: "Client Care", name: "Individual Ratio (time per email)" })).toBe(false);
    expect(isHomeIndividualRatioGoal({ ...ratioGoal, goalTier: "department", name: "Combined Ratio Attainment" })).toBe(false);
  });

  it("flags manual cross-department ratio goals", () => {
    expect(isManualCrossDeptRatioGoal({ goalTier: "individual", department: "Fulfillment", name: "Ratio- Preservation" })).toBe(true);
    expect(isManualCrossDeptRatioGoal({ goalTier: "individual", department: "Resin", name: "Individual Ratio - Preservation" })).toBe(true);
    expect(isManualCrossDeptRatioGoal(ratioGoal)).toBe(false);
  });
});

describe("splitRatioWeight", () => {
  it("splits 80 Design / 20 Preservation hours into 24% + 6% (G&A never reaches here)", () => {
    const slices = splitRatioWeight({
      homeDept: "Design",
      role: "Senior Design Specialist",
      weight: 30,
      deptHours: { Design: { hours: 80, orders: 50 }, Preservation: { hours: 20, orders: 25 } },
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    })!;
    expect(slices).toHaveLength(2);
    const [home, pres] = slices;
    expect(home).toMatchObject({ dept: "Design", isHome: true, weight: 24 });
    expect(home.share).toBeCloseTo(0.8);
    expect(pres).toMatchObject({ dept: "Preservation", isHome: false, weight: 6, target: 0.8, min: 1.0, actual: 0.8 });
  });

  it("folds departments under 5% back into home", () => {
    const slices = splitRatioWeight({
      homeDept: "Design",
      role: "Design Specialist",
      weight: 30,
      deptHours: { Design: { hours: 96, orders: 50 }, Preservation: { hours: 4, orders: 2 } },
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    });
    expect(slices).toBeNull();
  });

  it("splits time in Resin using the Resin targets", () => {
    const slices = splitRatioWeight({
      homeDept: "Preservation",
      role: "Production Support Specialist",
      weight: 30,
      deptHours: { Preservation: { hours: 37, orders: 40 }, Resin: { hours: 3, orders: 5 } },
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    })!;
    expect(slices[1]).toMatchObject({ dept: "Resin", weight: 2.25, target: 0.6, min: 0.6, actual: 0.6 });
  });

  it("folds departments with no tier targets back into home", () => {
    const { Resin: _omit, ...noResin } = DEFAULT_RATIO_TIER_TARGETS;
    const slices = splitRatioWeight({
      homeDept: "Design",
      role: "Design Specialist",
      weight: 30,
      deptHours: { Design: { hours: 50, orders: 25 }, Resin: { hours: 50, orders: 10 } },
      tierTargets: noResin
    });
    expect(slices).toBeNull();
  });

  it("keeps slice weights summing exactly to the original weight", () => {
    const slices = splitRatioWeight({
      homeDept: "Fulfillment",
      role: "Senior Fulfillment Specialist",
      weight: 80,
      deptHours: { Fulfillment: { hours: 61, orders: 150 }, Preservation: { hours: 23, orders: 30 }, Design: { hours: 17, orders: 10 } },
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    })!;
    expect(slices.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(80, 10);
    expect(slices.find((s) => s.dept === "Design")).toMatchObject({ target: 1.6, min: 2.0 });
  });

  it("leaves the actual empty when there's time but no completed orders", () => {
    const slices = splitRatioWeight({
      homeDept: "Design",
      role: "Design Specialist",
      weight: 30,
      deptHours: { Design: { hours: 80, orders: 40 }, Preservation: { hours: 20, orders: 0 } },
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    })!;
    expect(slices[1].actual).toBeNull();
  });
});

describe("applyCrossDeptSplit", () => {
  const actuals = {
    [deptSplitKey("hours", "Design", "Allanna Harlan")]: 80,
    [deptSplitKey("orders", "Design", "Allanna Harlan")]: 50,
    [deptSplitKey("hours", "Preservation", "Allanna Harlan")]: 20,
    [deptSplitKey("orders", "Preservation", "Allanna Harlan")]: 25,
    [deptSplitKey("hours", "Fulfillment", "Allanna Harlan")]: 0,
    [deptSplitKey("orders", "Fulfillment", "Allanna Harlan")]: 0
  };

  it("reads hours per department, skipping zeros", () => {
    expect(readDeptHours(actuals, "Allanna Harlan")).toEqual({ Design: { hours: 80, orders: 50 }, Preservation: { hours: 20, orders: 25 } });
  });

  it("expands the home ratio into per-department rows that score correctly", () => {
    const goals = applyCrossDeptSplit({
      isoMonth: "2026-09",
      goals: [otherGoal, ratioGoal],
      role: "Senior Design Specialist",
      deptHours: readDeptHours(actuals, "Allanna Harlan"),
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    });
    expect(goals.map((g) => [g.name, g.scWeight])).toEqual([
      ["Monthly Frame Goal", 70],
      ["Individual Ratio", 24],
      ["Individual Ratio — Preservation", 6]
    ]);
    const pres = goals[2];
    expect(pres).toMatchObject({ department: "Preservation", scTarget: 0.8, scMin: 1.0, scActual: 0.8, split: { of: "g-ratio", isHome: false } });

    expect(sc_note(goals)).toBe("Design 80% (80.0 hrs) · Preservation 20% (20.0 hrs)");

    const sc = buildScorecard({
      employee: { id: "e1", name: "Allanna Harlan", role: "Senior Design Specialist", department: "Design", location: "Georgia", payType: "hourly", hourlyRate: 20, hoursWorked: 104 },
      month: "August 2026",
      periodType: "monthly",
      goals
    });
    // Home: 1.6/1.5 = 106.67% of 24; Preservation: 0.8/0.8 = 100% of 6.
    expect(sc.goals.find((g) => g.name === "Individual Ratio")!.weighted).toBeCloseTo((1.6 / 1.5) * 24, 6);
    expect(sc.goals.find((g) => g.name === "Individual Ratio — Preservation")!.weighted).toBeCloseTo(6, 6);
    // Split info is saved with the submitted scorecard so the note survives submission.
    expect(sc.goals.find((g) => g.name === "Individual Ratio — Preservation")!.split).toMatchObject({ of: "g-ratio", hours: 20 });
    expect(sc.goals.find((g) => g.name === "Monthly Frame Goal")!.split).toBeUndefined();
  });

  it("doesn't split months before September 2026", () => {
    const goals = applyCrossDeptSplit({
      isoMonth: "2026-08",
      goals: [ratioGoal],
      role: "Senior Design Specialist",
      deptHours: readDeptHours(actuals, "Allanna Harlan"),
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    });
    expect(goals).toEqual([ratioGoal]);
  });

  it("skips departments already covered by a manual cross-department goal", () => {
    const manual: EditableGoal = { ...ratioGoal, id: "g-manual", name: "Ratio- Preservation", scWeight: 10, weight: 10 };
    const goals = applyCrossDeptSplit({
      isoMonth: "2026-09",
      goals: [ratioGoal, manual],
      role: "Senior Design Specialist",
      deptHours: readDeptHours(actuals, "Allanna Harlan"),
      tierTargets: DEFAULT_RATIO_TIER_TARGETS
    });
    expect(goals).toEqual([ratioGoal, manual]);
  });

  it("passes goals through untouched when there's no hours data", () => {
    const goals = applyCrossDeptSplit({ isoMonth: "2026-09", goals: [ratioGoal], role: "Senior Design Specialist", deptHours: {}, tierTargets: DEFAULT_RATIO_TIER_TARGETS });
    expect(goals).toEqual([ratioGoal]);
  });
});

describe("parseRatioTierTargets", () => {
  it("falls back to defaults on missing or bad input", () => {
    expect(parseRatioTierTargets(null)).toEqual(DEFAULT_RATIO_TIER_TARGETS);
    expect(parseRatioTierTargets("not json")).toEqual(DEFAULT_RATIO_TIER_TARGETS);
  });

  it("keeps valid rows", () => {
    const custom = { ...DEFAULT_RATIO_TIER_TARGETS, Design: { specialist: 2.2, senior: 1.7, master: 1.3 } };
    expect(parseRatioTierTargets(JSON.stringify(custom))).toEqual(custom);
  });
});
