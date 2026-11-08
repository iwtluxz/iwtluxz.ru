(() => {
  "use strict";

  const form = document.getElementById("editorForm");
  const visibility = document.getElementById("showDiscord")?.closest("label");
  const settings = document.getElementById("discordUserId")?.closest(".settings-group");
  if (!form || !visibility || !settings || document.getElementById("discordSettingsDialog")) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const launch = make("button", "discord-settings-launch");
  launch.type = "button";
  launch.id = "openDiscordSettings";
  launch.setAttribute("aria-haspopup", "dialog");
  launch.setAttribute("aria-controls", "discordSettingsDialog");
  launch.setAttribute("aria-expanded", "false");
  const icon = make("img", "discord-settings-launch-icon");
  icon.src = "img/socials/discord.svg";
  icon.alt = "";
  const label = make("span", "discord-settings-launch-label");
  label.append(make("strong", "", "Discord в твоей карточке"), make("small", "", "Аватар, значки, активность и оформление"));
  const arrow = make("span", "discord-settings-launch-arrow", "↗");
  arrow.setAttribute("aria-hidden", "true");
  launch.append(icon, label, arrow);
  visibility.before(launch);

  const dialog = make("dialog", "discord-settings-dialog");
  dialog.id = "discordSettingsDialog";
  dialog.setAttribute("aria-labelledby", "discordSettingsTitle");
  dialog.setAttribute("aria-describedby", "discordSettingsDescription");
  const surface = make("div", "discord-settings-surface");
  const header = make("header", "discord-settings-header");
  const heading = make("div", "");
  heading.append(make("span", "eyebrow", "Твоя страница"));
  const title = make("h2", "", "Discord в твоей карточке");
  title.id = "discordSettingsTitle";
  heading.append(title);
  const closeButton = make("button", "discord-settings-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Закрыть настройки Discord");
  header.append(heading, closeButton);
  const description = make("p", "hint", "Меняй настройки здесь и смотри результат в превью. Чтобы обновить страницу, примени изменения в кабинете.");
  description.id = "discordSettingsDescription";
  const content = make("div", "discord-settings-content");
  settings.querySelector("h3")?.remove();
  content.append(description, visibility, settings);
  const footer = make("footer", "discord-settings-footer");
  const doneButton = make("button", "button primary", "Готово");
  doneButton.type = "button";
  footer.append(make("span", "hint", "Настройки остаются в твоём черновике."), doneButton);
  surface.append(header, content, footer);
  dialog.append(surface);
  // Keep the original controls inside their form: delegated input/change handlers,
  // form ownership, saved values and the live preview continue to work unchanged.
  form.append(dialog);

  let closeTimer = 0;
  let previousFocus = null;
  let backdropPointer = false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  function finishClose(restoreFocus = true) {
    clearTimeout(closeTimer);
    closeTimer = 0;
    if (dialog.open) dialog.close();
    dialog.classList.remove("is-closing");
    document.body.classList.remove("discord-settings-open");
    launch.setAttribute("aria-expanded", "false");
    if (restoreFocus && previousFocus?.isConnected && !document.body.classList.contains("auth-locked")) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function close(options = {}) {
    if (!dialog.open || dialog.classList.contains("is-closing")) return;
    if (options.immediate || reducedMotion?.matches) { finishClose(options.restoreFocus !== false); return; }
    dialog.classList.add("is-closing");
    closeTimer = window.setTimeout(() => finishClose(options.restoreFocus !== false), 160);
  }
  function open(target) {
    if (document.body.classList.contains("auth-locked") || form.inert) return false;
    clearTimeout(closeTimer);
    closeTimer = 0;
    dialog.classList.remove("is-closing");
    if (!dialog.open) {
      previousFocus = document.activeElement;
      dialog.showModal();
      document.body.classList.add("discord-settings-open");
      launch.setAttribute("aria-expanded", "true");
    }
    const focus = typeof target === "string" ? dialog.querySelector(target) : target;
    if (focus && dialog.contains(focus)) focus.focus({ preventScroll: false });
    else closeButton.focus({ preventScroll: true });
    return true;
  }
  launch.addEventListener("click", () => open());
  closeButton.addEventListener("click", () => close());
  doneButton.addEventListener("click", () => close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("pointerdown", event => { backdropPointer = event.target === dialog; });
  dialog.addEventListener("click", event => {
    if (event.target === dialog && backdropPointer) close();
    backdropPointer = false;
  });
  dialog.addEventListener("close", () => {
    clearTimeout(closeTimer);
    closeTimer = 0;
    document.body.classList.remove("discord-settings-open");
    launch.setAttribute("aria-expanded", "false");
    dialog.classList.remove("is-closing");
  });
  new MutationObserver(() => {
    launch.disabled = form.inert;
    if (document.body.classList.contains("auth-locked") || form.inert) close({ immediate: true, restoreFocus: false });
  }).observe(document.body, { attributes: true, attributeFilter: ["class", "inert"], subtree: true });
  launch.disabled = form.inert;

  window.IwtxzDiscordDialog = Object.freeze({ open, close, get isOpen() { return dialog.open; } });
})();
