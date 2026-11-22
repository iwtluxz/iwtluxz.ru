(() => {
  'use strict';

  if (window.TelegramNotification) return;

  const STORAGE_KEY = 'iwtxz:telegram-notification-opt-out';
  const SHOW_DELAY_MIN = 5000;
  const SHOW_DELAY_MAX = 10000;
  const AUTO_DISMISS_DELAY = 8000;

  const telegramIcon = `<svg viewBox="-1 .3 24 24" aria-hidden="true"><path d="m21.6 3.2-3.2 17c-.24 1.2-.88 1.5-1.8.94l-4.88-3.6-2.36 2.28c-.27.26-.5.48-1.02.48l.35-4.97 9.05-8.17c.4-.35-.08-.55-.6-.2L6 13.99l-4.79-1.5c-1.04-.32-1.06-1.03.22-1.53l18.73-7.22c.87-.32 1.63.2 1.44 1.46Z"/></svg>`;

  const arrowIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

  function createNotification() {
    const container = document.createElement('div');
    container.className = 'telegram-notification';

    const content = document.createElement('div');
    content.className = 'telegram-notification-content';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'telegram-notification-icon';
    iconWrapper.innerHTML = telegramIcon;

    const textWrapper = document.createElement('div');
    textWrapper.className = 'telegram-notification-text';

    const title = document.createElement('h2');
    title.className = 'telegram-notification-title';
    title.textContent = 'Присоединись к Telegram';

    const description = document.createElement('p');
    description.className = 'telegram-notification-description';
    description.textContent = 'Следи за новостями проекта и общайся с сообществом в нашем Telegram канале.';

    const link = document.createElement('a');
    link.className = 'telegram-notification-link';
    link.href = 'https://t.me/iwt_su';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Перейти в Telegram канал @iwt_su');
    link.innerHTML = `Открыть канал ${arrowIcon}`;

    const neverButton = document.createElement('button');
    neverButton.className = 'telegram-notification-never';
    neverButton.type = 'button';
    neverButton.textContent = 'Не показывать снова';

    const actions = document.createElement('div');
    actions.className = 'telegram-notification-actions';
    actions.append(link, neverButton);

    const error = document.createElement('p');
    error.className = 'telegram-notification-error';
    error.setAttribute('role', 'alert');

    textWrapper.append(title, description, actions, error);

    const closeButton = document.createElement('button');
    closeButton.className = 'telegram-notification-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Закрыть уведомление');
    closeButton.innerHTML = '&times;';

    content.append(iconWrapper, textWrapper, closeButton);
    container.append(content);

    return { container, closeButton, neverButton, error };
  }

  function isDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (error) {
      console.warn('Не удалось проверить настройки уведомления Telegram.', error);
      return false;
    }
  }

  function markAsDismissed() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
      return true;
    } catch (error) {
      console.warn('Не удалось сохранить настройки уведомления Telegram.', error);
      return false;
    }
  }

  function show() {
    // Не показываем если уже было закрыто
    if (isDismissed()) return;

    // Не показываем если уже есть уведомление на странице
    if (document.querySelector('.telegram-notification')) return;

    const { container, closeButton, neverButton, error } = createNotification();
    let autoDismissTimer;
    let leaving = false;

    // Добавляем на страницу
    document.body.append(container);

    // Небольшая задержка для активации анимации
    requestAnimationFrame(() => {
      container.classList.add('is-visible');
    });

    function dismiss() {
      if (leaving) return;
      leaving = true;
      clearTimeout(autoDismissTimer);
      container.classList.add('is-leaving');
      setTimeout(() => {
        container.remove();
      }, 500);
    }

    // Закрытие по кнопке
    closeButton.addEventListener('click', dismiss);

    neverButton.addEventListener('click', () => {
      if (markAsDismissed()) {
        dismiss();
      } else {
        error.textContent = 'Не удалось сохранить настройку в браузере.';
      }
    });

    // Автоматическое закрытие через некоторое время
    autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_DELAY);

    // Отмена автозакрытия при наведении
    container.addEventListener('mouseenter', () => {
      clearTimeout(autoDismissTimer);
    });

    container.addEventListener('mouseleave', () => {
      if (container.contains(document.activeElement)) return;
      clearTimeout(autoDismissTimer);
      autoDismissTimer = setTimeout(dismiss, 3000);
    });

    container.addEventListener('focusin', () => {
      clearTimeout(autoDismissTimer);
    });

    container.addEventListener('focusout', (event) => {
      if (container.contains(event.relatedTarget) || container.matches(':hover')) return;
      clearTimeout(autoDismissTimer);
      autoDismissTimer = setTimeout(dismiss, 3000);
    });
  }

  function init() {
    const delay = SHOW_DELAY_MIN + Math.random() * (SHOW_DELAY_MAX - SHOW_DELAY_MIN);
    setTimeout(show, delay);
  }

  // Инициализируем когда DOM готов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TelegramNotification = Object.freeze({ show, isDismissed, markAsDismissed });
})();
