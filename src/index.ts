import { createBot } from "./bot.ts";
import { syncWatchlist } from "./brief.ts";
import { config, demoMode } from "./config.ts";
import { openDb } from "./db.ts";
import { startScheduler } from "./scheduler.ts";

if (!config.telegramToken) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const store = openDb(config.dbPath);
const { bot, runBrief } = createBot(store);

const LATE_MS = 60 * 60_000;

const stopScheduler = startScheduler(store, config.timezone, [
  {
    name: "sync",
    cron: config.syncCron,
    run: async () => {
      const r = await syncWatchlist(store);
      console.log(`sync: ${r.synced.length} ok, ${r.failed.length} failed`);
    },
  },
  {
    name: "brief",
    cron: config.briefCron,
    run: async (slot, now) => {
      if (!config.telegramOwnerId) return;
      const late = now.getTime() - slot.getTime() > LATE_MS;
      const when = slot.toLocaleString("en-GB", {
        weekday: "long", hour: "numeric", minute: "2-digit", timeZone: config.timezone,
      });
      await runBrief(config.telegramOwnerId, late ? `Catching up on the brief from ${when}.` : undefined);
    },
  },
]);

await bot.api.setMyCommands([
  { command: "brief", description: "Build this week's brief now" },
  { command: "watch", description: "Add creators to the watchlist" },
  { command: "unwatch", description: "Remove a creator" },
  { command: "watchlist", description: "Show tracked creators" },
  { command: "niche", description: "Set your niche" },
  { command: "pillars", description: "Set your content pillars" },
  { command: "inbox", description: "Ideas you've kept" },
]);

const shutdown = () => {
  stopScheduler();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(
  `Bot running${demoMode ? " in demo mode" : ""}. Brief: "${config.briefCron}" (${config.timezone}).`,
);
await bot.start();
