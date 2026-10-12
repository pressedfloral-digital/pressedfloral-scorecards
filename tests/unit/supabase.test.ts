import { describe, expect, it } from "vitest";
import { fixtureGoals, fixtureScorecards } from "../../lib/fixtures";
import { actualsFromRows, configuredProfileFromRow, goalFromRow, goalToRow, isSupabaseUuid, profileFromRow, scorecardFromRow, scorecardToRow } from "../../lib/supabase";

describe("supabase mappers", () => {
  it("round trips goals through legacy table columns", () => {
    const row = goalToRow(fixtureGoals[0]);
    expect(row.goal_tier).toBe("company");
    expect(goalFromRow(row)).toMatchObject({
      goalTier: fixtureGoals[0].goalTier,
      name: fixtureGoals[0].name,
      goalValue: fixtureGoals[0].goalValue
    });
  });

  it("omits client-only goal ids for new Supabase inserts", () => {
    const row = goalToRow({ ...fixtureGoals[0], id: "goal-123" }, { includeId: false });
    expect(row).not.toHaveProperty("id");
  });

  it("detects Supabase UUID ids", () => {
    expect(isSupabaseUuid("a84729d3-c4c3-4e98-ab5d-5d3ba91ec332")).toBe(true);
    expect(isSupabaseUuid("goal-123")).toBe(false);
  });

  it("maps user profiles for read-only linked employee access", () => {
    expect(profileFromRow("viewer@example.com", {
      id: "user-1",
      role: "user",
      departments: [],
      locations: [],
      linked_employee_name: "Ava Jensen"
    })).toMatchObject({
      role: "user",
      linkedEmployeeName: "Ava Jensen"
    });
  });

  it("does not configure missing, invalid, or unlinked user profiles", () => {
    expect(configuredProfileFromRow("missing@example.com", null)).toBeNull();
    expect(configuredProfileFromRow("invalid@example.com", {
      id: "user-2",
      role: "owner",
      departments: [],
      locations: []
    })).toBeNull();
    expect(configuredProfileFromRow("viewer@example.com", {
      id: "user-3",
      role: "user",
      departments: [],
      locations: [],
      linked_employee_name: null
    })).toBeNull();
  });

  it("maps actual rows to legacy actual keys", () => {
    expect(actualsFromRows([{ goal_tier: "department", location: "Utah", department: "Design", goal_name: "Rework", actual_value: 4 }]))
      .toEqual({ "department|Utah|Design|Rework": 4 });
  });

  it("keeps last-day proration rows under their own keys", () => {
    expect(actualsFromRows([
      { goal_tier: "__meta__", location: null, department: null, goal_name: "__prorate_day__|Ava Jensen", actual_value: 15 },
      { goal_tier: "__meta__", location: null, department: null, goal_name: "__prorate_qday__|Ava Jensen", actual_value: 77 }
    ])).toEqual({ "__prorate_day__|Ava Jensen": 15, "__prorate_qday__|Ava Jensen": 77 });
  });

  it("round trips scorecards through legacy table columns", () => {
    const row = scorecardToRow(fixtureScorecards[0]);
    expect(row.employee_name).toBe("Ava Jensen");
    expect(row).not.toHaveProperty("id");
    expect(scorecardFromRow({ ...row, id: "row-1", submitted_at: "now" })).toMatchObject({
      id: "row-1",
      employeeName: "Ava Jensen",
      goals: fixtureScorecards[0].goals
    });
  });
});
