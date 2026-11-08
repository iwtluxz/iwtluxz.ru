(() => {
  'use strict';

  const catalog = window.IwtxzDiscordBadges;
  const group = document.getElementById('discordUserId')?.closest('.settings-group');
  if (!catalog?.items?.length || !group || document.getElementById('discordBadgePicker')) return;
  const normalize = ids => catalog.normalize(Array.isArray(ids) ? ids : []);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const root = make('fieldset', 'discord-badge-picker');
  root.id = 'discordBadgePicker';
  root.append(make('legend', '', 'Твои значки Discord'));
  const description = make('p', 'hint', 'Включи значки, которые хочешь показывать в плашке. Здесь доступны только значки, полученные из твоего Discord.');
  description.id = 'discordBadgePickerDescription';
  const toolbar = make('div', 'discord-badge-picker-toolbar');
  const searchLabel = make('label', 'discord-badge-search');
  const search = make('input', '');
  search.type = 'search'; search.placeholder = 'Найти свой значок'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Найти свой значок Discord');
  searchLabel.append(search);
  const actions = make('div', 'discord-badge-actions');
  const showAll = make('button', 'text-button', 'Включить все'); showAll.type = 'button';
  const hideAll = make('button', 'text-button', 'Выключить все'); hideAll.type = 'button';
  actions.append(showAll, hideAll); toolbar.append(searchLabel, actions);
  const list = make('div', 'discord-badge-choices');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Показывать значки Discord');
  const empty = make('p', 'hint discord-badge-empty');
  empty.setAttribute('role', 'status'); empty.setAttribute('aria-live', 'polite');
  const footer = make('div', 'discord-badge-picker-footer');
  const count = make('span', 'hint');
  const status = make('span', 'hint'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  footer.append(count, status);
  root.append(description, toolbar, list, empty, footer);
  const toggles = group.querySelector('#discordShowBadges')?.closest('.toggle-grid');
  if (toggles) toggles.after(root); else group.append(root);

  let hiddenIds = new Set();
  let available = [];
  let availability = { userId: '', state: 'disabled' };
  const inputs = new Map();
  function readHidden() { return normalize([...hiddenIds]); }
  function announceChange() { root.dispatchEvent(new Event('input', { bubbles: true })); }
  function updateCount() {
    let shown = 0;
    for (const [id, input] of inputs) {
      input.checked = !hiddenIds.has(id);
      if (input.checked) shown++;
      input.closest('label').classList.toggle('is-selected', input.checked);
    }
    count.textContent = available.length ? 'Включено ' + shown + ' из ' + available.length : '';
    showAll.disabled = available.length === 0 || shown === available.length;
    hideAll.disabled = available.length === 0 || shown === 0;
  }
  function emptyMessage() {
    if (availability.state === 'ready') return 'Discord не передал доступных значков для этого аккаунта.';
    if (['disabled', 'sync-disabled'].includes(availability.state)) return 'Включи синхронизацию Discord, чтобы увидеть свои значки.';
    if (['invalid', 'missing-id'].includes(availability.state)) return 'Укажи свой ID Discord, чтобы получить доступные значки.';
    if (['not-member', 'notmember'].includes(availability.state)) return 'Вступи на сервер проекта, чтобы обновить данные Discord.';
    if (['unavailable', 'error'].includes(availability.state)) return 'Не удалось получить значки Discord. Попробуй обновить данные позже.';
    if (availability.state === 'offline') return 'Данные Discord ещё не обновились. Значки появятся после синхронизации.';
    return 'Получаем твои значки Discord…';
  }
  function filter() {
    const query = search.value.trim().toLocaleLowerCase('ru');
    let visible = 0;
    for (const [id, input] of inputs) {
      const item = catalog.byId[id];
      const matches = (item.label + ' ' + item.id + ' ' + (item.keywords || '')).toLocaleLowerCase('ru').includes(query);
      input.closest('label').hidden = !matches;
      if (matches) visible++;
    }
    toolbar.hidden = available.length === 0;
    list.hidden = visible === 0;
    empty.hidden = visible !== 0;
    empty.textContent = available.length ? 'Среди твоих значков ничего не найдено.' : emptyMessage();
  }
  function renderAvailable() {
    inputs.clear();
    list.replaceChildren();
    for (const item of available) {
      const label = make('label', 'discord-badge-choice');
      label.title = item.label + ' · получен из Discord';
      label.dataset.badgeId = item.id;
      const input = make('input', ''); input.type = 'checkbox'; input.dataset.discordBadge = item.id;
      input.setAttribute('aria-describedby', description.id);
      input.setAttribute('role', 'switch');
      const image = make('img', ''); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
      const text = make('span', 'discord-badge-choice-label', item.label);
      label.append(input, image, text); list.append(label); inputs.set(item.id, input);
      input.addEventListener('change', event => {
        status.textContent = '';
        if (input.checked) hiddenIds.delete(item.id);
        else if (hiddenIds.size < catalog.maximum || hiddenIds.has(item.id)) hiddenIds.add(item.id);
        else {
          event.stopPropagation();
          status.textContent = 'Достигнут лимит скрытых значков. Включи другой значок и повтори.';
        }
        updateCount();
      });
    }
    updateCount(); filter();
  }
  function applyHidden(ids) {
    hiddenIds = new Set(normalize(ids));
    status.textContent = ''; updateCount();
  }
  function setAvailable(value = {}) {
    const userId = typeof value.userId === 'string' ? value.userId : '';
    const state = typeof value.state === 'string' ? value.state : 'loading';
    availability = { userId, state };
    const received = state === 'ready' && /^\d{17,20}$/.test(userId) && Array.isArray(value.badges) ? value.badges : [];
    const ids = [...new Set(received.map(item => typeof item === 'string' ? item : item?.id).filter(id => typeof id === 'string' && Object.hasOwn(catalog.byId, id)))].slice(0, 40);
    const next = ids.map(id => catalog.byId[id]);
    const unchanged = next.length === available.length && next.every((item, index) => item.id === available[index].id);
    available = next;
    if (unchanged) { updateCount(); filter(); } else renderAvailable();
  }
  function reset() {
    hiddenIds.clear(); search.value = ''; status.textContent = '';
    setAvailable({ userId: '', state: 'disabled', badges: [] });
  }
  search.addEventListener('input', event => { event.stopPropagation(); filter(); });
  search.addEventListener('change', event => event.stopPropagation());
  showAll.addEventListener('click', () => {
    for (const item of available) hiddenIds.delete(item.id);
    status.textContent = ''; updateCount(); announceChange();
  });
  hideAll.addEventListener('click', () => {
    const next = new Set([...hiddenIds, ...available.map(item => item.id)]);
    if (next.size > catalog.maximum) { status.textContent = 'Достигнут лимит скрытых значков.'; return; }
    hiddenIds = next;
    status.textContent = ''; updateCount(); announceChange();
  });
  reset();
  window.IwtxzDiscordBadgePicker = Object.freeze({ readHidden, applyHidden, setAvailable, reset, read: readHidden, apply: applyHidden });
})();
