import { describe, expect, it } from "vitest";
import { engagement, findOutliers, median, type Post } from "./outliers.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY = 86_400_000;

function post(username: string, i: number, daysAgo: number, fields: Partial<Post>): Post {
  return {
    id: `${username}_${i}`,
    username,
    caption: null,
    mediaType: "VIDEO",
    productType: "REELS",
    permalink: null,
    imageUrl: null,
    timestamp: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    likes: null,
    comments: null,
    views: null,
    ...fields,
  };
}

/** Ten steady posts at `views`, one every 3 days starting `startDaysAgo`. */
function steady(username: string, views: number, startDaysAgo = 3): Post[] {
  return Array.from({ length: 10 }, (_, i) => post(username, i, startDaysAgo + i * 3, { views }));
}

const opts = { now: NOW, windowDays: 14, minRatio: 3, limit: 5 };

describe("median", () => {
  it("handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("engagement", () => {
  it("weights comments 3x and is null without data", () => {
    expect(engagement(post("a", 0, 0, { likes: 10, comments: 2 }))).toBe(16);
    expect(engagement(post("a", 0, 0, {}))).toBeNull();
  });
});

describe("findOutliers", () => {
  it("flags a post relative to its own account, not absolute size", () => {
    const small = [...steady("small", 1_000), post("small", 99, 5, { views: 5_000 })];
    const big = [...steady("big", 100_000), post("big", 99, 5, { views: 200_000 })];
    const result = findOutliers([...small, ...big], opts);
    expect(result.map((o) => o.post.id)).toEqual(["small_99"]);
    expect(result[0]!.ratio).toBe(5);
    expect(result[0]!.metric).toBe("views");
  });

  it("ignores posts outside the window and too young to judge", () => {
    const posts = [
      ...steady("a", 1_000),
      post("a", 98, 20, { views: 9_000 }),
      post("a", 99, 1, { views: 9_000 }),
    ];
    expect(findOutliers(posts, opts)).toEqual([]);
  });

  it("falls back to engagement when views are missing", () => {
    const posts = Array.from({ length: 8 }, (_, i) => post("a", i, 3 + i, { likes: 100, comments: 0 }));
    posts.push(post("a", 99, 4, { likes: 400, comments: 50 }));
    const [top] = findOutliers(posts, opts);
    expect(top!.metric).toBe("engagement");
    expect(top!.ratio).toBe(5.5);
  });

  it("needs enough history for a baseline", () => {
    const posts = [post("a", 0, 3, { views: 100 }), post("a", 1, 4, { views: 900 })];
    expect(findOutliers(posts, opts)).toEqual([]);
  });

  it("caps ideas per account and skips excluded posts", () => {
    const posts = [
      ...steady("a", 1_000, 30),
      post("a", 90, 3, { views: 8_000 }),
      post("a", 91, 4, { views: 7_000 }),
      post("a", 92, 5, { views: 6_000 }),
    ];
    expect(findOutliers(posts, opts).map((o) => o.post.id)).toEqual(["a_90", "a_91"]);
    expect(findOutliers(posts, { ...opts, exclude: new Set(["a_90"]) }).map((o) => o.post.id))
      .toEqual(["a_91", "a_92"]);
  });
});
