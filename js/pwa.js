/*
PWA helper: install prompts, persistent storage and visible update flow.
*/
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredPrompt = null;
let updateRegistration = null;
let refreshing = false;

function ensureUpdateBanner() {
  let banner = document.getElementById('pwaUpdateBanner');
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'pwaUpdateBanner';
  banner.className = 'pwa-update-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <div class="pwa-update-text">
      <strong>Nowa wersja aplikacji jest dostępna</strong>
      <span>Dotknij, aby wczytać aktualizację z GitHub.</span>
    </div>
    <button id="pwaUpdateReloadBtn" class="pwa-update-btn" type="button">Wgraj nową wersję</button>
    <button id="pwaUpdateDismissBtn" class="pwa-update-dismiss" type="button" aria-label="Ukryj komunikat">Zamknij</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#pwaUpdateReloadBtn')?.addEventListener('click', () => {
    const waiting = updateRegistration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if (updateRegistration?.update) {
      updateRegistration.update();
    }
  });
  banner.querySelector('#pwaUpdateDismissBtn')?.addEventListener('click', () => {
    banner.classList.remove('show');
  });
  return banner;
}

function showUpdateBanner(registration) {
  updateRegistration = registration;
  ensureUpdateBanner().classList.add('show');
}

function watchRegistration(registration) {
  updateRegistration = registration;

  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(registration);
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBanner(registration);
      }
    });
  });

  setInterval(() => registration.update().catch(() => {}), 10 * 60 * 1000);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    console.log('SW registered:', registration.scope);
    watchRegistration(registration);
    registration.update().catch(() => {});
  } catch (error) {
    console.log('SW failed:', error);
  }
}

export function initPWA() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist()
      .then(p => console.log('Storage.persisted:', p))
      .catch(err => console.warn('persist() error', err));
  }

  if (isiOS && !window.matchMedia('(display-mode: standalone)').matches) {
    const modal = document.getElementById('ios-install-modal');
    if (modal) {
      modal.style.display = 'block';
      const close = document.getElementById('ios-install-close');
      close && close.addEventListener('click', () => modal.style.display = 'none');
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-install-available'));
  });

  window.triggerPWAInstall = async function() {
    if (!deferredPrompt) {
      console.log('No deferred prompt available');
      return null;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return choice;
  };

  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA);
} else {
  initPWA();
}
