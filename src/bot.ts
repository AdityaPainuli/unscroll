import { Bot, InlineKeyboard, type Context } from "grammy";
import { buildBrief } from "./brief.ts";
import { config, demoMode } from "./config.ts";
import type { Idea, Store } from "./db.ts";
import { fetchAccount, normalizeUsername } from "./instagram.ts";

const USERNAME = /^[a-z0-9._]{1,30}$/;

const HELP = `<b>Unscroll</b>
Your weekly ideas, without opening Instagram.

/brief  build this week's brief now
/watch @a @b  add creators to the watchlist
/unwatch @a  remove a creator
/watchlist  show who's tracked
/niche text  set your niche
/pillars a; b; c  set your content pillars
/inbox  ideas you've kept

Any other message is saved to your inbox as an idea.`;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function args(ctx: Context): string {
  return typeof ctx.match === "string" ? ctx.match.trim() : "";
}

export function createBot(store: Store) {
  const bot = new Bot(config.telegramToken);
  let awaitingNoteFor: number | null = null;
  let briefRunning = false;

  bot.command("whoami", (ctx) => ctx.reply(`Your Telegram user id is ${ctx.from?.id}.`));

  bot.use(async (ctx, next) => {
    if (!config.telegramOwnerId) {
      await ctx.reply("Set TELEGRAM_OWNER_ID in .env to your id (send /whoami), then restart.");
      return;
    }
    if (ctx.from?.id !== config.telegramOwnerId) return;
    await next();
  });

  bot.command(["start", "help"], (ctx) =>
    ctx.reply(HELP + (demoMode ? "\n\n<i>Demo mode: Instagram isn't connected, data is fake.</i>" : ""), {
      parse_mode: "HTML",
    }),
  );

  bot.command("niche", async (ctx) => {
    const value = args(ctx);
    if (!value) return ctx.reply(`Current niche: ${store.getSetting("niche") ?? "not set"}`);
    store.setSetting("niche", value);
    await ctx.reply("Niche saved.");
  });

  bot.command("pillars", async (ctx) => {
    const value = args(ctx);
    if (!value) return ctx.reply(`Current pillars: ${store.getSetting("pillars") ?? "not set"}`);
    store.setSetting("pillars", value);
    await ctx.reply("Pillars saved.");
  });

  bot.command("watch", async (ctx) => {
    const names = args(ctx).split(/[\s,]+/).filter(Boolean).map(normalizeUsername);
    if (names.length === 0) return ctx.reply("Usage: /watch @creator1 @creator2");
    const lines: string[] = [];
    for (const name of names) {
      if (!USERNAME.test(name)) {
        lines.push(`@${name}: not a valid username`);
        continue;
      }
      try {
        const snapshot = await fetchAccount(name);
        store.addAccount(snapshot.username, snapshot.followers);
        store.upsertPosts(snapshot.posts);
        store.markSynced(snapshot.username, snapshot.followers);
        lines.push(`@${snapshot.username}: added (${snapshot.posts.length} posts)`);
      } catch (err) {
        lines.push(`@${name}: ${(err as Error).message}. Only creator and business accounts work.`);
      }
    }
    await ctx.reply(lines.join("\n"));
  });

  bot.command("unwatch", async (ctx) => {
    const name = normalizeUsername(args(ctx));
    await ctx.reply(store.removeAccount(name) ? `Removed @${name}.` : `@${name} isn't on the watchlist.`);
  });

  bot.command("watchlist", async (ctx) => {
    const accounts = store.listAccounts();
    if (accounts.length === 0) return ctx.reply("Watchlist is empty. Add creators with /watch @name");
    await ctx.reply(
      accounts
        .map((a) => `@${a.username}${a.followers ? ` (${a.followers.toLocaleString()} followers)` : ""}`)
        .join("\n"),
    );
  });

  bot.command("inbox", async (ctx) => {
    const ideas = store.inbox(10);
    if (ideas.length === 0) return ctx.reply("Inbox is empty.");
    const lines = ideas.map((i) => {
      const title = i.hook ?? i.text ?? "(untitled)";
      return `• ${esc(title.slice(0, 100))}${i.note ? `\n   <i>${esc(i.note.slice(0, 100))}</i>` : ""}`;
    });
    await ctx.reply(`<b>Latest kept ideas</b>\n${lines.join("\n")}`, { parse_mode: "HTML" });
  });

  bot.command("brief", async (ctx) => {
    if (briefRunning) return ctx.reply("A brief is already being built.");
    await ctx.reply("Building your brief. This takes a minute.");
    // Not awaited: grammY handles updates one at a time, and buttons must stay responsive.
    void runBrief(ctx.chat.id).catch((err) => {
      console.error("brief failed:", err);
      return bot.api.sendMessage(ctx.chat.id, `Brief failed: ${(err as Error).message}`);
    });
  });

  bot.callbackQuery(/^(add|skip|angle):(\d+)$/, async (ctx) => {
    const [, action, rawId] = ctx.match;
    const id = Number(rawId);
    const idea = store.getIdea(id);
    if (!idea || idea.status !== "sent") return ctx.answerCallbackQuery("Already handled.");

    if (action === "angle") {
      awaitingNoteFor = id;
      await ctx.answerCallbackQuery();
      return ctx.reply("Send your angle for this idea.");
    }

    store.setIdeaStatus(id, action === "add" ? "added" : "skipped");
    await ctx.answerCallbackQuery(action === "add" ? "Added to inbox" : "Skipped");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await sendNext(ctx.chat!.id, idea.brief_id!);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return ctx.reply("Unknown command. Send /help.");

    if (awaitingNoteFor !== null) {
      const idea = store.getIdea(awaitingNoteFor);
      awaitingNoteFor = null;
      if (idea) {
        store.setIdeaNote(idea.id, text);
        store.setIdeaStatus(idea.id, "added");
        await ctx.reply("Added with your angle.");
        if (idea.brief_id) await sendNext(ctx.chat.id, idea.brief_id);
        return;
      }
    }

    const id = store.addIdea({
      source: "capture", post_id: null, brief_id: null, username: null,
      permalink: text.match(/https?:\/\/\S+/)?.[0] ?? null,
      metric: null, ratio: null, hook: null, format: null, why: null, angle: null, text,
    });
    store.setIdeaStatus(id, "added");
    await ctx.reply("Saved to inbox.");
  });

  async function runBrief(chatId: number) {
    briefRunning = true;
    try {
      const result = await buildBrief(store);
      const problems = result.sync.failed.map((f) => `• ${f.reason}`);
      if (result.aiFailures) problems.push(`• AI breakdown failed for ${result.aiFailures} idea(s)`);
      if (problems.length) await bot.api.sendMessage(chatId, `Heads up:\n${problems.join("\n")}`);

      if (!result.briefId) {
        const hint = store.listAccounts().length === 0
          ? "Your watchlist is empty. Add creators with /watch @name."
          : "No breakout posts this week. Try adding more creators with /watch.";
        await bot.api.sendMessage(chatId, hint);
        return;
      }
      await bot.api.sendMessage(chatId, `This week: ${result.ideaCount} ideas. One at a time.`);
      await sendNext(chatId, result.briefId);
    } finally {
      briefRunning = false;
    }
  }

  async function sendNext(chatId: number, briefId: number) {
    const idea = store.nextUnsent(briefId);
    if (!idea) {
      const kept = store.inbox(100).filter((i) => i.brief_id === briefId).length;
      await bot.api.sendMessage(chatId, `Brief done. You kept ${kept}. See them with /inbox.`);
      return;
    }
    store.setIdeaStatus(idea.id, "sent");
    const { position, total } = store.briefProgress(briefId);
    const keyboard = new InlineKeyboard()
      .text("Add", `add:${idea.id}`)
      .text("Skip", `skip:${idea.id}`)
      .row()
      .text("Add with my angle", `angle:${idea.id}`);
    await bot.api.sendMessage(chatId, formatIdea(idea, position, total), {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  }

  return { bot, runBrief };
}

export function formatIdea(idea: Idea, position: number, total: number): string {
  const stat = idea.ratio ? ` · ${idea.ratio.toFixed(1)}x ${idea.metric}` : "";
  const lines = [
    `<b>Idea ${position} of ${total}</b> · @${esc(idea.username ?? "")}${stat}`,
    "",
    `<b>Hook:</b> ${esc(idea.hook ?? "")}`,
    `<b>Format:</b> ${esc(idea.format ?? "")}`,
    `<b>Why it worked:</b> ${esc(idea.why ?? "")}`,
    `<b>Your angle:</b> ${esc(idea.angle ?? "")}`,
  ];
  if (idea.permalink) lines.push("", `<a href="${esc(idea.permalink)}">Open this one post</a>`);
  return lines.join("\n");
}
