import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buildBrief, isBriefRunning, watchAccount, withBriefLock } from "./brief.ts";
import { demoMode } from "./config.ts";
import type { Idea, Store } from "./db.ts";
import { normalizeUsername } from "./instagram.ts";

const INBOX_SIZE = 10;
const MAX_BODY = 16_000;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Local web interface: fetch and triage a brief, read the inbox, edit the watchlist. */
export function startWeb(store: Store, port: number, host = "127.0.0.1"): Server {
  // Messages from the last web-triggered build, shown once on the next visit to the brief page.
  let notes: string[] = [];

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error("web:", err);
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err instanceof HttpError ? err.message : "Something went wrong.");
    });
  });

  server.on("error", (err) => console.error(`Web interface failed to start: ${err.message}`));
  server.listen(port, host, () => {
    console.log(`Web interface at http://localhost:${(server.address() as AddressInfo).port}`);
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    checkOrigin(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    const msg = url.searchParams.get("msg") ?? undefined;
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /") return redirect(res, "/brief");
    if (route === "GET /brief") return send(res, page("Brief", briefView(msg)));
    if (route === "GET /inbox") return send(res, page("Inbox", inboxView(msg)));
    if (route === "GET /watchlist") return send(res, page("Watchlist", watchlistView(msg)));

    if (req.method !== "POST") throw new HttpError(404, "Not found.");
    const form = await readForm(req);

    if (url.pathname === "/brief/build") {
      startBuild();
      return redirect(res, "/brief");
    }

    const ideaMatch = url.pathname.match(/^\/ideas\/(\d+)$/);
    if (ideaMatch) return redirect(res, `/brief${flash(triage(Number(ideaMatch[1]), form))}`);

    if (url.pathname === "/watchlist/add") {
      const names = (form.get("names") ?? "").split(/[\s,]+/).filter(Boolean);
      const lines: string[] = [];
      for (const name of names) lines.push(await watchAccount(store, name));
      return redirect(res, `/watchlist${flash(lines.join("\n") || "Type at least one username.")}`);
    }

    if (url.pathname === "/watchlist/remove") {
      const name = normalizeUsername(form.get("username") ?? "");
      const removed = store.removeAccount(name);
      return redirect(res, `/watchlist${flash(removed ? `Removed @${name}.` : `@${name} isn't on the watchlist.`)}`);
    }

    throw new HttpError(404, "Not found.");
  }

  /**
   * Bound to localhost, but a web page in the browser can still send requests here.
   * Rejecting foreign Host headers stops DNS rebinding, and checking Origin stops
   * other sites from posting forms.
   */
  function checkOrigin(req: IncomingMessage) {
    const { port: actual } = server.address() as AddressInfo;
    const allowed = [`localhost:${actual}`, `127.0.0.1:${actual}`];
    if (!allowed.includes(req.headers.host ?? "")) throw new HttpError(403, "Forbidden host.");
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin && !allowed.some((h) => origin === `http://${h}`)) {
      throw new HttpError(403, "Forbidden origin.");
    }
  }

  function startBuild() {
    if (isBriefRunning()) return;
    notes = [];
    void withBriefLock(async () => {
      const result = await buildBrief(store);
      const problems = result.sync.failed.map((f) => f.reason);
      if (result.aiFailures) problems.push(`AI breakdown failed for ${result.aiFailures} idea(s).`);
      if (!result.briefId) {
        problems.push(
          store.listAccounts().length === 0
            ? "Your watchlist is empty. Add creators on the Watchlist page."
            : "No breakout posts this week. Try adding more creators.",
        );
      }
      notes = problems;
    }).catch((err) => {
      console.error("brief failed:", err);
      notes = [`Brief failed: ${(err as Error).message}`];
    });
  }

  function triage(id: number, form: URLSearchParams): string | undefined {
    const idea = store.getIdea(id);
    if (!idea || idea.status !== "sent") return "Already handled.";
    const action = form.get("action");
    if (action === "angle") {
      const note = (form.get("note") ?? "").trim();
      if (!note) return "Write your angle first, or just press Add.";
      store.setIdeaNote(id, note);
      store.setIdeaStatus(id, "added");
      return "Added with your angle.";
    }
    if (action === "add" || action === "skip") {
      store.setIdeaStatus(id, action === "add" ? "added" : "skipped");
      return undefined;
    }
    throw new HttpError(400, "Unknown action.");
  }

  function briefView(msg?: string): string {
    if (isBriefRunning()) {
      return `<p>Building your brief. This takes a minute, the page will update by itself.</p>`;
    }

    const shown = notes.length ? `<div class="note">${notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : "";
    notes = [];
    const flashed = msg ? `<p class="flash">${esc(msg)}</p>` : "";
    const buildButton = (label: string) =>
      `<form method="post" action="/brief/build"><button>${label}</button></form>`;

    const briefId = store.latestBriefId();
    let idea = briefId ? store.nextPending(briefId) : undefined;
    if (!idea) {
      const kept = briefId ? store.inbox(100).filter((i) => i.brief_id === briefId).length : 0;
      const done = briefId && !shown ? `<p>Brief done. You kept ${kept}.</p>` : "";
      return `${flashed}${shown}${done}${buildButton("Build a brief now")}`;
    }

    if (idea.status === "new") {
      store.setIdeaStatus(idea.id, "sent");
      idea = { ...idea, status: "sent" };
    }
    const { position, total } = store.briefProgress(briefId!);
    return `${flashed}${shown}${ideaCard(idea, position, total)}`;
  }

  function inboxView(msg?: string): string {
    const ideas = store.inbox(INBOX_SIZE);
    const flashed = msg ? `<p class="flash">${esc(msg)}</p>` : "";
    if (ideas.length === 0) return `${flashed}<p>Inbox is empty.</p>`;
    const items = ideas.map((i) => {
      const title = i.hook ?? i.text ?? "(untitled)";
      const link = safeUrl(i.permalink);
      return `<li>
        <p>${esc(title)}</p>
        ${i.username ? `<p class="meta">@${esc(i.username)}</p>` : ""}
        ${i.note ? `<p class="angle">${esc(i.note)}</p>` : ""}
        ${link ? `<p><a href="${esc(link)}" rel="noreferrer">Open post</a></p>` : ""}
      </li>`;
    });
    return `${flashed}<p class="meta">Latest ${ideas.length} kept ideas.</p><ul class="list">${items.join("")}</ul>`;
  }

  function watchlistView(msg?: string): string {
    const flashed = msg ? `<pre class="flash">${esc(msg)}</pre>` : "";
    const accounts = store.listAccounts();
    const rows = accounts.map(
      (a) => `<li class="row">
        <span>@${esc(a.username)}${a.followers ? ` <span class="meta">${a.followers.toLocaleString()} followers</span>` : ""}</span>
        <form method="post" action="/watchlist/remove">
          <input type="hidden" name="username" value="${esc(a.username)}">
          <button class="secondary">Remove</button>
        </form>
      </li>`,
    );
    return `${flashed}
      <form method="post" action="/watchlist/add" class="row">
        <input name="names" placeholder="@creator1 @creator2" autocomplete="off" required>
        <button>Add</button>
      </form>
      ${accounts.length ? `<ul class="list">${rows.join("")}</ul>` : "<p>Watchlist is empty.</p>"}
      <p class="meta">Only creator and business accounts work.</p>`;
  }

  return server;
}

function ideaCard(idea: Idea, position: number, total: number): string {
  const stat = idea.ratio ? ` · ${idea.ratio.toFixed(1)}x ${esc(idea.metric ?? "")}` : "";
  const link = safeUrl(idea.permalink);
  return `<article>
    <p class="meta">Idea ${position} of ${total} · @${esc(idea.username ?? "")}${stat}</p>
    <dl>
      <dt>Hook</dt><dd>${esc(idea.hook ?? "")}</dd>
      <dt>Format</dt><dd>${esc(idea.format ?? "")}</dd>
      <dt>Why it worked</dt><dd>${esc(idea.why ?? "")}</dd>
      <dt>Your angle</dt><dd>${esc(idea.angle ?? "")}</dd>
    </dl>
    ${link ? `<p><a href="${esc(link)}" rel="noreferrer">Open this one post</a></p>` : ""}
    <form method="post" action="/ideas/${idea.id}">
      <div class="row">
        <button name="action" value="add">Add</button>
        <button name="action" value="skip" class="secondary">Skip</button>
      </div>
      <label for="note">Add with my angle</label>
      <textarea id="note" name="note" rows="3"></textarea>
      <button name="action" value="angle">Add with my angle</button>
    </form>
  </article>`;
}

function flash(msg: string | undefined): string {
  return msg ? `?msg=${encodeURIComponent(msg)}` : "";
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new HttpError(413, "Too much text.");
  }
  return new URLSearchParams(body);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location });
  res.end();
}

function send(res: ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    // Not no-referrer: that makes browsers send `Origin: null`, which checkOrigin rejects.
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function page(title: string, body: string): string {
  const nav = ["Brief", "Inbox", "Watchlist"]
    .map((t) => `<a href="/${t.toLowerCase()}"${t === title ? ' aria-current="page"' : ""}>${t}</a>`)
    .join("");
  const refresh = title === "Brief" && isBriefRunning() ? `<meta http-equiv="refresh" content="3">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>${title} · Unscroll</title>
<style>
  :root { --bg: #fafaf8; --fg: #1d1d1b; --muted: #6b6b66; --line: #e2e2dc; --accent: #2f5d50; --note: #f1efe6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #161615; --fg: #ececea; --muted: #9a9a94; --line: #2e2e2b; --accent: #7fb8a4; --note: #22221f; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 36rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  nav { display: flex; gap: 1.25rem; margin-bottom: 2rem; }
  nav a { color: var(--muted); text-decoration: none; }
  nav a[aria-current] { color: var(--fg); font-weight: 600; }
  a { color: var(--accent); }
  .meta { color: var(--muted); font-size: 0.9rem; }
  .flash, .note { background: var(--note); padding: 0.75rem 1rem; border-radius: 6px; white-space: pre-wrap; font: inherit; }
  .note p { margin: 0.25rem 0; }
  dt { font-weight: 600; margin-top: 1rem; }
  dd { margin: 0.25rem 0 0; }
  .row { display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; }
  .list { list-style: none; padding: 0; }
  .list li { border-top: 1px solid var(--line); padding: 0.75rem 0; }
  .list p { margin: 0.2rem 0; }
  .angle { font-style: italic; }
  form { margin: 1rem 0; }
  label { display: block; margin-top: 1.5rem; color: var(--muted); font-size: 0.9rem; }
  textarea, input { width: 100%; padding: 0.5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
  textarea { margin: 0.4rem 0 0.5rem; }
  button { padding: 0.5rem 1rem; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: var(--bg); font: inherit; cursor: pointer; white-space: nowrap; }
  button.secondary { background: transparent; color: var(--accent); }
  form .row { justify-content: flex-start; }
</style>
</head>
<body>
<main>
<nav>${nav}</nav>
${demoMode ? `<p class="meta">Demo mode: Instagram isn't connected, data is fake.</p>` : ""}
${body}
</main>
</body>
</html>`;
}
