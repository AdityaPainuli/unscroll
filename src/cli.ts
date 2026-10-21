// Prints a brief to the terminal without Telegram: npm run brief -- @creator1 @creator2
import { buildBrief } from "./brief.ts";
import { formatIdea } from "./bot.ts";
import { config, demoMode } from "./config.ts";
import { openDb } from "./db.ts";
import { fetchAccount, normalizeUsername } from "./instagram.ts";

const store = openDb(config.dbPath);

for (const name of process.argv.slice(2).map(normalizeUsername)) {
  const snapshot = await fetchAccount(name);
  store.addAccount(snapshot.username, snapshot.followers);
}

if (demoMode) console.log("(demo mode: Instagram isn't connected, data is fake)\n");

const result = await buildBrief(store);
for (const f of result.sync.failed) console.log(`sync failed: ${f.reason}`);
if (!result.briefId) {
  console.log("No outliers found.");
  process.exit(0);
}

let n = 0;
for (let idea = store.nextUnsent(result.briefId); idea; idea = store.nextUnsent(result.briefId)) {
  store.setIdeaStatus(idea.id, "sent");
  console.log(formatIdea(idea, ++n, result.ideaCount).replace(/<[^>]+>/g, ""), "\n");
}
