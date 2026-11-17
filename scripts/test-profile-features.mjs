import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../profile-features.js", import.meta.url), "utf8");
function fixture({ storage = new Map(), blockedStorage = false, preview = false, auth = false, reduced = false } = {}) {
  const timers = new Map();
  const notices = [];
  let entered = false;
  const classList = () => ({ add() {}, contains: value => value === "is-entered" && entered });
  const element = tagName => ({
    tagName: tagName.toUpperCase(), classList: classList(), dataset: {}, children: [], listeners: {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    append(...children) { this.children.push(...children); },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    remove() { const index = notices.indexOf(this); if (index !== -1) notices.splice(index, 1); }
  });
  const storageApi = {
    getItem: key => { if (blockedStorage) throw new Error("Storage disabled"); return storage.get(key) || null; },
    setItem: (key, value) => { if (blockedStorage) throw new Error("Storage disabled"); storage.set(key, value); }
  };
  const document = { readyState: "complete", hidden: false, querySelector: () => auth ? {} : null, querySelectorAll: () => [], createElement: element, body: { classList: classList(), append: notice => notices.push(notice) } };
  const window = { localStorage: storageApi, sessionStorage: storageApi, addEventListener() {}, matchMedia:()=>({matches:reduced}) };
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

test("reduced motion keeps a selected avatar decoration visible as a static image",()=>{
  const {api}=fixture({auth:true,reduced:true});let art;
  const frame={querySelector:()=>art,append:image=>{art=image;}};
  const avatar={tagName:'IMG',hidden:false,closest:()=>frame};
  api.applyAvatarDecoration(avatar,'sakura');
  assert.equal(art.hidden,false);assert.equal(art.src,'/img/avatar-decorations/sakura.webp');
  api.applyAvatarDecoration(avatar,'none');assert.equal(art.hidden,true);
});

test("nickname and description effect choices reject injected styles and preserve multiline content",()=>{
  const {api}=fixture({auth:true});
  const description={classList:{add(){}},dataset:{},textContent:'Первая строка\nSecond line 🎵'};
  const nickname={classList:{add(){}},dataset:{},textContent:'My nickname'};
  for(const {id} of api.animations){api.applyNameAnimation(nickname,id);assert.equal(nickname.dataset.nameAnimation,id);}
  for(const {id} of api.descriptionAnimations){api.applyDescriptionAnimation(description,id);assert.equal(description.dataset.descriptionAnimation,id);assert.equal(description.textContent,'Первая строка\nSecond line 🎵');}
  for(const invalid of ['injected','url(javascript:alert(1))','glow;display:none',null,{}]){
    api.applyNameAnimation(nickname,invalid);assert.equal(nickname.dataset.nameAnimation,'none');
    api.applyDescriptionAnimation(description,invalid);assert.equal(description.dataset.descriptionAnimation,'none');
  }
  assert.doesNotThrow(()=>api.applyDescriptionAnimation(null,'glow'));
  assert.equal(nickname.textContent,'My nickname');
});

test("gradient movement follows the chosen gradient direction",()=>{
  const {api}=fixture({auth:true});
  const vars=new Map();
  const name={style:{setProperty:(key,value)=>vars.set(key,value)}};
  api.applyGradientFlow(name,0);
  assert.equal(vars.get('--gradient-from-x'),'50.000%');
  assert.equal(vars.get('--gradient-from-y'),'100.000%');
  assert.equal(vars.get('--gradient-to-y'),'0.000%');
  api.applyGradientFlow(name,90);
  assert.equal(vars.get('--gradient-from-x'),'0.000%');
  assert.equal(vars.get('--gradient-to-x'),'100.000%');
  api.applyGradientFlow(name,135);
  assert.notEqual(vars.get('--gradient-from-x'),vars.get('--gradient-to-x'));
  assert.notEqual(vars.get('--gradient-from-y'),vars.get('--gradient-to-y'));
});

function styledDescription() {
  const classes = new Set(), properties = new Map([['color', '#aabbcc']]);
  return {
    textContent: 'Первая строка\nSecond line 🎵', dataset: {}, classes, properties,
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
    },
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: key => properties.delete(key)
    }
  };
}

test('description gradients accept independent motion and clear only their own presentation', () => {
  const { api } = fixture({ auth: true });
  const description = styledDescription();
  const settings = { descriptionAnimation: 'float', descriptionGradient: true, descriptionGradientStart: '#ee3366', descriptionGradientEnd: '#3388ff', descriptionGradientAngle: 135, descriptionGradientAnimated: false, descriptionGradientSpeed: 8 };
  api.applyDescriptionStyle(description, settings);
  assert.equal(description.dataset.descriptionAnimation, 'float');
  assert.equal(description.classes.has('iwtxz-description-gradient'), true);
  assert.equal(description.classes.has('iwtxz-description-gradient-animated'), false);
  assert.equal(description.properties.get('--description-gradient'), 'linear-gradient(135deg,#ee3366,#3388ff)');
  api.applyDescriptionStyle(description, { ...settings, descriptionGradientAnimated: true });
  assert.equal(description.classes.has('iwtxz-description-gradient-animated'), true);
  assert.equal(description.properties.get('--description-gradient'), 'linear-gradient(135deg,#ee3366,#3388ff,#ee3366)');
  assert.equal(description.properties.get('--description-gradient-speed'), '8s');
  assert.equal(description.dataset.descriptionAnimation, 'float', 'color flow must not replace the selected movement');
  api.applyDescriptionStyle(description, { ...settings, descriptionGradient: false });
  assert.equal(description.classes.has('iwtxz-description-gradient'), false);
  assert.equal(description.classes.has('iwtxz-description-gradient-animated'), false);
  assert.equal(description.properties.has('--description-gradient'), false);
  assert.equal(description.properties.has('--gradient-from-x'), false);
  assert.equal(description.properties.get('color'), '#aabbcc', 'disabling the gradient must preserve existing color');
  assert.equal(description.dataset.descriptionAnimation, 'float');
  assert.equal(description.textContent, 'Первая строка\nSecond line 🎵');
});

test('description gradients reject style injection and bound angle and animation duration', () => {
  const { api } = fixture({ auth: true });
  const description = styledDescription();
  api.applyDescriptionGradient(description, { descriptionGradient: true, descriptionGradientStart: '#ffffff);background:url(https://untrusted.example)', descriptionGradientEnd: 'red', descriptionGradientAngle: Infinity, descriptionGradientSpeed: NaN });
  assert.equal(description.properties.get('--description-gradient'), 'linear-gradient(90deg,#ffffff,#8b5cf6)');
  assert.equal(description.properties.get('--description-gradient-speed'), '6s');
  api.applyDescriptionGradient(description, { descriptionGradient: true, descriptionGradientAngle: -90, descriptionGradientSpeed: 10000 });
  assert.equal(description.properties.get('--description-gradient'), 'linear-gradient(0deg,#ffffff,#8b5cf6)');
  assert.equal(description.properties.get('--description-gradient-speed'), '30s');
  api.applyDescriptionGradient(description, { descriptionGradient: 'true', descriptionGradientAnimated: true });
  assert.equal(description.classes.has('iwtxz-description-gradient'), false);
  assert.equal(description.classes.has('iwtxz-description-gradient-animated'), false);
  assert.doesNotThrow(() => api.applyDescriptionStyle(null, { descriptionGradient: true }));
});
