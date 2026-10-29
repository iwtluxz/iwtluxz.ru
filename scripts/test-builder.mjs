import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startDevServer } from "./dev-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aLMsAAAAASUVORK5CYII=", "base64");

test("profile accounts, files, drafts and publication work through the real HTTP API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "iwtxz-builder-test-"));
  const { server, url } = await startDevServer({ root, dataDir: directory, port: 0 });
  let aliceCookie = "";
  let bobCookie = "";
  let avatarUrl = "";
  const username = `qa_${Date.now().toString(36)}`;
  const secondUsername = `${username}_b`;
  const password = "Test-only-password-927!";
  const request = async (path, { method = "GET", cookie = "", body, headers = {}, raw = false } = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        origin: url,
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
    return response;
  };
  const cookieFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  const decode = (response) => response.json();

  try {
    await t.test("static server hides configuration and private files", async () => {
      assert.equal((await request("/")).status, 200);
      for (const path of ["/.env", "/.env.example", "/package.json", "/.local-data/builder-users/users.json", "/netlify/functions/builder-auth.mjs", "/scripts/dev-server.mjs"]) {
        assert.equal((await request(path)).status, 404, path);
      }
    });

    await t.test("registration creates a real HttpOnly session and rejects duplicate/reserved users", async () => {
      const response = await request("/api/builder/auth/signup", { method: "POST", body: { username, password } });
      assert.equal(response.status, 201);
      assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
      assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);
      aliceCookie = cookieFrom(response);
      assert.equal((await decode(response)).user.username, username);
      const me = await decode(await request("/api/builder/auth/me", { cookie: aliceCookie }));
      assert.equal(me.user.username, username);
      assert.equal((await request("/api/builder/auth/signup", { method: "POST", body: { username, password } })).status, 409);
      assert.ok([400, 403, 409].includes((await request("/api/builder/auth/signup", { method: "POST", body: { username: "iwtlu", password } })).status));
      assert.equal((await request("/api/builder/sites/list")).status, 401);
    });

    await t.test("mutations reject another origin and login rejects a wrong password", async () => {
      const crossOrigin = await request("/api/builder/sites/save", { method: "POST", cookie: aliceCookie, body: { site: {} }, headers: { origin: "https://example.invalid" } });
      assert.equal(crossOrigin.status, 403);
      const badLogin = await request("/api/builder/auth/login", { method: "POST", body: { username, password: "wrong-password" } });
      assert.equal(badLogin.status, 401);
      const goodLogin = await request("/api/builder/auth/login", { method: "POST", body: { username, password } });
      assert.equal(goodLogin.status, 200);
      aliceCookie = cookieFrom(goodLogin);
    });

    await t.test("binary uploads retain bytes, support seeking and reject active document types", async () => {
      const response = await request("/api/builder/assets/upload?kind=avatar&name=pixel.png", { method: "POST", cookie: aliceCookie, raw: true, body: pixel, headers: { "content-type": "image/png" } });
      assert.equal(response.status, 201);
      const asset = await decode(response);
      avatarUrl = asset.url;
      assert.match(avatarUrl, new RegExp(`^/api/builder/assets/file/${username}/`));
      const download = await request(avatarUrl);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), pixel);
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      const range = await request(avatarUrl, { headers: { range: "bytes=0-3" } });
      assert.equal(range.status, 206);
      assert.equal(Number(range.headers.get("content-length")), 4);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), pixel.subarray(0, 4));
      const active = await request("/api/builder/assets/upload?kind=avatar&name=evil.svg", { method: "POST", cookie: aliceCookie, raw: true, body: "<svg onload='alert(1)'></svg>", headers: { "content-type": "image/svg+xml" } });
      assert.ok([400, 415].includes(active.status));
      const oversized = await request("/api/builder/assets/upload?kind=music&name=large.mp3", { method: "POST", cookie: aliceCookie, raw: true, body: Buffer.alloc(4 * 1024 * 1024 + 1), headers: { "content-type": "audio/mpeg" } });
      assert.equal(oversized.status, 413);
    });

    await t.test("saving a draft leaves the public page unchanged until publication", async () => {
      assert.equal((await request(`/api/builder/profile/${username}`)).status, 404);
      const listing = await decode(await request("/api/builder/sites/list", { cookie: aliceCookie }));
      assert.equal(listing.sites.length, 1);
      const draft = { ...listing.sites[0], nickname: "Первый ник", description: "Тестовая страница", avatar: avatarUrl, avatarSize: 180, music: "sound/sound.mp3", musicTitle: "Проверочный трек", background: "img/background.mp4", backgroundType: "video", backgroundDim: 60, entryText: "Войти", musicLoop: false };
      const saved = await decode(await request("/api/builder/sites/save", { method: "POST", cookie: aliceCookie, body: { site: draft } }));
      assert.equal(saved.site.owner, username);
      assert.equal(saved.site.avatarSize, 180);
      assert.equal((await request(`/api/builder/profile/${username}`)).status, 404);
      const published = await request("/api/builder/publish", { method: "POST", cookie: aliceCookie, body: {} });
      assert.equal(published.status, 200);
      assert.equal((await decode(published)).url, `/u/${username}`);
      const publicSite = await decode(await request(`/api/builder/profile/${username}`));
      assert.equal(publicSite.site.nickname, "Первый ник");
      await request("/api/builder/sites/save", { method: "POST", cookie: aliceCookie, body: { site: { ...saved.site, nickname: "Новый черновик" } } });
      assert.equal((await decode(await request(`/api/builder/profile/${username}`))).site.nickname, "Первый ник");
      assert.equal((await request(`/u/${username}`)).status, 200);
    });

    await t.test("another account cannot read or overwrite someone else's profile", async () => {
      const response = await request("/api/builder/auth/signup", { method: "POST", body: { username: secondUsername, password } });
      assert.equal(response.status, 201);
      bobCookie = cookieFrom(response);
      const forged = await request("/api/builder/sites/save", { method: "POST", cookie: bobCookie, body: { site: { id: username, owner: username, nickname: "Попытка подмены" } } });
      assert.equal(forged.status, 403);
      const saved = await decode(await request("/api/builder/sites/save", { method: "POST", cookie: bobCookie, body: { site: { nickname: "Своя страница" } } }));
      assert.equal(saved.site.owner, secondUsername);
      assert.equal(saved.site.id, secondUsername);
      assert.equal((await decode(await request(`/api/builder/profile/${username}`))).site.nickname, "Первый ник");
      const other = await request(`/api/builder/sites/get?id=${username}`, { cookie: bobCookie });
      if (other.ok) assert.notEqual((await decode(other)).site.owner, username);
    });

    await t.test("password changes rotate sessions and store salted hashes", async () => {
      const previousCookie = aliceCookie;
      const newPassword = "Changed-test-password-469!";
      const badChange = await request("/api/builder/auth/password", { method: "POST", cookie: aliceCookie, body: { currentPassword: "wrong-password", newPassword } });
      assert.equal(badChange.status, 401);
      const response = await request("/api/builder/auth/password", { method: "POST", cookie: aliceCookie, body: { currentPassword: password, newPassword } });
      assert.equal(response.status, 200);
      aliceCookie = cookieFrom(response);
      assert.notEqual(aliceCookie, previousCookie);
      assert.equal((await decode(await request("/api/builder/auth/me", { cookie: previousCookie }))).user, null);
      assert.equal((await decode(await request("/api/builder/auth/me", { cookie: aliceCookie }))).user.username, username);
      assert.equal((await request("/api/builder/auth/login", { method: "POST", body: { username, password } })).status, 401);
      const validLogin = await request("/api/builder/auth/login", { method: "POST", body: { username, password: newPassword } });
      assert.equal(validLogin.status, 200);
      aliceCookie = cookieFrom(validLogin);
      const storedText = await readFile(join(directory, "builder-users", "users", `${username}.json`), "utf8");
      assert.ok(!storedText.includes(password) && !storedText.includes(newPassword));
      const stored = JSON.parse(storedText);
      assert.match(stored.salt, /^[a-f0-9]{32}$/);
      assert.match(stored.passwordHash, /^[a-f0-9]{128}$/);
    });

    await t.test("logout revokes the session rather than just clearing the browser cookie", async () => {
      const response = await request("/api/builder/auth/logout", { method: "POST", cookie: aliceCookie, body: {} });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
      const me = await decode(await request("/api/builder/auth/me", { cookie: aliceCookie }));
      assert.equal(me.user, null);
      assert.equal((await request("/api/builder/sites/list", { cookie: aliceCookie })).status, 401);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !target.split(/[\\/]/).at(-1).startsWith("iwtxz-builder-test-")) throw new Error("Unexpected temporary cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
