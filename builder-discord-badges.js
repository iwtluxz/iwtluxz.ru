(() => {
  'use strict';

  const catalog = window.IwtxzDiscordBadges;
  const group = document.getElementById('discordUserId')?.closest('.settings-group');
  if (!catalog?.items?.length || !group || document.getElementById('discordBadgePicker')) return;
  const byId = new Map(catalog.items.map(item => [item.id, item]));
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
  const description = make('p', 'hint', 'Добавь оригинальные значки в оформление плашки. Доступные значки аккаунта появятся автоматически при синхронизации.');
  description.id = 'discordBadgePickerDescription';
  root.append(description);
  const toolbar = make('div', 'discord-badge-picker-toolbar');
  const searchLabel = make('label', 'discord-badge-search');
  const search = make('input', '');
  search.type = 'search'; search.placeholder = 'Найти значок'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Найти значок Discord');
  searchLabel.append(search);
  const clear = make('button', 'text-button', 'Снять выбранные'); clear.type = 'button';
  toolbar.append(searchLabel, clear);
  const filters = make('div', 'discord-badge-filters');
  filters.setAttribute('aria-label', 'Категории значков');
  const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
  const presentGroups = new Set(catalog.items.map(item => item.group).filter(Boolean));
  const groupIds = [...groups.map(item => item.id).filter(id => presentGroups.has(id)), ...[...presentGroups].filter(id => !groups.some(item => item.id === id))];
  const allGroups = [{ id: 'all', label: 'Все' }, ...groupIds.map(id => ({ id, label: groups.find(group => group.id === id)?.label || ({ nitro: 'Nitro', boost: 'Буст', community: 'Сообщество', legacy: 'Архив', activity: 'Активность' }[id] || id) }))];
  let selectedGroup = 'all';
  for (const item of allGroups) {
    const button = make('button', 'discord-badge-filter', item.label);
    button.type = 'button'; button.dataset.badgeGroup = item.id;
    button.setAttribute('aria-pressed', String(item.id === 'all'));
    button.addEventListener('click', () => { selectedGroup = item.id; filter(); });
    filters.append(button);
  }
  const list = make('div', 'discord-badge-choices');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Выбрать значки Discord');
  const inputs = new Map();
  const orderedItems = [...catalog.items].sort((a,b) => groupIds.indexOf(a.group)-groupIds.indexOf(b.group));
  for (const item of orderedItems) {
    const label = make('label', 'discord-badge-choice');
    label.title = `${item.label} · оформление карточки`;
    label.dataset.badgeId = item.id;
    const input = make('input', ''); input.type = 'checkbox'; input.dataset.discordBadge = item.id;
    input.setAttribute('aria-describedby', description.id);
    const image = make('img', ''); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
    const text = make('span', 'discord-badge-choice-label', item.label);
    label.append(input, image, text); list.append(label); inputs.set(item.id, input);
    input.addEventListener('change', event => {
      if (read().length > 32) { input.checked = false; event.stopPropagation(); status.textContent = 'Можно выбрать до 32 значков.'; }
      else status.textContent = '';
      updateCount();
    });
  }
  const empty = make('p', 'hint discord-badge-empty', 'Ничего не найдено'); empty.hidden = true;
  const footer = make('div', 'discord-badge-picker-footer');
  const count = make('span', 'hint');
  const status = make('span', 'hint'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  footer.append(count, status);
  root.append(toolbar, filters, list, empty, footer);
  const toggles = group.querySelector('#discordShowBadges')?.closest('.toggle-grid');
  if (toggles) toggles.after(root); else group.append(root);

  function read() {
    return [...inputs].filter(([, input]) => input.checked).map(([id]) => id);
  }
  function updateCount() {
    const amount = read().length;
    count.textContent = `Выбрано ${amount} / 32`;
    clear.disabled = amount === 0;
    for (const [id, input] of inputs) input.closest('label').classList.toggle('is-selected', input.checked);
  }
  function filter() {
    const query = search.value.trim().toLocaleLowerCase('ru');
    let visible = 0;
    for (const [id, input] of inputs) {
      const item = byId.get(id);
      const matches = (selectedGroup === 'all' || item.group === selectedGroup) && `${item.label} ${item.id} ${item.keywords || ''}`.toLocaleLowerCase('ru').includes(query);
      input.closest('label').hidden = !matches;
      if (matches) visible++;
    }
    for (const button of filters.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.badgeGroup === selectedGroup));
    empty.hidden = visible !== 0; list.hidden = visible === 0;
  }
  function apply(ids) {
    const selected = new Set(normalize(ids));
    for (const [id, input] of inputs) input.checked = selected.has(id);
    status.textContent = ''; updateCount();
  }
  search.addEventListener('input', event => { event.stopPropagation(); filter(); });
  search.addEventListener('change', event => event.stopPropagation());
  clear.addEventListener('click', () => { apply([]); root.dispatchEvent(new Event('input', { bubbles: true })); });
  updateCount();
  const legacyPresets = Object.freeze({ iwtlu: Object.freeze(['nitro', 'house-bravery', 'server-booster', 'active-developer']), shakzy: Object.freeze(['nitro', 'house-bravery']), strelokk: Object.freeze(['nitro', 'house-bravery']) });
  window.IwtxzDiscordBadgePicker = Object.freeze({ read: () => normalize(read()), apply, legacyPresets });
})();
