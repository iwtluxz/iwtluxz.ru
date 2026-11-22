(() => {
  'use strict';

  if (window.TelegramNotification) return;

  const STORAGE_KEY = 'iwtxz:telegram-notification-dismissed';
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

    textWrapper.append(title, description, link);

    const closeButton = document.createElement('button');
    closeButton.className = 'telegram-notification-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Закрыть уведомление');
    closeButton.innerHTML = '&times;';

    content.append(iconWrapper, textWrapper, closeButton);
    container.append(content);

    return { container, closeButton, link };
  }

  function isDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markAsDismissed() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
  }

  function show() {
    // Не показываем если уже было закрыто
    if (isDismissed()) return;

    // Не показываем если уже есть уведомление на странице
    if (document.querySelector('.telegram-notification')) return;

    const { container, closeButton, link } = createNotification();

    // Добавляем на страницу
    document.body.append(container);

    // Небольшая задержка для активации анимации
    requestAnimationFrame(() => {
      container.classList.add('is-visible');
    });

    function dismiss() {
      container.classList.add('is-leaving');
      setTimeout(() => {
        container.remove();
      }, 500);
      markAsDismissed();
    }

    // Закрытие по кнопке
    closeButton.addEventListener('click', dismiss);

    // Закрытие при клике на ссылку
    link.addEventListener('click', () => {
      markAsDismissed();
    });

    // Автоматическое закрытие через некоторое время
    const autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_DELAY);

    // Отмена автозакрытия при наведении
    container.addEventListener('mouseenter', () => {
      clearTimeout(autoDismissTimer);
    });

    container.addEventListener('mouseleave', () => {
      const newTimer = setTimeout(dismiss, 3000);
      autoDismissTimer !== newTimer && clearTimeout(autoDismissTimer);
    });
  }

  function init() {
    // Инициализируем только если не в кабинете редактора
    const isEditor = Boolean(document.getElementById('authForm'));
    if (isEditor) {
      // Показываем уведомление с задержкой после того, как пользователь залогинился
      const delay = SHOW_DELAY_MIN + Math.random() * (SHOW_DELAY_MAX - SHOW_DELAY_MIN);
      setTimeout(() => {
        // Проверяем, залогинен ли пользователь
        const authPanel = document.getElementById('authPanel');
        if (authPanel && authPanel.classList.contains('hidden')) {
          show();
        }
      }, delay);
    } else {
      // На обычных страницах показываем с задержкой 5-10 сек после загрузки
      const delay = SHOW_DELAY_MIN + Math.random() * (SHOW_DELAY_MAX - SHOW_DELAY_MIN);
      setTimeout(show, delay);
    }
  }

  // Инициализируем когда DOM готов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TelegramNotification = Object.freeze({ show, isDismissed, markAsDismissed });
})();
