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
  root.append(make('legend', '', 'Значки Discord'));
  const description = make('p', 'hint', 'Выбери любые значки для своей плашки.');
  description.id = 'discordBadgePickerDescription';
  const toolbar = make('div', 'discord-badge-picker-toolbar');
  const searchLabel = make('label', 'discord-badge-search');
  const search = make('input', '');
  search.type = 'search'; search.placeholder = 'Найти значок'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Найти значок Discord');
  searchLabel.append(search);
  const actions = make('div', 'discord-badge-actions');
  const clear = make('button', 'text-button', 'Снять выбранные'); clear.type = 'button';
  actions.append(clear); toolbar.append(searchLabel, actions);
  const filters = make('div', 'discord-badge-filters');
  filters.setAttribute('aria-label', 'Категории значков');
  const groups = [{ id: 'all', label: 'Все' }, ...(catalog.groups || [])];
  const groupOrder = new Map(groups.map((item, index) => [item.id, index]));
  let selectedGroup = 'all';
  for (const item of groups) {
    const button = make('button', 'discord-badge-filter', item.label);
    button.type = 'button'; button.dataset.badgeGroup = item.id;
    button.setAttribute('aria-pressed', String(item.id === selectedGroup));
    button.addEventListener('click', () => { selectedGroup = item.id; filter(); });
    filters.append(button);
  }
  const list = make('div', 'discord-badge-choices');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Выбрать значки Discord');
  const empty = make('p', 'hint discord-badge-empty', 'Ничего не найдено');
  empty.setAttribute('role', 'status'); empty.setAttribute('aria-live', 'polite');
  const footer = make('div', 'discord-badge-picker-footer');
  const count = make('span', 'hint');
  const status = make('span', 'hint'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  footer.append(count, status);
  root.append(description, toolbar, filters, list, empty, footer);
  const toggles = group.querySelector('#discordShowBadges')?.closest('.toggle-grid');
  if (toggles) toggles.after(root); else group.append(root);

  let selectedIds = new Set();
  const inputs = new Map();
  const items = [...catalog.items].sort((a, b) => (groupOrder.get(a.group) || 0) - (groupOrder.get(b.group) || 0));
  function readSelected() { return normalize([...selectedIds]); }
  function announceChange() { root.dispatchEvent(new Event('input', { bubbles: true })); }
  function updateCount() {
    for (const [id, input] of inputs) {
      input.checked = selectedIds.has(id);
      input.closest('label').classList.toggle('is-selected', input.checked);
    }
    count.textContent = 'Выбрано ' + selectedIds.size + ' / ' + catalog.maximum;
    clear.disabled = selectedIds.size === 0;
  }
  function filter() {
    const query = search.value.trim().toLocaleLowerCase('ru');
    let visible = 0;
    for (const [id, input] of inputs) {
      const item = catalog.byId[id];
      const matches = (selectedGroup === 'all' || item.group === selectedGroup) &&
        (item.label + ' ' + item.id + ' ' + (item.keywords || '')).toLocaleLowerCase('ru').includes(query);
      input.closest('label').hidden = !matches;
      if (matches) visible++;
    }
    for (const button of filters.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.badgeGroup === selectedGroup));
    list.hidden = visible === 0;
    empty.hidden = visible !== 0;
  }
  for (const item of items) {
    const label = make('label', 'discord-badge-choice');
    label.title = item.label;
    label.dataset.badgeId = item.id;
    const input = make('input', ''); input.type = 'checkbox'; input.dataset.discordBadge = item.id;
    input.setAttribute('aria-describedby', description.id);
    input.setAttribute('role', 'switch');
    const image = make('img', ''); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
    const text = make('span', 'discord-badge-choice-label', item.label);
    label.append(input, image, text); list.append(label); inputs.set(item.id, input);
    input.addEventListener('change', event => {
      status.textContent = '';
      if (!input.checked) selectedIds.delete(item.id);
      else if (selectedIds.size < catalog.maximum || selectedIds.has(item.id)) selectedIds.add(item.id);
      else {
        event.stopPropagation();
        status.textContent = 'Можно выбрать до ' + catalog.maximum + ' значков.';
      }
      updateCount();
    });
  }
  function applySelected(ids) {
    selectedIds = new Set(normalize(ids));
    status.textContent = ''; updateCount();
  }
  function reset() {
    selectedGroup = 'all'; search.value = ''; applySelected([]); filter();
  }
  search.addEventListener('input', event => { event.stopPropagation(); filter(); });
  search.addEventListener('change', event => event.stopPropagation());
  clear.addEventListener('click', () => { applySelected([]); announceChange(); });
  reset();
  window.IwtxzDiscordBadgePicker = Object.freeze({ mode: 'manual', readSelected, applySelected, reset, read: readSelected, apply: applySelected });
})();