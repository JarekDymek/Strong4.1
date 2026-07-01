/*
PWA helper: install prompts, persistent storage and visible update flow.
*/
const CURRENT_APP_VERSION = '2.3.5';
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredPrompt = null;
let updateRegistration = null;
let refreshing = false;

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function setUpdateButtonVisible(visible, label = 'Aktualizuj') {
  const btn = document.getElementById('manualUpdateBtn');
  if (!btn) return;
  btn.style.display = visible ? 'inline-flex' : 'none';
  btn.textContent = label;
}

function findScrollableParent(node) {
  let el = node instanceof Element ? node : node?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    if (canScrollY) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function blockPullToRefresh() {
  let startY = 0;
  let startX = 0;

  window.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) return;
    const currentY = event.touches[0].clientY;
    const currentX = event.touches[0].clientX;
    const deltaY = currentY - startY;
    const deltaX = Math.abs(currentX - startX);
    if (deltaY <= 0 || deltaX > Math.abs(deltaY)) return;

    const scrollable = findScrollableParent(event.target);
    const atTop = !scrollable || scrollable.scrollTop <= 0;
    if (atTop) event.preventDefault();
  }, { passive: false });
}

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
      <strong>Nowa wersja aplikacji jest dostepna</strong>
      <span>Dotknij, aby wczytac aktualizacje z GitHub.</span>
    </div>
    <button id="pwaUpdateReloadBtn" class="pwa-update-btn" type="button">Wgraj nowa wersje</button>
    <button id="pwaUpdateDismissBtn" class="pwa-update-dismiss" type="button" aria-label="Ukryj komunikat">Zamknij</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#pwaUpdateReloadBtn')?.addEventListener('click', () => {
    forcePWAUpdate();
  });
  banner.querySelector('#pwaUpdateDismissBtn')?.addEventListener('click', () => {
    banner.classList.remove('show');
  });
  return banner;
}

function showUpdateBanner(registration = null) {
  if (registration) updateRegistration = registration;
  setUpdateButtonVisible(true, 'Aktualizuj');
  ensureUpdateBanner().classList.add('show');
}

async function checkRemoteVersion() {
  try {
    const response = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) return;
    const remote = await response.json();
    if (compareVersions(remote.version, CURRENT_APP_VERSION) > 0) {
      showUpdateBanner(updateRegistration);
    }
  } catch (err) {
    console.debug('Version check skipped:', err?.message || err);
  }
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

  setInterval(() => {
    registration.update().catch(() => {});
    checkRemoteVersion();
  }, 10 * 60 * 1000);
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

async function forcePWAUpdate() {
  const btn = document.getElementById('manualUpdateBtn');
  const oldText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Sprawdzam...'; }
  try {
    if ('serviceWorker' in navigator) {
      const registration = updateRegistration || await navigator.serviceWorker.getRegistration('./');
      if (registration) {
        updateRegistration = registration;
        await registration.update().catch(() => {});
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
      }
    }
    const url = new URL(location.href);
    url.searchParams.set('v', String(Date.now()));
    location.replace(url.href);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText || 'Aktualizuj';
    }
  }
}

export function initPWA() {
  setUpdateButtonVisible(false);

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

  window.forcePWAUpdate = forcePWAUpdate;
  document.getElementById('manualUpdateBtn')?.addEventListener('click', forcePWAUpdate);

  blockPullToRefresh();
  registerServiceWorker().finally(checkRemoteVersion);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA);
} else {
  initPWA();
}
