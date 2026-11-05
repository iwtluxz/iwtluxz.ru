(() => {
  'use strict';
  if (window.IwtxzHalloween) return;

  const art = {
    ghost: '<svg viewBox="0 0 80 92" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 77V37C12 1 68 1 68 37v40L57 70l-9 9-9-8-11 8-7-8-9 6Z" fill="#e9e2ff"/><path d="M15 40c0-30 45-37 51-7" stroke="#fff" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/><ellipse cx="31" cy="38" rx="4.5" ry="7" fill="#281638"/><ellipse cx="50" cy="38" rx="4.5" ry="7" fill="#281638"/><ellipse cx="41" cy="56" rx="5" ry="6" fill="#281638"/><circle cx="24" cy="49" r="4" fill="#b895f4" fill-opacity=".5"/><circle cx="57" cy="49" r="4" fill="#b895f4" fill-opacity=".5"/></svg>',
    pumpkin: '<svg viewBox="0 0 100 92" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m48 26 2-15 12-7 5 9-10 6-1 10" fill="#7c9b4d"/><ellipse cx="29" cy="53" rx="24" ry="29" fill="#d84c17"/><ellipse cx="71" cy="53" rx="24" ry="29" fill="#d84c17"/><ellipse cx="50" cy="55" rx="29" ry="32" fill="#f57c25"/><path d="M50 25c-13 12-13 45 0 61m0-61c13 12 13 45 0 61" stroke="#d85c18" stroke-width="3"/><path d="m25 48 16-10 1 17-17-7Zm50 0L59 38l-1 17 17-7ZM27 65l13 3 3-7 8 7 7-6 3 7 13-4c-4 21-41 22-47 0Z" fill="#301222"/><path d="m30 47 9-6 1 10-10-4Zm40 0-9-6-1 10 10-4Z" fill="#ffd879"/></svg>',
    candy: '<svg viewBox="0 0 110 58" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m30 22-21-12 4 19-4 19 23-13M80 22l21-12-4 19 4 19-23-13" fill="#b593ed"/><rect x="27" y="8" width="57" height="42" rx="17" fill="#f18b3f"/><path d="m38 11 18 36m3-36 17 32" stroke="#ffe2af" stroke-width="10"/><path d="m14 23 10 5m-10 8 10-5m72-8-10 5m10 8-10-5" stroke="#7450a9" stroke-width="3" stroke-linecap="round"/></svg>',
    sweet: '<svg viewBox="0 0 70 90" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M33 50h6v34h-6z" fill="#ead7bf"/><circle cx="35" cy="31" r="27" fill="#9568d7"/><path d="M35 9c-26 0-28 39-2 43 22 4 30-31 9-34-18-3-22 22-7 23 10 1 12-12 3-13" stroke="#edc9ff" stroke-width="6" stroke-linecap="round"/></svg>',
    bat: '<svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M58 23 50 9l-2 20C37 21 24 15 6 7c4 14 6 28 7 40 14-8 23-9 31 4 9-8 13-4 16 8 3-12 7-16 16-8 8-13 17-12 31-4 1-12 3-26 7-40-18 8-31 14-42 22L70 9l-8 14Z" fill="#7953a3"/><path d="m54 32 4 2m8-2-4 2" stroke="#ffb365" stroke-width="3" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="m20 1 4 15 15 4-15 4-4 15-4-15-15-4 15-4Z" fill="#ffd5a1"/></svg>'
  };

  let instance;
  function create(options = {}) {
    if (instance) return instance;
    const cabinet = options.cabinet ?? Boolean(document.getElementById('authForm'));
    const controller = new AbortController();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const preview = new URLSearchParams(location.search).has('preview') || window.parent !== window;
    let enabled = false, soundEnabled = false, previewSuspended = false, audio, scene, controls, themeButton, soundButton;
    let timer = 0, disposed = false, lastSound = -Infinity;
    const nodes = new Set();
    const listen = (node, event, callback, extra = {}) => node.addEventListener(event, callback, { ...extra, signal: controller.signal });

    function preference() {
      try { return localStorage.getItem('iwtxz:halloween:enabled') !== '0'; } catch { return true; }
    }
    function remember(value) {
      try { localStorage.setItem('iwtxz:halloween:enabled', value ? '1' : '0'); } catch {}
    }
    function svg(type, className) {
      const node = document.createElement('span');
      node.className = className;
      node.innerHTML = art[type] || art.star;
      node.setAttribute('aria-hidden', 'true');
      return node;
    }
    function decorate() {
      if (scene) return;
      scene = document.createElement('div');
      scene.className = 'halloween-scene';
      scene.setAttribute('aria-hidden', 'true');
      const items = [
        ['ghost', 4, 19, 83, 0], ['candy', 18, 8, 62, 3], ['bat', 38, 4, 83, 1],
        ['star', 50, 13, 13, 2], ['sweet', 74, 7, 48, 4], ['ghost', 90, 20, 70, 2],
        ['candy', 96, 49, 65, 5], ['bat', 2, 59, 75, 3], ['sweet', 8, 79, 58, 1],
        ['candy', 28, 91, 60, 2], ['star', 49, 94, 14, 3], ['ghost', 76, 85, 58, 5],
        ['pumpkin', 93, 87, 102, 0], ['pumpkin', 3, 94, 116, 1], ['star', 86, 62, 11, 4],
        ['star', 13, 42, 13, 1], ['candy', 64, 3, 46, 5], ['bat', 60, 95, 65, 4]
      ];
      items.forEach(([type, x, y, size, delay], index) => {
        const piece = svg(type, `halloween-piece halloween-piece-${type}`);
        piece.style.setProperty('--hw-x', `${x}%`);
        piece.style.setProperty('--hw-y', `${y}%`);
        piece.style.setProperty('--hw-size', `${size}px`);
        piece.style.setProperty('--hw-delay', `${-delay}s`);
        piece.style.setProperty('--hw-turn', `${index % 2 ? -16 : 13}deg`);
        scene.append(piece);
      });
      scene.append(svg('ghost', 'halloween-wandering-ghost'));
      document.body.prepend(scene);
      nodes.add(scene);
    }
    function mountControls() {
      if (controls) return;
      controls = document.createElement('div');
      controls.className = `halloween-controls${cabinet ? ' halloween-controls-cabinet' : ''}`;
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Хэллоуин');
      if (cabinet) {
        themeButton = document.createElement('button');
        themeButton.type = 'button';
        themeButton.className = 'halloween-theme-toggle';
        themeButton.append(svg('pumpkin', 'halloween-control-icon'), document.createTextNode('Хэллоуин'));
        listen(themeButton, 'click', () => { setEnabled(!enabled); remember(enabled); });
        controls.append(themeButton);
      }
      soundButton = document.createElement('button');
      soundButton.type = 'button';
      soundButton.className = 'halloween-sound-toggle';
      soundButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12-1c3 2 3 6 0 8m3-11c5 4 5 10 0 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Звуки</span>';
      listen(soundButton, 'click', async () => {
        if (!enabled) return;
        if (soundEnabled) { setSound(false); return; }
        try {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw new Error('Audio unavailable');
          audio ||= new Audio();
          await audio.resume();
          if (disposed || !enabled) return;
          setSound(true);
          chime('welcome');
        } catch {
          setSound(false);
          soundButton.title = 'Этот браузер не разрешил звук';
        }
      });
      controls.append(soundButton);
      const host = cabinet ? document.querySelector('.topbar') : null;
      (host || document.body).append(controls);
      nodes.add(controls);
      updateControls();
    }
    function updateControls() {
      if (!controls) return;
      controls.hidden = !cabinet && !enabled;
      if (themeButton) {
        themeButton.setAttribute('aria-pressed', String(enabled));
        themeButton.title = enabled ? 'Выключить хэллоуинскую тему' : 'Включить хэллоуинскую тему';
      }
      soundButton.hidden = !enabled || preview;
      soundButton.setAttribute('aria-pressed', String(soundEnabled));
      soundButton.setAttribute('aria-label', soundEnabled ? 'Выключить звуки Хэллоуина' : 'Включить звуки Хэллоуина');
      soundButton.title = soundEnabled ? 'Звуки включены' : 'Звуки выключены';
    }
    function chime(kind = 'candy') {
      if (!soundEnabled || !enabled || document.hidden || previewSuspended || preview || audio?.state !== 'running') return;
      const now = audio.currentTime;
      if (now - lastSound < .35) return;
      lastSound = now;
      const frequencies = kind === 'ghost' ? [523.25, 493.88, 392] : kind === 'welcome' ? [523.25, 622.25, 783.99, 1046.5] : [783.99, 1046.5];
      frequencies.forEach((frequency, i) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = now + i * .13;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        if (kind === 'ghost') oscillator.frequency.exponentialRampToValueAtTime(frequency * .82, start + .45);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.035, start + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .55);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(start); oscillator.stop(start + .6);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    }
    function schedule() {
      clearTimeout(timer);
      if (enabled && soundEnabled && !document.hidden && !previewSuspended && !preview) {
        timer = setTimeout(() => { chime('ghost'); schedule(); }, 28000);
      }
    }
    function setSound(value) {
      soundEnabled = Boolean(value);
      if (!soundEnabled && audio?.state === 'running') void audio.suspend().catch(() => {});
      updateControls(); schedule();
    }
    function setEnabled(value) {
      enabled = Boolean(value);
      document.body.classList.toggle('iwtxz-halloween', enabled);
      document.body.dataset.halloweenSurface = cabinet ? 'cabinet' : 'profile';
      if (enabled) decorate();
      if (scene) scene.hidden = !enabled;
      if (!enabled) setSound(false);
      mountControls(); updateControls(); schedule();
    }
    function updatePause() {
      const paused = document.hidden || previewSuspended;
      document.body.classList.toggle('halloween-paused', paused);
      if (paused && audio?.state === 'running') void audio.suspend().catch(() => {});
      else if (soundEnabled) void audio?.resume().catch(() => {});
      schedule();
    }
    listen(document, 'visibilitychange', updatePause);
    listen(window, 'iwtxz-preview-visibility', event => { previewSuspended = event.detail === false; updatePause(); });
    listen(document, 'click', (event) => {
      if (!soundEnabled || !event.isTrusted || controls?.contains(event.target)) return;
      if (event.target.closest('button:not([disabled]), a[href]')) chime();
    });
    listen(window, 'storage', event => {
      if (cabinet && event.key === 'iwtxz:halloween:enabled') setEnabled(preference());
    });
    const motion = () => document.body.classList.toggle('halloween-reduced-motion', reduced.matches);
    listen(reduced, 'change', motion); motion();
    instance = {
      apply(settings = {}) { if (!cabinet) setEnabled(settings.seasonalTheme === 'halloween' || settings.seasonalTheme === true); },
      dispose() {
        disposed = true; clearTimeout(timer); controller.abort();
        void audio?.close().catch(() => {});
        nodes.forEach(node => node.remove());
        document.body.classList.remove('iwtxz-halloween', 'halloween-paused', 'halloween-reduced-motion');
        delete document.body.dataset.halloweenSurface;
        instance = undefined;
      }
    };
    if (cabinet) setEnabled(preference());
    return instance;
  }
  window.IwtxzHalloween = Object.freeze({ create });
  if (document.getElementById('authForm')) create({ cabinet: true });
})();
