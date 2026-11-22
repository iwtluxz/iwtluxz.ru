import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../telegram-notification.js", import.meta.url), "utf8");

function setup(dismissed = false, failWrite = false) {
  const timers = new Map();
  const elements = [];
  let nextTimer = 0;
  const stored = new Map(dismissed ? [["iwtxz:telegram-notification-opt-out", "1"]] : []);
  function element() {
    return {
      classList: { add() {} },
      listeners: {},
      append(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      contains() { return false; },
      matches() { return false; },
      remove() {},
    };
  }
  const document = {
    readyState: "complete",
    body: { append(node) { elements.push(node); } },
    createElement: element,
    querySelector(selector) { return selector === ".telegram-notification" ? elements[0] : null; },
    getElementById(id) { return id === "authForm" || id === "authPanel" ? element() : null; },
  };
  const context = {
    document,
    window: {},
    Math: { random: () => 0 },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrite) throw new Error("storage unavailable");
        stored.set(key, value);
      },
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context);
  return { elements, timers, stored };
}

test("shows on the login page after 5–10 seconds without authentication", () => {
  const { elements, timers } = setup();
  const [id, timer] = [...timers][0];
  assert.ok(timer.delay >= 5000 && timer.delay <= 10000);
  timers.delete(id);
  timer.callback();
  assert.equal(elements.length, 1);
});

test("does not show again after opting out", () => {
  const { elements, timers } = setup(true);
  [...timers.values()][0].callback();
  assert.equal(elements.length, 0);
});

test("only the never-show button saves the preference", () => {
  const first = setup();
  [...first.timers.values()][0].callback();
  const content = first.elements[0].children[0];
  const actions = content.children[1].children[2];
  content.children[2].listeners.click();
  assert.equal(first.stored.size, 0);

  const second = setup();
  [...second.timers.values()][0].callback();
  const secondActions = second.elements[0].children[0].children[1].children[2];
  secondActions.children[1].listeners.click();
  assert.equal(second.stored.get("iwtxz:telegram-notification-opt-out"), "1");
  assert.equal(actions.children[1].textContent, "Не показывать снова");
});

test("automatic dismissal does not save the preference", () => {
  const { elements, timers, stored } = setup();
  [...timers.values()][0].callback();
  assert.equal(elements.length, 1);
  [...timers.values()].find((timer) => timer.delay === 8000).callback();
  assert.equal(stored.size, 0);
});

test("reports a failure to save the preference", () => {
  const { elements, timers, stored } = setup(false, true);
  [...timers.values()][0].callback();
  const text = elements[0].children[0].children[1];
  text.children[2].children[1].listeners.click();
  assert.equal(stored.size, 0);
  assert.match(text.children[3].textContent, /Не удалось сохранить/);
});

test("returning the pointer cancels the restarted auto-dismiss timer", () => {
  const { elements, timers } = setup();
  [...timers.values()][0].callback();
  const notification = elements[0];
  notification.listeners.mouseenter();
  notification.listeners.mouseleave();
  assert.ok([...timers.values()].some((timer) => timer.delay === 3000));
  notification.listeners.mouseenter();
  assert.ok(![...timers.values()].some((timer) => timer.delay === 3000));
});

test("keyboard focus pauses auto-dismiss", () => {
  const { elements, timers } = setup();
  [...timers.values()][0].callback();
  elements[0].listeners.focusin();
  assert.ok(![...timers.values()].some((timer) => timer.delay === 8000));
});
