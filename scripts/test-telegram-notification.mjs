import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../telegram-notification.js", import.meta.url), "utf8");

function setup(dismissed = false) {
  const timers = new Map();
  const elements = [];
  let nextTimer = 0;
  const stored = new Map(dismissed ? [["iwtxz:telegram-notification-dismissed", "1"]] : []);
  function element() {
    return {
      classList: { add() {} },
      listeners: {},
      append(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
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
      setItem: (key, value) => stored.set(key, value),
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
  return { elements, timers };
}

test("shows on the login page after 5–10 seconds without authentication", () => {
  const { elements, timers } = setup();
  const [id, timer] = [...timers][0];
  assert.ok(timer.delay >= 5000 && timer.delay <= 10000);
  timers.delete(id);
  timer.callback();
  assert.equal(elements.length, 1);
});

test("does not show again after dismissal", () => {
  const { elements, timers } = setup(true);
  [...timers.values()][0].callback();
  assert.equal(elements.length, 0);
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
