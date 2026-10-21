import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Outlier } from "./outliers.ts";

export const IdeaBreakdown = z.object({
  hook: z.string().describe("The opening line or visual hook, rewritten to be reusable. Under 15 words."),
  format: z.string().describe("Format and structure, e.g. '30s talking reel, 3 tips, text overlay'."),
  why: z.string().describe("Why this post outperformed the creator's usual posts. One sentence."),
  angle: z.string().describe("A specific take the user could make in their own niche. One or two sentences."),
});
export type IdeaBreakdown = z.infer<typeof IdeaBreakdown>;

export interface Profile {
  niche?: string;
  pillars?: string;
}

const SYSTEM = `You help a creator turn other creators' breakout Instagram posts into ideas of their own.
You see one post that did far better than its creator's usual posts, plus the user's niche and content pillars.
Work out what made it land (hook, format, topic, emotion) and suggest how the user could make their own version.
Never suggest copying the post; the angle should fit the user's niche. Keep every field short and concrete.`;

let client: Anthropic | undefined;

export async function analyzeOutlier(outlier: Outlier, profile: Profile): Promise<IdeaBreakdown> {
  client ??= new Anthropic();
  const { post } = outlier;
  const details = [
    `Creator: @${post.username}`,
    `Type: ${post.productType ?? post.mediaType ?? "unknown"}`,
    `Performance: ${outlier.ratio.toFixed(1)}x this creator's median ${outlier.metric}`,
    `Caption:\n${post.caption?.trim() || "(no caption)"}`,
    "",
    `User's niche: ${profile.niche || "not set"}`,
    `User's content pillars: ${profile.pillars || "not set"}`,
  ].join("\n");

  const text: Anthropic.Beta.BetaContentBlockParam = { type: "text", text: details };
  const withImage: Anthropic.Beta.BetaContentBlockParam[] = post.imageUrl
    ? [{ type: "image", source: { type: "url", url: post.imageUrl } }, text]
    : [text];

  try {
    return await request(withImage);
  } catch (err) {
    // Instagram CDN links expire; retry from the caption alone.
    if (post.imageUrl && err instanceof Anthropic.BadRequestError) return request([text]);
    throw err;
  }
}

async function request(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<IdeaBreakdown> {
  const response = await client!.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(IdeaBreakdown) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no breakdown (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

/** Used when Claude isn't reachable, so the brief still goes out. */
export function fallbackBreakdown(outlier: Outlier): IdeaBreakdown {
  const caption = outlier.post.caption?.trim() ?? "";
  const firstLine = caption.split("\n")[0]?.slice(0, 120) || "(no caption)";
  return {
    hook: firstLine,
    format: (outlier.post.productType ?? outlier.post.mediaType ?? "post").toLowerCase(),
    why: `${outlier.ratio.toFixed(1)}x the creator's usual ${outlier.metric}.`,
    angle: "AI breakdown unavailable. Open the post and decide your own take.",
  };
}
