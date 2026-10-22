import { describe, expect, it } from "vitest";
import { isDue, lastSlot } from "./scheduler.ts";

const SUNDAY_9AM = "0 9 * * 0";
const TZ = "UTC";

describe("lastSlot", () => {
  it("finds the most recent Sunday 9am", () => {
    // Wednesday 2026-10-21
    expect(lastSlot(SUNDAY_9AM, new Date("2026-10-21T12:00:00Z"), TZ).toISOString())
      .toBe("2026-10-18T09:00:00.000Z");
  });

  it("includes a slot that is exactly now", () => {
    expect(lastSlot(SUNDAY_9AM, new Date("2026-10-18T09:00:00Z"), TZ).toISOString())
      .toBe("2026-10-18T09:00:00.000Z");
  });

  it("respects the timezone", () => {
    expect(lastSlot(SUNDAY_9AM, new Date("2026-10-21T12:00:00Z"), "Asia/Kolkata").toISOString())
      .toBe("2026-10-18T03:30:00.000Z");
  });
});

describe("isDue", () => {
  it("is not due when the last run came after the latest slot", () => {
    expect(isDue(SUNDAY_9AM, new Date("2026-10-18T09:00:30Z"), new Date("2026-10-21T12:00:00Z"), TZ))
      .toBe(false);
  });

  it("catches up when the laptop was asleep through the slot", () => {
    // Last brief the previous Sunday, laptop opened Monday morning.
    expect(isDue(SUNDAY_9AM, new Date("2026-10-11T09:00:10Z"), new Date("2026-10-19T08:00:00Z"), TZ))
      .toBe(true);
  });

  it("fires once even after several missed weeks", () => {
    const lastRun = new Date("2026-09-01T00:00:00Z");
    const now = new Date("2026-10-21T12:00:00Z");
    expect(isDue(SUNDAY_9AM, lastRun, now, TZ)).toBe(true);
    // After running, the stored time is `now`, so it's no longer due.
    expect(isDue(SUNDAY_9AM, now, now, TZ)).toBe(false);
  });
});
