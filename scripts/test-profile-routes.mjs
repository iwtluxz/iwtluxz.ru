import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { syncProfileRoutes } from "./sync-profile-routes.mjs";

const template = '<!DOCTYPE html>\n<html><head><title>Profile</title><script src="profile.js?v=first" defer></script></head><body>Shared renderer</body></html>\n';
const config = 'window.IWTXZ_BACKEND_CONFIG = Object.freeze({provider:"supabase",url:"https://fixture.supabase.co",publishableKey:"sb_publishable_test"});';

async function fixture(t) {
  const parent = await import("node:fs/promises").then(fs => fs.realpath(tmpdir()));
  const root = await mkdtemp(join(parent, "iwtxz-profile-routes-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), parent);
    assert.ok(root.startsWith(join(parent, "iwtxz-profile-routes-")));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "backend-config.js"), config);
  await writeFile(join(root, "profile.html"), template);
  return root;
}

function api(rows, requests = []) {
  return async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    assert.equal(url.origin, "https://fixture.supabase.co");
    assert.equal(url.pathname, "/rest/v1/profile_published");
    assert.equal(url.searchParams.get("select"), "username");
    assert.equal(url.searchParams.get("order"), "username.asc");
    assert.equal(url.searchParams.get("limit"), "1000");
    assert.equal(options.headers.apikey, "sb_publishable_test");
    return Response.json(rows.slice(Number(url.searchParams.get("offset")), Number(url.searchParams.get("offset")) + 1000));
  };
}

async function generated(root, username, content = template) {
  await writeFile(join(root, `${username}.html`), content.replace("<!DOCTYPE html>", `<!DOCTYPE html>\n<!-- iwtxz-generated-profile-route: ${username} -->`));
}

test("creates a physical profile route from the shared renderer and is idempotent", async t => {
  const root = await fixture(t);
  const rows = [{ username: "tshk" }];
  assert.deepEqual(await syncProfileRoutes({ root, fetch: api(rows) }), { created: 1, updated: 0, removed: 0, skipped: 0 });
  const content = await readFile(join(root, "tshk.html"), "utf8");
  assert.match(content, /^<!DOCTYPE html>\n<!-- iwtxz-generated-profile-route: tshk -->\n/);
  assert.match(content, /<meta name="iwtxz-profile" content="tshk">/);
  assert.match(content, /Shared renderer/);
  assert.deepEqual(await syncProfileRoutes({ root, fetch: api(rows) }), { created: 0, updated: 0, removed: 0, skipped: 0 });
});

test("reads every API page before creating routes", async t => {
  const root = await fixture(t);
  const rows = Array.from({ length: 1001 }, (_, index) => ({ username: `user${String(index).padStart(4, "0")}` }));
  const requests = [];
  const result = await syncProfileRoutes({ root, fetch: api(rows, requests) });
  assert.equal(result.created, 1001);
  assert.deepEqual(requests.map(request => request.url.searchParams.get("offset")), ["0", "1000"]);
  assert.match(await readFile(join(root, "user1000.html"), "utf8"), /content="user1000"/);
});

test("preserves existing legacy pages, internal pages, asset names, and directories", async t => {
  const root = await fixture(t);
  for (const username of ["iwtlu", "shakzy", "strelokk", "index", "404"]) {
    await writeFile(join(root, `${username}.html`), `Hand-written ${username}`);
  }
  await mkdir(join(root, "people"));
  await writeFile(join(root, "builder.js"), "// application");
  const usernames = ["iwtlu", "shakzy", "strelokk", "index", "profile", "404", "people", "builder", "img", "aux", "com1"];
  const result = await syncProfileRoutes({ root, fetch: api(usernames.map(username => ({ username }))) });
  assert.equal(result.skipped, usernames.length);
  assert.equal(result.created, 0);
  assert.equal(await readFile(join(root, "profile.html"), "utf8"), template);
  assert.equal(await readFile(join(root, "iwtlu.html"), "utf8"), "Hand-written iwtlu");
  assert.equal(await readFile(join(root, "shakzy.html"), "utf8"), "Hand-written shakzy");
  assert.equal(await readFile(join(root, "strelokk.html"), "utf8"), "Hand-written strelokk");
});

test("removes only stale generated files after a complete successful fetch", async t => {
  const root = await fixture(t);
  await generated(root, "olduser");
  await writeFile(join(root, "legacy.html"), "Hand-written legacy");
  await writeFile(join(root, "mismatch.html"), "<!DOCTYPE html>\n<!-- iwtxz-generated-profile-route: other -->\n<html></html>");
  const result = await syncProfileRoutes({ root, fetch: api([]) });
  assert.equal(result.removed, 1);
  const files = await readdir(root);
  assert.ok(!files.includes("olduser.html"));
  assert.ok(files.includes("legacy.html"));
  assert.ok(files.includes("mismatch.html"));
});

test("does not write or remove routes when a later API page fails", async t => {
  const root = await fixture(t);
  await generated(root, "olduser");
  const rows = Array.from({ length: 1000 }, (_, index) => ({ username: `user${String(index).padStart(4, "0")}` }));
  const firstPage = api(rows);
  let calls = 0;
  await assert.rejects(syncProfileRoutes({ root, fetch: (...args) => ++calls === 1 ? firstPage(...args) : Promise.resolve(new Response("failed", { status: 503 })) }), /HTTP 503/);
  assert.ok((await readdir(root)).includes("olduser.html"));
  assert.ok(!(await readdir(root)).includes("user0000.html"));
});

test("rejects invalid, repeated, traversal, and malformed API data before any mutation", async t => {
  const root = await fixture(t);
  await generated(root, "olduser");
  const cases = [
    [{ username: "alice" }, { username: "../outside" }],
    [{ username: "alice" }, { username: "Alice" }],
    [{ username: "alice" }, { username: "alice" }],
    [{ username: "alice" }, {}],
    { message: "not an array" }
  ];
  for (const rows of cases) {
    await assert.rejects(syncProfileRoutes({ root, fetch: async () => Response.json(rows) }), /Invalid/);
    assert.ok((await readdir(root)).includes("olduser.html"));
    assert.ok(!(await readdir(root)).includes("alice.html"));
  }
  await assert.rejects(syncProfileRoutes({ root, fetch: async () => { throw new Error("offline"); } }), /Could not fetch/);
  await assert.rejects(syncProfileRoutes({ root, fetch: async () => new Response("not json") }), /Invalid profiles response/);
  assert.ok((await readdir(root)).includes("olduser.html"));
});

test("rebuilds generated pages when the shared template changes", async t => {
  const root = await fixture(t);
  const rows = [{ username: "alice" }];
  await syncProfileRoutes({ root, fetch: api(rows) });
  await writeFile(join(root, "profile.html"), template.replace("?v=first", "?v=second"));
  const result = await syncProfileRoutes({ root, fetch: api(rows) });
  assert.equal(result.updated, 1);
  const content = await readFile(join(root, "alice.html"), "utf8");
  assert.match(content, /profile\.js\?v=second/);
  assert.equal((content.match(/iwtxz-generated-profile-route/g) || []).length, 1);
});

test("refuses secret keys without making a network request", async t => {
  const root = await fixture(t);
  await generated(root, "olduser");
  await writeFile(join(root, "backend-config.js"), config.replace("sb_publishable_test", "sb_secret_test"));
  await assert.rejects(syncProfileRoutes({ root, fetch: async () => assert.fail("must not send a secret key") }), /publishable or anon key/);
  assert.ok((await readdir(root)).includes("olduser.html"));
});
