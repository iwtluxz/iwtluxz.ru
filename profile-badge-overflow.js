(() => {
  'use strict';
  if (window.IwtxzBadgeOverflow) return;

  const limit = 6;
  const owners = new WeakMap();
  const states = new Set();
  let active = null, serial = 0, listening = false, observer = null, positionFrame = 0;
  const raf = callback => typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 0);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const labelFor = node => String(node.getAttribute?.('aria-label') || node.title || 'Значок Discord').replace(/\s*·\s*Discord\s*$/, '').slice(0, 120);
  const imageFor = node => node.querySelector?.('img, svg') || node.firstElementChild;
  const keyFor = node => `${node.dataset?.discordBadgeId || imageFor(node)?.getAttribute?.('src') || ''}\u0001${labelFor(node)}`;
  function graphic(node) {
    const source = imageFor(node);
    if (!source?.cloneNode) return null;
    const clone = source.cloneNode(true);
    for (const element of [clone, ...clone.querySelectorAll('[id]')]) element.removeAttribute('id');
    clone.removeAttribute('aria-labelledby'); clone.removeAttribute('aria-describedby');
    clone.removeAttribute('title'); clone.setAttribute('aria-hidden', 'true');
    if (clone.tagName?.toLowerCase() === 'img') { clone.alt = ''; clone.draggable = false; }
    return clone;
  }
  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = raf(() => { positionFrame = 0; if (active) position(active); });
  }
  function position(state) {
    if (!state.open || !state.popup) return;
    if (!state.counter?.isConnected) { close(state); return; }
    const viewport = window.visualViewport;
    const width = Math.min(window.innerWidth || document.documentElement.clientWidth || 390, viewport?.width || Infinity);
    const height = Math.min(window.innerHeight || document.documentElement.clientHeight || 844, viewport?.height || Infinity);
    const originLeft = viewport?.offsetLeft || 0, originTop = viewport?.offsetTop || 0;
    const margin = 12, gap = 9;
    state.popup.style.maxWidth = `${Math.max(120, width - margin * 2)}px`;
    state.popup.style.maxHeight = `${Math.max(100, height - margin * 2)}px`;
    const anchor = state.counter.getBoundingClientRect();
    const popup = state.popup.getBoundingClientRect();
    const above = anchor.top - gap - popup.height >= originTop + margin;
    const left = Math.max(originLeft + margin, Math.min(anchor.right - popup.width, originLeft + width - popup.width - margin));
    const requestedTop = above ? anchor.top - gap - popup.height : anchor.bottom + gap;
    const top = Math.max(originTop + margin, Math.min(requestedTop, originTop + height - popup.height - margin));
    state.popup.style.left = `${Math.round(left)}px`;
    state.popup.style.top = `${Math.round(top)}px`;
    state.popup.dataset.side = above ? 'above' : 'below';
  }
  function cancelClose(state) { window.clearTimeout(state.closeTimer); state.closeTimer = 0; }
  function closeLater(state) {
    cancelClose(state);
    if (state.pinned) return;
    state.closeTimer = window.setTimeout(() => {
      if (!state.popup?.contains(document.activeElement) && document.activeElement !== state.counter) close(state);
    }, 180);
  }
  function close(state, restoreFocus = false) {
    if (!state) return;
    cancelClose(state); state.open = false; state.pinned = false;
    if (state.popup) {
      try { state.popup.hidePopover?.(); } catch {}
      state.popup.hidden = true;
    }
    state.counter?.setAttribute('aria-expanded', 'false');
    if (active === state) active = null;
    if (restoreFocus && state.counter?.isConnected && document.activeElement !== state.counter) {
      state.skipFocusOpen = true;
      state.counter.focus({ preventScroll: true });
      Promise.resolve().then(() => { state.skipFocusOpen = false; });
    }
  }
  function select(state, index) {
    state.selected = index;
    const badge = state.nodes[index];
    state.detailImage.replaceChildren();
    const copy = graphic(badge);
    if (copy) state.detailImage.append(copy);
    state.detailName.textContent = labelFor(badge);
    state.detailDescription.textContent = 'Значок из аккаунта Discord';
    state.buttons.forEach((button, current) => button.setAttribute('aria-pressed', String(current === index)));
  }
  function buildPopup(state) {
    if (!state.popup) {
      const popup = make('section', 'iwtxz-badge-popover');
      popup.id = `iwtxz-badges-${++serial}`; popup.hidden = true;
      popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'false');
      const header = make('div', 'iwtxz-badge-popover-header');
      const heading = make('h3', '', 'Значки Discord'); heading.id = `${popup.id}-title`;
      popup.setAttribute('aria-labelledby', heading.id);
      const dismiss = make('button', 'iwtxz-badge-popover-close', '×'); dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Закрыть значки'); dismiss.addEventListener('click', () => close(state, true));
      header.append(heading, dismiss);
      const content = make('div', 'iwtxz-badge-popover-content');
      const list = make('div', 'iwtxz-badge-popover-grid'); list.setAttribute('aria-label', 'Все показываемые значки Discord');
      const detail = make('div', 'iwtxz-badge-popover-detail');
      const detailImage = make('div', 'iwtxz-badge-popover-art');
      const detailName = make('strong', 'iwtxz-badge-popover-name');
      const detailDescription = make('span', 'iwtxz-badge-popover-description');
      detail.append(detailImage, detailName, detailDescription); content.append(list, detail);
      popup.append(header, content);
      popup.addEventListener('pointerenter', () => cancelClose(state));
      popup.addEventListener('pointerleave', () => closeLater(state));
      popup.addEventListener('focusin', () => cancelClose(state));
      popup.addEventListener('focusout', () => closeLater(state));
      popup.addEventListener('click', event => event.stopPropagation());
      if (typeof popup.showPopover === 'function') popup.setAttribute('popover', 'manual');
      document.body.append(popup);
      Object.assign(state, { popup, list, detailImage, detailName, detailDescription });
    }
    const selectedKey = state.nodes[state.selected] && keyFor(state.nodes[state.selected]);
    state.list.replaceChildren(); state.buttons = [];
    state.nodes.forEach((node, index) => {
      const button = make('button', 'iwtxz-badge-popover-choice'); button.type = 'button';
      const label = labelFor(node); button.title = label; button.setAttribute('aria-label', label);
      const copy = graphic(node); if (copy) button.append(copy);
      button.addEventListener('pointerenter', () => select(state, index));
      button.addEventListener('focus', () => select(state, index));
      button.addEventListener('click', () => select(state, index));
      state.buttons.push(button); state.list.append(button);
    });
    select(state, Math.max(0, state.nodes.findIndex(node => keyFor(node) === selectedKey)));
  }
  function open(state, pinned = false, moveFocus = false) {
    if (active && active !== state) close(active);
    cancelClose(state); state.pinned = pinned || state.pinned;
    if (!state.popup) buildPopup(state);
    state.open = true; active = state;
    state.popup.hidden = false;
    try { if (!state.popup.matches?.(':popover-open')) state.popup.showPopover?.(); } catch {}
    state.counter.setAttribute('aria-expanded', 'true');
    state.counter.setAttribute('aria-controls', state.popup.id);
    position(state);
    if (moveFocus) state.buttons[state.selected || 0]?.focus();
  }
  function pointerDown(event) {
    if (active && !active.popup?.contains(event.target) && !active.counter?.contains(event.target)) close(active);
  }
  function keyDown(event) {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault(); event.stopPropagation(); close(active, true);
  }
  function detachCheck() {
    for (const state of [...states]) if (!state.owner.isConnected || !state.strip.isConnected) dispose(state.owner);
  }
  function ensureListeners() {
    if (listening) return;
    listening = true;
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    window.visualViewport?.addEventListener('resize', schedulePosition);
    window.visualViewport?.addEventListener('scroll', schedulePosition);
    if (typeof MutationObserver === 'function') { observer = new MutationObserver(detachCheck); observer.observe(document.body, { childList: true, subtree: true }); }
  }
  function removeListeners() {
    if (!listening || states.size) return;
    listening = false; observer?.disconnect(); observer = null;
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('keydown', keyDown);
    window.removeEventListener('resize', schedulePosition);
    window.removeEventListener('scroll', schedulePosition, true);
    window.visualViewport?.removeEventListener('resize', schedulePosition);
    window.visualViewport?.removeEventListener('scroll', schedulePosition);
  }
  function dispose(owner) {
    if (!owner) { for (const state of [...states]) dispose(state.owner); return; }
    const state = owners.get(owner);
    if (!state) return;
    close(state); state.popup?.remove(); owners.delete(owner); states.delete(state); removeListeners();
  }
  function render(strip, badgeNodes, options = {}) {
    if (!strip?.replaceChildren) return;
    const nodes = Array.from(badgeNodes || []).filter(node => node && typeof node === 'object');
    const owner = options.owner || strip;
    strip.classList.add('iwtxz-badge-overflow');
    strip.replaceChildren(...nodes.slice(0, limit));
    if (nodes.length <= limit) { dispose(owner); return; }
    let state = owners.get(owner);
    const signature = nodes.map(keyFor).join('\u0002');
    const changed = state && state.signature !== signature;
    if (!state) {
      state = { owner, open: false, pinned: false, selected: 0, closeTimer: 0 };
      owners.set(owner, state); states.add(state); ensureListeners();
    }
    Object.assign(state, { strip, nodes, signature });
    // Discord cards are themselves copy buttons in both renderers. A focusable
    // role button avoids invalid nested native buttons and owns its key events.
    const counter = make('span', 'iwtxz-badge-overflow-count', `+${nodes.length - limit}`);
    counter.setAttribute('role', 'button'); counter.tabIndex = 0; counter.setAttribute('aria-haspopup', 'dialog');
    counter.setAttribute('aria-expanded', String(state.open));
    counter.setAttribute('aria-label', `Ещё ${nodes.length - limit} значков. Показать все ${nodes.length}`);
    if (state.popup) counter.setAttribute('aria-controls', state.popup.id);
    state.counter = counter;
    counter.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(state); });
    counter.addEventListener('pointerleave', () => closeLater(state));
    counter.addEventListener('focus', () => { if (!state.skipFocusOpen) open(state); });
    counter.addEventListener('blur', () => closeLater(state));
    counter.addEventListener('click', event => {
      event.stopPropagation(); event.preventDefault();
      if (state.open && state.pinned) close(state); else open(state, true);
    });
    counter.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'ArrowDown') { event.preventDefault(); open(state, true, true); }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (state.open && state.pinned) close(state); else open(state, true);
      } else if (event.key === 'Escape' && state.open) { event.preventDefault(); close(state, true); }
    });
    counter.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); } });
    strip.append(counter);
    if (state.popup && changed) buildPopup(state);
    if (state.open) schedulePosition();
  }
  window.IwtxzBadgeOverflow = Object.freeze({ render, dispose, limit });
})();
