import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../profile-features.js", import.meta.url), "utf8");
function fixture({ storage = new Map(), blockedStorage = false, preview = false, auth = false } = {}) {
  const timers = new Map();
  const notices = [];
  let entered = false;
  const classList = () => ({ add() {}, contains: value => value === "is-entered" && entered });
  const element = tagName => ({
    tagName: tagName.toUpperCase(), classList: classList(), dataset: {}, children: [], listeners: {},
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    remove() { const index = notices.indexOf(this); if (index !== -1) notices.splice(index, 1); }
  });
  const storageApi = {
    getItem: key => { if (blockedStorage) throw new Error("Storage disabled"); return storage.get(key) || null; },
    setItem: (key, value) => { if (blockedStorage) throw new Error("Storage disabled"); storage.set(key, value); }
  };
  const document = { readyState: "complete", hidden: false, querySelector: () => auth ? {} : null, querySelectorAll: () => [], createElement: element, body: { classList: classList(), append: notice => notices.push(notice) } };
  const window = { localStorage: storageApi, sessionStorage: storageApi, addEventListener() {} };
  window.parent = preview ? {} : window;
  vm.runInNewContext(source, { window, document, location: { search: preview ? "?preview=1" : "" }, URL, URLSearchParams, setInterval: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id) });
  return { api: window.IwtxzProfileFeatures, notices, storage, document, enter: () => { entered = true; }, tick: count => { for (let i = 0; i < count; i++) for (const fn of timers.values()) fn(); } };
}

test("join notice waits for twelve visible seconds after entry and appears once across profiles", () => {
  const first = fixture();
  first.tick(30);
  assert.equal(first.notices.length, 0, "time behind the entry screen must not count");
  first.enter(); first.document.hidden = true; first.tick(30);
  assert.equal(first.notices.length, 0, "time in background tabs must not count");
  first.document.hidden = false; first.tick(11);
  assert.equal(first.notices.length, 0);
  first.tick(1);
  assert.equal(first.notices.length, 1);
  const notice = first.notices[0];
  assert.equal(notice.children[0].textContent, "Хочешь такую же страницу?");
  assert.equal(notice.children[1].href, "/?auth=signup");
  notice.children[2].listeners.click(); first.tick(50);
  assert.equal(first.notices.length, 0);
  const second = fixture({ storage: first.storage }); second.enter(); second.tick(20);
  assert.equal(second.notices.length, 0, "another profile must respect the previous display");
});

test("join notice skips cabinet and iframe previews and tolerates disabled browser storage", () => {
  for (const options of [{ preview: true }, { auth: true }]) {
    const page = fixture(options); page.enter(); page.tick(50);
    assert.equal(page.notices.length, 0);
  }
  const page = fixture({ blockedStorage: true }); page.enter();
  assert.doesNotThrow(() => page.tick(50));
  assert.equal(page.notices.length, 1);
});

test("profile effects only accept known choices and public HTTPS destinations", () => {
  const { api } = fixture({ auth: true });
  const name = { classList: { add() {} }, dataset: {} };
  api.applyNameAnimation(name, "glitch"); assert.equal(name.dataset.nameAnimation, "glitch");
  api.applyNameAnimation(name, "unknown"); assert.equal(name.dataset.nameAnimation, "none");
  assert.equal(api.decorationUrl("sakura"), "/img/avatar-decorations/sakura.png");
  assert.equal(api.decorationUrl("https://untrusted.example/image"), "");
  assert.equal(api.decorationUrl("discord", { asset: "../image" }), "");
  assert.equal(api.decorationUrl("discord", { asset: "a_" + "a".repeat(32) }), `https://cdn.discordapp.com/avatar-decoration-presets/a_${"a".repeat(32)}.png?size=256&passthrough=true`);
  assert.equal(api.socialUrl("https://github.com/alice"), "https://github.com/alice");
  for (const value of ["javascript:alert(1)", "http://example.com", "https://user:password@example.com", "https://example.com/" + "x".repeat(500), "not a url"]) assert.equal(api.socialUrl(value), "");
});
