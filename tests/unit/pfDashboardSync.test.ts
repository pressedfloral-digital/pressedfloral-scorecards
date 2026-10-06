import { describe, expect, it } from "vitest";
import { matchRosterName } from "../../lib/pfDashboardSync";

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
