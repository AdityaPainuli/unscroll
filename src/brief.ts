import { analyzeOutlier, fallbackBreakdown } from "./analyze.ts";
import { config } from "./config.ts";
import type { Store } from "./db.ts";
import { fetchAccount } from "./instagram.ts";
import { findOutliers } from "./outliers.ts";

export interface SyncResult {
  synced: string[];
  failed: { username: string; reason: string }[];
}

export async function syncWatchlist(store: Store): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: [] };
  for (const account of store.listAccounts()) {
    try {
      const snapshot = await fetchAccount(account.username);
      store.upsertPosts(snapshot.posts);
      store.markSynced(account.username, snapshot.followers);
      result.synced.push(account.username);
    } catch (err) {
      result.failed.push({ username: account.username, reason: (err as Error).message });
    }
  }
  return result;
}

export interface BriefResult {
  briefId: number | null;
  ideaCount: number;
  sync: SyncResult;
  aiFailures: number;
}

/** Syncs the watchlist, picks this week's outliers, and stores them as a brief. */
export async function buildBrief(store: Store, now = new Date()): Promise<BriefResult> {
  const sync = await syncWatchlist(store);
  const usernames = store.listAccounts().map((a) => a.username);
  const outliers = findOutliers(store.postsFor(usernames), {
    now,
    windowDays: config.outlierWindowDays,
    minRatio: config.outlierMinRatio,
    limit: config.briefSize,
    exclude: store.usedPostIds(),
  });

  if (outliers.length === 0) return { briefId: null, ideaCount: 0, sync, aiFailures: 0 };

  const profile = { niche: store.getSetting("niche"), pillars: store.getSetting("pillars") };
  const breakdowns = await Promise.all(
    outliers.map((o) =>
      analyzeOutlier(o, profile).then(
        (b) => ({ ok: true as const, b }),
        (err: Error) => {
          console.error(`analysis failed for ${o.post.id}:`, err.message);
          return { ok: false as const, b: fallbackBreakdown(o) };
        },
      ),
    ),
  );

  const briefId = store.createBrief();
  outliers.forEach((o, i) => {
    const { b } = breakdowns[i]!;
    store.addIdea({
      source: "watchlist",
      post_id: o.post.id,
      brief_id: briefId,
      username: o.post.username,
      permalink: o.post.permalink,
      metric: o.metric,
      ratio: o.ratio,
      hook: b.hook,
      format: b.format,
      why: b.why,
      angle: b.angle,
      text: null,
    });
  });

  return {
    briefId,
    ideaCount: outliers.length,
    sync,
    aiFailures: breakdowns.filter((r) => !r.ok).length,
  };
}
