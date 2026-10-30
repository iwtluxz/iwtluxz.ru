import { readFile, writeFile, readdir } from "node:fs/promises";
import vm from "node:vm";
const context = { window: {} };
vm.runInNewContext(await readFile(new URL("../profile-features.js", import.meta.url), "utf8"), context);
const { socials, animations, decorations } = context.window.IwtxzProfileFeatures;
const root = new URL("../", import.meta.url);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let index = await readFile(new URL("index.html", root), "utf8");
const replace = (name, content) => { index = index.replace(new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`), `$1\n${content}\n          $2`); };
replace("nickname-animations", animations.map(item => `<option value="${item.id}">${escape(item.label)}</option>`).join("\n"));
const choices = [{ id: "none", label: "Без украшения" }, { id: "discord", label: "Из Discord" }, ...decorations];
replace("decoration-picker", choices.map(item => `<button type="button" class="decoration-option${item.id === "none" ? " selected" : ""}" data-decoration="${item.id}" aria-pressed="${item.id === "none"}"><span class="decoration-preview"><img data-decoration-avatar src="img/mainavatar.gif" alt="" loading="lazy">${item.image ? `<img class="decoration-art" src="${item.image.slice(1)}" alt="" loading="lazy">` : `<span class="decoration-mode">${item.id === "discord" ? "DS" : "—"}</span>`}</span><span>${escape(item.label)}</span></button>`).join("\n"));
replace("social-editor", socials.map(item => `<details class="social-field" data-social-field="${item.id}"><summary><img src="${item.icon.slice(1)}" alt="" loading="lazy"><span>${escape(item.label)}</span><small data-social-state>Добавить</small></summary><div class="social-field-body"><label class="field">${item.id === "discord" ? "Имя в Discord" : "Ссылка"}<input id="${item.id}" type="${item.id === "discord" ? "text" : "url"}" maxlength="${item.id === "discord" ? "60" : "500"}" placeholder="${escape(item.placeholder)}" autocomplete="off"></label><button type="button" class="text-button" data-social-remove="${item.id}">Убрать</button></div></details>`).join("\n"));
await writeFile(new URL("index.html", root), index);
for (const file of await readdir(root)) {
  if (!file.endsWith(".html")) continue;
  const url = new URL(file, root);
  let html = await readFile(url, "utf8");
  if (!html.includes('href="profile-features.css')) html = html.replace("</head>", '  <link rel="stylesheet" href="profile-features.css">\n</head>');
  if (!html.includes('src="profile-features.js')) {
    const anchor = html.match(/<script src="(?:builder|profile-customization)\.js[^\"]*"[^>]*>/);
    html = anchor ? html.replace(anchor[0], `<script src="profile-features.js" defer></script>\n  ${anchor[0]}`) : html.replace("</head>", '  <script src="profile-features.js" defer></script>\n</head>');
  }
  html = html.replace(/(<img class="profile-avatar" id="profileAvatar"[^>]*>)(?!<\/span>)/, '<span class="profile-avatar-frame">$1</span>');
  await writeFile(url, html);
}
console.log("Feature controls, shared assets and avatar frames refreshed.");
