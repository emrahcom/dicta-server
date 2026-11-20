import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { start } from "./helpers.ts";

test("answers health checks with 200 and nothing else", async (t) => {
  const { http, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const get = await fetch(`${http}/dicta/health?probe=1`);
  const head = await fetch(`${http}/dicta/health`, { method: "HEAD" });
  const post = await fetch(`${http}/dicta/health`, { method: "POST" });
  const other = await fetch(`${http}/dicta/other`);
  const malformed = await fetch(`${http}//x:99999`);

  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "text/plain");
  assert.equal(await get.text(), "ok");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(post.status, 404);
  assert.equal(other.status, 404);
  assert.equal(malformed.status, 404);
  assert.equal(logged.mock.callCount(), 0);
});

// A temporary folder like the built dicta-js, in a folder of its own that is
// removed after the test, with a .js file next to it.
function jsFolder(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "dicta-server-test-"));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, "outside.js"), "// outside");
  const folder = join(root, "js");
  mkdirSync(join(folder, "audio"), { recursive: true });
  writeFileSync(join(folder, "index.js"), "export {};");
  writeFileSync(join(folder, "audio", "worklet.js"), "// worklet");
  writeFileSync(join(folder, "index.d.ts"), "export {};");
  return folder;
}

test("serves the dicta-js files under /dicta/js/", async (t) => {
  const { http, shutdown } = await start({ jsFolder: jsFolder(t) });
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const index = await fetch(`${http}/dicta/js/index.js`);
  const worklet = await fetch(`${http}/dicta/js/audio/worklet.js?v=1`);
  const head = await fetch(`${http}/dicta/js/index.js`, { method: "HEAD" });

  assert.equal(index.status, 200);
  assert.equal(await index.text(), "export {};");
  assert.equal(index.headers.get("content-type"), "text/javascript");
  assert.equal(index.headers.get("cache-control"), "no-cache");
  assert.equal(index.headers.get("access-control-allow-origin"), "*");
  assert.match(index.headers.get("etag") ?? "", /^"[\w-]+"$/);
  assert.equal(worklet.status, 200);
  assert.equal(await worklet.text(), "// worklet");
  assert.notEqual(worklet.headers.get("etag"), index.headers.get("etag"));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(logged.mock.callCount(), 0);
});

test("answers 304 while the browser's copy is current", async (t) => {
  const { http, shutdown } = await start({ jsFolder: jsFolder(t) });
  t.after(shutdown);
  const url = `${http}/dicta/js/index.js`;
  const etag = (await fetch(url)).headers.get("etag")!;

  const current = await fetch(url, { headers: { "if-none-match": etag } });
  const weak = await fetch(url, {
    headers: { "if-none-match": `"other", W/${etag}` },
  });
  const changed = await fetch(url, { headers: { "if-none-match": '"other"' } });

  assert.equal(current.status, 304);
  assert.equal(await current.text(), "");
  assert.equal(current.headers.get("etag"), etag);
  assert.equal(weak.status, 304);
  assert.equal(changed.status, 200);
});

// The status for a path sent as it is; fetch would resolve "..".
function rawStatus(http: string, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(`${http}/`, { path }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
}

test("serves nothing else under /dicta/js/", async (t) => {
  const { http, shutdown } = await start({ jsFolder: jsFolder(t) });
  t.after(shutdown);

  const statuses = await Promise.all([
    fetch(`${http}/dicta/js/missing.js`),
    fetch(`${http}/dicta/js/index.d.ts`),
    fetch(`${http}/dicta/js/`),
    fetch(`${http}/dicta/js/index.js`, { method: "POST" }),
  ]).then((responses) => responses.map((response) => response.status));

  assert.deepEqual(statuses, [404, 404, 404, 404]);
  assert.equal(await rawStatus(http, "/dicta/js/../outside.js"), 404);
  assert.equal(await rawStatus(http, "/dicta/js/audio/../index.js"), 404);
});

test("serves no dicta-js files without the folder", async (t) => {
  const { http, shutdown } = await start({
    jsFolder: join(tmpdir(), "dicta-js-missing"),
  });
  t.after(shutdown);

  const response = await fetch(`${http}/dicta/js/index.js`);

  assert.equal(response.status, 404);
});
