import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Store } from "./db.ts";
import { startWeb } from "./web.ts";

let store: Store;
let server: ReturnType<typeof startWeb>;
let base: string;

beforeEach(async () => {
  store = openDb(":memory:");
  server = startWeb(store, 0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
});

function post(path: string, form: Record<string, string>) {
  return fetch(base + path, { method: "POST", body: new URLSearchParams(form), redirect: "manual" });
}

function addBriefIdea(hook: string): number {
  const briefId = store.createBrief();
  return store.addIdea({
    source: "watchlist", post_id: "p1", brief_id: briefId, username: "creator",
    permalink: "javascript:alert(1)", metric: "views", ratio: 4.2,
    hook, format: "Reel", why: "Because", angle: "Yours", text: null,
  });
}

describe("web interface", () => {
  it("shows one idea at a time and escapes its text", async () => {
    const id = addBriefIdea("<script>alert(1)</script>");
    const html = await (await fetch(`${base}/brief`)).text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(store.getIdea(id)?.status).toBe("sent");
  });

  it("adds an idea with an angle, once", async () => {
    const id = addBriefIdea("Hook");
    await fetch(`${base}/brief`);

    const res = await post(`/ideas/${id}`, { action: "angle", note: "my take" });
    expect(res.status).toBe(303);
    expect(store.getIdea(id)).toMatchObject({ status: "added", note: "my take" });

    const again = await post(`/ideas/${id}`, { action: "skip" });
    expect(decodeURIComponent(again.headers.get("location") ?? "")).toContain("Already handled.");
    expect(store.getIdea(id)?.status).toBe("added");
  });

  it("adds and removes creators", async () => {
    await post("/watchlist/add", { names: "@Some.Creator" });
    expect(store.listAccounts().map((a) => a.username)).toEqual(["some.creator"]);
    await post("/watchlist/remove", { username: "some.creator" });
    expect(store.listAccounts()).toEqual([]);
  });

  it("rejects posts from other sites", async () => {
    const res = await fetch(`${base}/watchlist/add`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ names: "x" }),
    });
    expect(res.status).toBe(403);
    expect(store.listAccounts()).toEqual([]);
  });

  it("rejects foreign Host headers", async () => {
    const { port } = server.address() as AddressInfo;
    const req = request({ host: "127.0.0.1", port, path: "/brief", headers: { Host: "evil.example" } });
    req.end();
    const [res] = await once(req, "response");
    expect(res.statusCode).toBe(403);
    res.resume();
  });
});
