import { describe, expect, it } from "vitest";
import { latestRowInQuarter } from "../../lib/reportingTree";
import type { Employee } from "../../lib/types";

const row = (manager: string, assignedManagerId?: string): Employee =>
  ({ id: "lc", name: "Lauren Cox", role: "Client Care Manager", department: "Client Care", location: "Remote", manager, assignedManagerId, payType: "salary" });

describe("latestRowInQuarter", () => {
  it("uses the latest upload in the quarter, so a mid-quarter manager change counts", () => {
    const rippling = { "2026-07": [row("Hailey Hill")], "2026-08": [row("Hailey Hill")], "2026-09": [row("braden@pressedfloral.com", "braden-id")] };
    expect(latestRowInQuarter(rippling, "Lauren Cox", "2026-07")?.assignedManagerId).toBe("braden-id");
  });

  it("falls back to earlier months in the quarter and ignores other quarters", () => {
    const rippling = { "2026-07": [row("Hailey Hill")], "2026-10": [row("Braden Kerr")] };
    expect(latestRowInQuarter(rippling, "Lauren Cox", "2026-07")?.manager).toBe("Hailey Hill");
    expect(latestRowInQuarter(rippling, "Someone Else", "2026-07")).toBeUndefined();
  });

  it("handles quarters that cross a year boundary", () => {
    const rippling = { "2026-12": [row("Braden Kerr")], "2027-01": [row("Hailey Hill")] };
    expect(latestRowInQuarter(rippling, "Lauren Cox", "2026-10")?.manager).toBe("Braden Kerr");
  });
});
