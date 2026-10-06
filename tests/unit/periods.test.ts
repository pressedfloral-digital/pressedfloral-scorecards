import { describe, expect, it } from "vitest";
import { businessMonthReadyAt, currentBusinessMonth, isBusinessMonthComplete, lastCompletedBusinessMonth } from "../../lib/periods";

describe("business months", () => {
  it("ends September 2026 with the week of Mon Sep 28, ready Mon Oct 5", () => {
    expect(businessMonthReadyAt("2026-09").toISOString()).toBe("2026-10-05T13:00:00.000Z");
  });

  it("handles months whose last day is a Monday or a Sunday", () => {
    // Aug 31 2026 is a Monday → that week belongs to August, ready Mon Sep 7.
    expect(businessMonthReadyAt("2026-08").toISOString()).toBe("2026-09-07T13:00:00.000Z");
    // May 31 2026 is a Sunday → last week starts Mon May 25, ready Mon Jun 1.
    expect(businessMonthReadyAt("2026-05").toISOString()).toBe("2026-06-01T13:00:00.000Z");
  });

  it("isn't complete on the 3rd when the last week is still running", () => {
    expect(isBusinessMonthComplete("2026-09", new Date("2026-10-03T14:00:00Z"))).toBe(false);
    expect(lastCompletedBusinessMonth(new Date("2026-10-03T14:00:00Z"))).toBe("2026-08");
  });

  it("is complete once Monday's Ops Dashboard load has run", () => {
    expect(isBusinessMonthComplete("2026-09", new Date("2026-10-05T12:30:00Z"))).toBe(false);
    expect(lastCompletedBusinessMonth(new Date("2026-10-05T14:00:00Z"))).toBe("2026-09");
    expect(lastCompletedBusinessMonth(new Date("2026-10-31T14:00:00Z"))).toBe("2026-09");
  });
});

describe("currentBusinessMonth", () => {
  it("stays on the prior month until the next month's first Monday", () => {
    expect(currentBusinessMonth(new Date("2026-10-03T14:00:00Z"))).toBe("2026-09");
    expect(currentBusinessMonth(new Date("2026-10-05T14:00:00Z"))).toBe("2026-10");
  });
});
