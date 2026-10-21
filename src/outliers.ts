export interface Post {
  id: string;
  username: string;
  caption: string | null;
  mediaType: string | null;
  productType: string | null;
  permalink: string | null;
  imageUrl: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface Outlier {
  post: Post;
  metric: "views" | "engagement";
  value: number;
  baseline: number;
  ratio: number;
}

export interface OutlierOptions {
  now: Date;
  windowDays: number;
  minRatio: number;
  limit: number;
  /** Posts younger than this haven't finished collecting views yet. */
  minAgeHours?: number;
  minBaseline?: number;
  maxPerAccount?: number;
  exclude?: Set<string>;
}

const HOUR = 3_600_000;

/** Comments cost more effort than a like, so they count for more. */
export function engagement(post: Post): number | null {
  if (post.likes == null && post.comments == null) return null;
  return (post.likes ?? 0) + 3 * (post.comments ?? 0);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Scores each post against its own account's median, so a small creator's
 * breakout counts as much as a big creator's. Views are used when the account
 * reports them consistently; otherwise likes and comments.
 */
export function findOutliers(posts: Post[], opts: OutlierOptions): Outlier[] {
  const minAgeHours = opts.minAgeHours ?? 48;
  const minBaseline = opts.minBaseline ?? 5;
  const maxPerAccount = opts.maxPerAccount ?? 2;
  const now = opts.now.getTime();

  const byAccount = new Map<string, Post[]>();
  for (const post of posts) {
    const list = byAccount.get(post.username) ?? [];
    list.push(post);
    byAccount.set(post.username, list);
  }

  const scored: Outlier[] = [];
  for (const accountPosts of byAccount.values()) {
    const mature = accountPosts.filter(
      (p) => now - Date.parse(p.timestamp) >= minAgeHours * HOUR,
    );
    const viewed = mature.filter((p) => p.views != null);
    const metric = viewed.length >= minBaseline && viewed.length >= mature.length / 2
      ? "views"
      : "engagement";
    const valueOf = (p: Post) => (metric === "views" ? p.views : engagement(p));

    const measured = mature
      .map((post) => ({ post, value: valueOf(post) }))
      .filter((m): m is { post: Post; value: number } => m.value != null);

    for (const { post, value } of measured) {
      const age = now - Date.parse(post.timestamp);
      if (age > opts.windowDays * 24 * HOUR) continue;
      if (opts.exclude?.has(post.id)) continue;

      const others = measured.filter((m) => m.post.id !== post.id).map((m) => m.value);
      if (others.length < minBaseline) continue;
      const baseline = median(others);
      if (baseline <= 0) continue;

      const ratio = value / baseline;
      if (ratio >= opts.minRatio) scored.push({ post, metric, value, baseline, ratio });
    }
  }

  scored.sort((a, b) => b.ratio - a.ratio);

  const perAccount = new Map<string, number>();
  const picked: Outlier[] = [];
  for (const outlier of scored) {
    const count = perAccount.get(outlier.post.username) ?? 0;
    if (count >= maxPerAccount) continue;
    perAccount.set(outlier.post.username, count + 1);
    picked.push(outlier);
    if (picked.length >= opts.limit) break;
  }
  return picked;
}
