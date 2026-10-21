import type { AccountSnapshot } from "./instagram.ts";
import type { Post } from "./outliers.ts";

const CAPTIONS = [
  "3 things I wish I knew before starting. Save this for later.",
  "Stop doing this if you want to grow. Here's what works instead.",
  "My exact morning routine, minute by minute.",
  "I tried posting every day for 30 days. Honest results.",
  "The tool nobody talks about that saves me 5 hours a week.",
  "Unpopular opinion: you don't need more followers.",
  "Beginner vs pro: what actually changes.",
  "Answering your most asked question.",
  "Behind the scenes of how I plan a week of content.",
  "This one mistake cost me months.",
];

/** Deterministic fake account so the bot can be tried before Instagram is connected. */
export function demoAccount(username: string): AccountSnapshot {
  let seed = [...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  const base = 2000 + Math.floor(rand() * 20000);
  const now = Date.now();
  const posts: Post[] = Array.from({ length: 24 }, (_, i) => {
    const breakout = i === 2 || i === 5 ? 4 + rand() * 3 : 0.6 + rand() * 0.8;
    const views = Math.round(base * breakout);
    return {
      id: `demo_${username}_${i}`,
      username,
      caption: CAPTIONS[Math.floor(rand() * CAPTIONS.length)]!,
      mediaType: "VIDEO",
      productType: "REELS",
      permalink: null,
      imageUrl: null,
      timestamp: new Date(now - (i + 2.5) * 86_400_000 * 1.5).toISOString(),
      likes: Math.round(views * 0.05),
      comments: Math.round(views * 0.004),
      views,
    };
  });
  return { username, followers: base * 4, posts };
}
