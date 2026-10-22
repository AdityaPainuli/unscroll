import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Post } from "./outliers.ts";

export type IdeaStatus = "new" | "sent" | "added" | "skipped";

export interface Idea {
  id: number;
  source: "watchlist" | "capture";
  post_id: string | null;
  brief_id: number | null;
  username: string | null;
  permalink: string | null;
  metric: string | null;
  ratio: number | null;
  hook: string | null;
  format: string | null;
  why: string | null;
  angle: string | null;
  text: string | null;
  note: string | null;
  status: IdeaStatus;
  created_at: string;
}

export type NewIdea = Omit<Idea, "id" | "status" | "created_at" | "note">;

export interface Account {
  username: string;
  followers: number | null;
  added_at: string;
  last_synced_at: string | null;
}

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      followers INTEGER,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      caption TEXT,
      media_type TEXT,
      product_type TEXT,
      permalink TEXT,
      image_url TEXT,
      timestamp TEXT NOT NULL,
      likes INTEGER,
      comments INTEGER,
      views INTEGER,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS posts_username ON posts (username, timestamp);
    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      post_id TEXT,
      brief_id INTEGER,
      username TEXT,
      permalink TEXT,
      metric TEXT,
      ratio REAL,
      hook TEXT,
      format TEXT,
      why TEXT,
      angle TEXT,
      text TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return new Store(db);
}

export class Store {
  constructor(private db: DatabaseSync) {}

  addAccount(username: string, followers: number | null) {
    this.db
      .prepare(
        `INSERT INTO accounts (username, followers) VALUES (?, ?)
         ON CONFLICT (username) DO UPDATE SET followers = excluded.followers`,
      )
      .run(username, followers);
  }

  removeAccount(username: string): boolean {
    return this.db.prepare(`DELETE FROM accounts WHERE username = ?`).run(username).changes > 0;
  }

  listAccounts(): Account[] {
    return this.db.prepare(`SELECT * FROM accounts ORDER BY username`).all() as unknown as Account[];
  }

  markSynced(username: string, followers: number | null) {
    this.db
      .prepare(`UPDATE accounts SET last_synced_at = datetime('now'), followers = ? WHERE username = ?`)
      .run(followers, username);
  }

  upsertPosts(posts: Post[]) {
    const stmt = this.db.prepare(`
      INSERT INTO posts (id, username, caption, media_type, product_type, permalink, image_url, timestamp, likes, comments, views)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        caption = excluded.caption, image_url = excluded.image_url,
        likes = excluded.likes, comments = excluded.comments, views = excluded.views,
        fetched_at = datetime('now')
    `);
    this.db.exec("BEGIN");
    try {
      for (const p of posts) {
        stmt.run(
          p.id, p.username, p.caption, p.mediaType, p.productType, p.permalink,
          p.imageUrl, p.timestamp, p.likes, p.comments, p.views,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  postsFor(usernames: string[]): Post[] {
    if (usernames.length === 0) return [];
    const marks = usernames.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT * FROM posts WHERE username IN (${marks}) ORDER BY timestamp DESC`)
      .all(...usernames) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      username: r.username as string,
      caption: r.caption as string | null,
      mediaType: r.media_type as string | null,
      productType: r.product_type as string | null,
      permalink: r.permalink as string | null,
      imageUrl: r.image_url as string | null,
      timestamp: r.timestamp as string,
      likes: r.likes as number | null,
      comments: r.comments as number | null,
      views: r.views as number | null,
    }));
  }

  usedPostIds(): Set<string> {
    const rows = this.db
      .prepare(`SELECT post_id FROM ideas WHERE post_id IS NOT NULL`)
      .all() as { post_id: string }[];
    return new Set(rows.map((r) => r.post_id));
  }

  createBrief(): number {
    return Number(this.db.prepare(`INSERT INTO briefs DEFAULT VALUES`).run().lastInsertRowid);
  }

  addIdea(idea: NewIdea): number {
    const result = this.db
      .prepare(
        `INSERT INTO ideas (source, post_id, brief_id, username, permalink, metric, ratio, hook, format, why, angle, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        idea.source, idea.post_id, idea.brief_id, idea.username, idea.permalink, idea.metric,
        idea.ratio, idea.hook, idea.format, idea.why, idea.angle, idea.text,
      );
    return Number(result.lastInsertRowid);
  }

  getIdea(id: number): Idea | undefined {
    return this.db.prepare(`SELECT * FROM ideas WHERE id = ?`).get(id) as Idea | undefined;
  }

  setIdeaStatus(id: number, status: IdeaStatus) {
    this.db.prepare(`UPDATE ideas SET status = ? WHERE id = ?`).run(status, id);
  }

  setIdeaNote(id: number, note: string) {
    this.db.prepare(`UPDATE ideas SET note = ? WHERE id = ?`).run(note, id);
  }

  /** Next idea of a brief still waiting to be shown, oldest first. */
  nextUnsent(briefId: number): Idea | undefined {
    return this.db
      .prepare(`SELECT * FROM ideas WHERE brief_id = ? AND status = 'new' ORDER BY id LIMIT 1`)
      .get(briefId) as Idea | undefined;
  }

  /** Idea of a brief that is on screen or waiting to be, oldest first. */
  nextPending(briefId: number): Idea | undefined {
    return this.db
      .prepare(`SELECT * FROM ideas WHERE brief_id = ? AND status IN ('new', 'sent') ORDER BY id LIMIT 1`)
      .get(briefId) as Idea | undefined;
  }

  latestBriefId(): number | null {
    const row = this.db.prepare(`SELECT MAX(id) AS id FROM briefs`).get() as { id: number | null };
    return row.id;
  }

  briefProgress(briefId: number): { position: number; total: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'new' THEN 1 ELSE 0 END) AS shown
         FROM ideas WHERE brief_id = ?`,
      )
      .get(briefId) as { total: number; shown: number | null };
    return { position: (row.shown ?? 0), total: row.total };
  }

  inbox(limit = 10): Idea[] {
    return this.db
      .prepare(
        `SELECT * FROM ideas WHERE status = 'added' ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as unknown as Idea[];
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}
