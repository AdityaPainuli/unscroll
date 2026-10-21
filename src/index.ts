import cron from "node-cron";
import { createBot } from "./bot.ts";
import { syncWatchlist } from "./brief.ts";
import { config, demoMode } from "./config.ts";
import { openDb } from "./db.ts";

if (!config.telegramToken) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const store = openDb(config.dbPath);
const { bot, runBrief } = createBot(store);

cron.schedule(
  config.syncCron,
  () => {
    syncWatchlist(store)
      .then((r) => console.log(`sync: ${r.synced.length} ok, ${r.failed.length} failed`))
      .catch((err) => console.error("sync failed:", err));
  },
  { timezone: config.timezone },
);

cron.schedule(
  config.briefCron,
  () => {
    if (!config.telegramOwnerId) return;
    runBrief(config.telegramOwnerId).catch((err) => console.error("scheduled brief failed:", err));
  },
  { timezone: config.timezone },
);

await bot.api.setMyCommands([
  { command: "brief", description: "Build this week's brief now" },
  { command: "watch", description: "Add creators to the watchlist" },
  { command: "unwatch", description: "Remove a creator" },
  { command: "watchlist", description: "Show tracked creators" },
  { command: "niche", description: "Set your niche" },
  { command: "pillars", description: "Set your content pillars" },
  { command: "inbox", description: "Ideas you've kept" },
]);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

console.log(
  `Bot running${demoMode ? " in demo mode" : ""}. Brief: "${config.briefCron}" (${config.timezone}).`,
);
await bot.start();
