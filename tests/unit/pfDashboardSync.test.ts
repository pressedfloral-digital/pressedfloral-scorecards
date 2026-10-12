import { afterEach, describe, expect, it, vi } from "vitest";
import { computePfDashboardSync, matchRosterName } from "../../lib/pfDashboardSync";
import { DEPT_SPLIT_TIER, OPS_TOTAL_DEPT } from "../../lib/crossDeptRatio";

const roster = [
  { name: "Cyd G", role: "Production Support Specialist", department: "Preservation", location: "Georgia" },
  { name: "Sher Taylor", role: "Production Support Specialist", department: "Preservation", location: "Georgia" },
  { name: "Abby Wilkey", role: "Production Support Specialist", department: "Preservation", location: "Utah" },
  { name: "Sloane James", role: "General Manager", department: "Operations", location: "Utah" },
  { name: "Erin Webb", role: "Senior Design Specialist", department: "Design", location: "Georgia" },
  { name: "Sam Lee", role: "Design Specialist", department: "Design", location: "Utah" },
  { name: "Samantha Lee", role: "Design Specialist", department: "Design", location: "Utah" }
];

describe("matchRosterName", () => {
  it("prefers an exact, case-insensitive match", () => {
    expect(matchRosterName(" erin webb ", "Georgia", roster)).toBe("Erin Webb");
    expect(matchRosterName("Sam Lee", "Utah", roster)).toBe("Sam Lee");
  });

  it("matches a last-name initial or a shortened first name", () => {
    expect(matchRosterName("Cyd Gay", "Georgia", roster)).toBe("Cyd G");
    expect(matchRosterName("Sherilyn Taylor", "Georgia", roster)).toBe("Sher Taylor");
  });

  it("doesn't match different people who share one name", () => {
    expect(matchRosterName("Abby Kunz", "Utah", roster)).toBeNull();
    expect(matchRosterName("Sydney James", "Utah", roster)).toBeNull();
  });

  it("requires the same location", () => {
    expect(matchRosterName("Cyd Gay", "Utah", roster)).toBeNull();
  });

  it("refuses ambiguous matches", () => {
    expect(matchRosterName("Sa Lee", "Utah", roster)).toBeNull();
  });
});

describe("computePfDashboardSync total Ops Dashboard hours", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes each production member's hours across every department, G&A included", async () => {
    const memberRatios = [
      { name: "Sam Lee", department: "Design", hours: 30, orders: 20, ratio: 1.5 },
      { name: "Sam Lee", department: "G&A", hours: 12, orders: 0, ratio: null },
      { name: "Sloane James", department: "G&A", hours: 50, orders: 0, ratio: null }
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("/api/kpis")
        ? { windows: [] }
        : { byLocation: { Utah: { "2026-09": { memberRatios } } } }
    })));

    const { writes } = await computePfDashboardSync({ targetMonth: "2026-09", baseUrl: "", syncSecret: "", goals: [], roster });
    const totals = writes.filter((w) => w.goalTier === DEPT_SPLIT_TIER && w.department === OPS_TOTAL_DEPT);
    // G&A-only staff aren't production team members, so they keep Rippling hours.
    expect(totals).toEqual([expect.objectContaining({ goalName: "hours::Sam Lee", value: 42, period: "September 2026" })]);
  });
});
