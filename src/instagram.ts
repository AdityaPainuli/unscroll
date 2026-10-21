import { config, demoMode } from "./config.ts";
import { demoAccount } from "./demo.ts";
import type { Post } from "./outliers.ts";

export interface AccountSnapshot {
  username: string;
  followers: number | null;
  posts: Post[];
}

export class InstagramError extends Error {}

const MEDIA_FIELDS = [
  "id", "caption", "media_type", "media_product_type", "permalink", "timestamp",
  "like_count", "comments_count", "view_count", "thumbnail_url", "media_url",
].join(",");

interface DiscoveryMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
  thumbnail_url?: string;
  media_url?: string;
}

interface DiscoveryResponse {
  business_discovery?: {
    username: string;
    followers_count?: number;
    media?: { data: DiscoveryMedia[] };
  };
  error?: { message: string; code?: number };
}

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "").toLowerCase();
}

/**
 * Reads another creator's or business account's public profile and recent
 * posts through Business Discovery. Personal accounts aren't reachable.
 */
export async function fetchAccount(username: string, mediaLimit = 30): Promise<AccountSnapshot> {
  if (demoMode) return demoAccount(username);

  const fields = `business_discovery.username(${username}){username,followers_count,media.limit(${mediaLimit}){${MEDIA_FIELDS}}}`;
  const url = new URL(`https://graph.facebook.com/${config.igGraphVersion}/${config.igUserId}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", config.igAccessToken);

  const res = await fetch(url);
  const body = (await res.json()) as DiscoveryResponse;
  if (!res.ok || body.error || !body.business_discovery) {
    const reason = body.error?.message ?? `HTTP ${res.status}`;
    throw new InstagramError(`Couldn't read @${username}: ${reason}`);
  }

  const bd = body.business_discovery;
  return {
    username: bd.username.toLowerCase(),
    followers: bd.followers_count ?? null,
    posts: (bd.media?.data ?? []).map((m) => ({
      id: m.id,
      username: bd.username.toLowerCase(),
      caption: m.caption ?? null,
      mediaType: m.media_type ?? null,
      productType: m.media_product_type ?? null,
      permalink: m.permalink ?? null,
      imageUrl: m.thumbnail_url ?? (m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM" ? m.media_url ?? null : null),
      timestamp: m.timestamp,
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null,
      views: m.view_count ?? null,
    })),
  };
}
