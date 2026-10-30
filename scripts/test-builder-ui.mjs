import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../builder.js", import.meta.url), "utf8");
const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");
const customization = await readFile(new URL("../profile-customization.js", import.meta.url), "utf8");
const featuresSource = await readFile(new URL("../profile-features.js", import.meta.url), "utf8");

class Element {
  constructor(tagName = "SPAN") {
    this.tagName = tagName.toUpperCase();
    this.value = ""; this.textContent = ""; this.checked = false; this.disabled = false;
    this.dataset = {}; this.style = { setProperty() {} }; this.attributes = new Map(); this.listeners = new Map(); this.children = [];
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle(name, enabled = !classes.has(name)) { if (enabled) classes.add(name); else classes.delete(name); } };
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  fire(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  click() { return this.fire("click"); }
}

function loadBuilder(request, query = "") {
  const elements = new Map([...markup.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const loginTab = new Element(), signupTab = new Element();
  loginTab.dataset.authMode = "login"; signupTab.dataset.authMode = "signup";
  const buttons = [elements.get("authSubmit"), elements.get("showPassword"), loginTab, signupTab];
  elements.get("previewFrame").contentWindow = { postMessage() {} };
  const body = new Element(); body.classList.add("auth-locked");
  const document = { body,
    querySelector(selector) { return selector === '[data-auth-mode="login"]' ? loginTab : selector === '[data-auth-mode="signup"]' ? signupTab : elements.get(selector.slice(1)); },
    querySelectorAll(selector) { return selector === "[data-auth-mode]" ? [loginTab, signupTab] : selector === "#authForm button, [data-auth-mode]" ? buttons : []; } };
  const location = new URL("https://example.test/" + query);
  const window = { location, addEventListener() {}, IwtxzBackend: { isConfigured: () => true, request } };
  const timers = new Set();
  const context = vm.createContext({ window, document, location, URL, URLSearchParams, Headers, AbortController,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms >= 5000 ? 20 : ms); timers.add(timer); return timer; }, clearTimeout });
  vm.runInContext(featuresSource, context);
  vm.runInContext(source, context);
  return { elements, body, buttons, close() { for (const timer of timers) clearTimeout(timer); }, async submit() {
    elements.get("username").value = "alice"; elements.get("password").value = "Test-password-123!";
    await elements.get("authForm").fire("submit");
  } };
}

const user = { username: "alice" };
const site = { title: "Saved page", nickname: "Alice" };
const response = path => path.endsWith("/me") ? { user: null } : path.endsWith("/list") ? { sites: [site] } : { user };

test("registration links open signup directly with password confirmation", async () => {
  const ui = loadBuilder(path => Promise.resolve(response(path)), "?auth=signup");
  try {
    assert.equal(ui.elements.get("authHeading").textContent, "Создать страницу");
    assert.equal(ui.elements.get("confirmPassword").required, true);
    assert.equal(ui.elements.get("password").autocomplete, "new-password");
  } finally { ui.close(); }
});

for (const stage of ["login"]) {
  test(`cabinet UI: stalled ${stage} releases the form and a retry opens the saved profile`, async () => {
    let stall = true;
    const ui = loadBuilder(path => stall && path.endsWith(`/${stage}`) ? new Promise(() => {}) : Promise.resolve(response(path)));
    try {
      await ui.submit();
      assert.equal(ui.body.classList.contains("auth-locked"), true);
      assert.ok(ui.buttons.every(button => !button.disabled));
      const status = ui.elements.get("authStatus");
      assert.equal(status.classList.contains("error"), true);
      assert.match(status.textContent, stage === "login" ? /Сервер не ответил вовремя/ : /Вход выполнен, но кабинет не загрузился/);
      stall = false;
      await ui.submit();
      assert.equal(ui.body.classList.contains("auth-locked"), false);
      assert.equal(ui.elements.get("nickname").value, "Alice");
      assert.equal(ui.elements.get("authStatus").textContent, "");
    } finally { ui.close(); }
  });
}

test("cabinet UI: failed settings stay read-only and retry without a second login", async () => {
  let stall = true;
  const calls = [];
  const ui = loadBuilder(path => {
    calls.push(path);
    return stall && path.endsWith("/list") ? new Promise(() => {}) : Promise.resolve(response(path));
  });
  try {
    await ui.submit();
    assert.equal(ui.body.classList.contains("auth-locked"), false);
    assert.equal(ui.body.classList.contains("account-unavailable"), true);
    assert.equal(ui.elements.get("editorForm").inert, true);
    assert.equal(ui.elements.get("saveButton").disabled, true);
    assert.equal(ui.elements.get("publishButton").disabled, true);
    assert.equal(ui.elements.get("retryAccountLoad").classList.contains("hidden"), false);
    assert.match(ui.elements.get("accountLoadStatus").textContent, /Не удалось загрузить сохранённые настройки/);
    assert.equal(ui.elements.get("password").value, "");
    stall = false;
    ui.elements.get("retryAccountLoad").fire("click");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.body.classList.contains("account-unavailable"), false);
    assert.equal(ui.elements.get("nickname").value, "Alice");
    assert.equal(ui.elements.get("saveButton").disabled, false);
    assert.equal(calls.filter(path => path.endsWith("/login")).length, 1);
  } finally { ui.close(); }
});

test("cabinet UI: an abandoned bootstrap cannot log out a successful manual login", async () => {
  let rejectBootstrap, bootstrapSignal;
  const ui = loadBuilder((path, options) => path.endsWith("/me")
    ? (bootstrapSignal = options.signal, new Promise((_, reject) => { rejectBootstrap = reject; }))
    : Promise.resolve(response(path)));
  try {
    await new Promise(resolve => setImmediate(resolve));
    await ui.submit();
    assert.equal(bootstrapSignal.aborted, true);
    rejectBootstrap(Object.assign(new Error("Old session"), { status: 401, code: "unauthorized" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.body.classList.contains("auth-locked"), false);
    assert.equal(ui.elements.get("nickname").value, "Alice");
  } finally { ui.close(); }
});

test("Discord renderer uses original badges and server-tag artwork, deduplicates and honors visibility", async () => {
  const discordBadges = new Element();
  const document = { documentElement: new Element(), body: new Element(), createElement: name => new Element(name) };
  const window = { IWTXZ_BACKEND_CONFIG: { discordGuildId: "123456789012345678" } }; window.parent = window;
  const profile = { id: "484816707798564894", guildId: window.IWTXZ_BACKEND_CONFIG.discordGuildId, member: true, updatedAt: Date.now(),
    badges: [{ id: "house-bravery" }, { id: "house-bravery" }, { id: "__proto__" }, { id: "server-booster" }],
    primaryGuild: { guildId: "123456789012345678", tag: "DOTA", badge: "a".repeat(32) } };
  vm.runInNewContext(customization, { window, document, location: new URL("https://example.test/"), URL, AbortSignal,
    fetch: async () => Response.json(profile), setInterval: () => 1, clearInterval() {} });
  const renderer = window.IwtxzProfileCustomization.createCustomizer({ discordBadges });
  const settings = { discordSync: true, discordUserId: profile.id, showButterfly: true };
  try {
    renderer.apply(settings);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(discordBadges.children.length, 2);
    const [tag, strip] = discordBadges.children;
    assert.equal(tag.children[1].textContent, "DOTA");
    assert.equal(tag.children[0].src, `https://cdn.discordapp.com/guild-tag-badges/${profile.primaryGuild.guildId}/${profile.primaryGuild.badge}.png?size=32`);
    assert.deepEqual(strip.children.map(badge => badge.children[0].src), ["/img/discord-badges/house-bravery.png", "/img/discord-badges/server-booster.svg"]);
    assert.ok(strip.children.every(badge => badge.children[0].tagName === "IMG"));
    for (const badge of strip.children) await readFile(new URL(`..${badge.children[0].src}`, import.meta.url));
    renderer.apply({ ...settings, owner: "iwtlu" });
    const originals = discordBadges.children[1].children;
    assert.equal(originals.length, 4);
    assert.equal(new Set(originals.map(item => item.children[0].src)).size, 4);
    const nitro = originals.find(item => item.children[0].src.endsWith("/nitro.png"));
    assert.ok(nitro);
    assert.match(nitro.title, /оформлении/);
    assert.ok(originals.some(item => item.children[0].src.endsWith("/active-developer.svg")));
    renderer.apply({ ...settings, discordShowBadges: false });
    assert.equal(discordBadges.hidden, true);
    assert.equal(discordBadges.children.length, 0);
    renderer.apply({ ...settings, discordSync: false });
    assert.equal(discordBadges.children.length, 0);
  } finally { renderer.dispose(); }
});
