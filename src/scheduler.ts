import { CronExpressionParser } from "cron-parser";
import type { Store } from "./db.ts";

/** The latest time `cron` should have fired at or before `now`. */
export function lastSlot(cron: string, now: Date, tz: string): Date {
  // prev() is strictly before currentDate, so nudge forward to include an exact hit.
  const at = new Date(now.getTime() + 1000);
  return CronExpressionParser.parse(cron, { currentDate: at, tz }).prev().toDate();
}

/** Due when a scheduled slot has passed since the job last ran. */
export function isDue(cron: string, lastRun: Date, now: Date, tz: string): boolean {
  return lastSlot(cron, now, tz) > lastRun;
}

interface Job {
  name: string;
  cron: string;
  run: (missedSlot: Date, now: Date) => Promise<void>;
}

/**
 * Checks every minute instead of firing at exact times. A laptop that was
 * asleep or off at the scheduled moment catches up on the first check after
 * it wakes, so a slot is never silently skipped.
 */
export function startScheduler(store: Store, tz: string, jobs: Job[], everyMs = 60_000) {
  const running = new Set<string>();

  const tick = () => {
    const now = new Date();
    for (const job of jobs) {
      if (running.has(job.name)) continue;
      const key = `last_run:${job.name}`;
      const stored = store.getSetting(key);
      if (!stored) {
        // First launch: start the clock now rather than firing straight away.
        store.setSetting(key, now.toISOString());
        continue;
      }
      if (!isDue(job.cron, new Date(stored), now, tz)) continue;

      running.add(job.name);
      const slot = lastSlot(job.cron, now, tz);
      job
        .run(slot, now)
        .then(() => store.setSetting(key, now.toISOString()))
        .catch((err) => console.error(`${job.name} failed, will retry next check:`, err))
        .finally(() => running.delete(job.name));
    }
  };

  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
