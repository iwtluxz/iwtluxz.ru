import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(await readFile(new URL("../profile-links.js", import.meta.url), "utf8"), context);
const links = context.window.IwtxzProfileLinks;

test("published addresses identify the same user across supported URL forms", () => {
  for (const username of ["tshk", "iwtlu", "shakzy", "strelokk", "user_123", "user-name"]) {
    assert.equal(links.urlForUser(username), `/${username}`);
    for (const path of [`/${username}`, `/${username}/`, `/${username}.html`, `/u/${username}`, `/u/${username}/`]) {
      assert.equal(links.usernameFromPath(path), username);
    }
  }
  assert.equal(links.urlForUser(" TSHK "), "/tshk");
  assert.equal(links.usernameFromPath("/TSHK"), "tshk");
});

test("application paths and Windows device names keep the query-string route", () => {
  for (const username of ["profile", "index", "404", "img", "builder", "backend-config", "profile-links", "node_modules", "dist", "con", "com1", "lpt9"]) {
    assert.equal(links.urlForUser(username), `/profile.html?u=${username}`);
    assert.equal(links.usernameFromPath(`/${username}`), null);
    assert.equal(links.usernameFromPath(`/${username}.html`), null);
  }
});

test("malformed URLs and unrelated paths never select a profile", () => {
  for (const path of ["/", "/profile.html?u=tshk", "/img/avatar.png", "/tshk/extra", "/u/", "/u/tshk/extra", "/../tshk", "/%2e%2e", "/%2ftshk", "/%", "/ab", "/_user", "/<script>", "/" + "a".repeat(33)]) {
    assert.equal(links.usernameFromPath(path), null, path);
  }
  for (const username of ["", "ab", "../tshk", "tshk/extra", "a".repeat(33), null]) {
    assert.throws(() => links.urlForUser(username));
  }
});
