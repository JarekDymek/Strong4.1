// js/trialMode.js
// Limited 3-day offline/training mode for third-party links.

const TRIAL_KEY = 'strongman_trial_license_v1';
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
let currentTrial = null;

function now() { return Date.now(); }

function readStored() {
  try { return JSON.parse(localStorage.getItem(TRIAL_KEY) || 'null'); }
  catch (_) { return null; }
}

function writeStored(value) {
  try { localStorage.setItem(TRIAL_KEY, JSON.stringify(value)); } catch (_) {}
}

export function initTrialMode() {
  try {
    const url = new URL(location.href);
    const trial = url.searchParams.get('trial');
    const exp = Number(url.searchParams.get('exp'));
    if (trial === '1' && Number.isFinite(exp)) {
      currentTrial = { enabled: true, expiresAt: exp, createdAt: now() };
      writeStored(currentTrial);
    } else {
      currentTrial = readStored();
    }
  } catch (_) {
    currentTrial = readStored();
  }

  if (currentTrial?.enabled) {
    document.body.classList.add('trial-mode');
    if (isTrialExpired()) document.body.classList.add('trial-expired');
  }
  return currentTrial;
}

export function isTrialMode() {
  return Boolean(currentTrial?.enabled || readStored()?.enabled);
}

export function isTrialExpired() {
  const trial = currentTrial || readStored();
  return Boolean(trial?.enabled && now() > Number(trial.expiresAt || 0));
}

export function getTrialDaysLeft() {
  const trial = currentTrial || readStored();
  if (!trial?.enabled) return null;
  return Math.max(0, Math.ceil((Number(trial.expiresAt || 0) - now()) / (24 * 60 * 60 * 1000)));
}

export function createTrialLink() {
  const url = new URL(location.href);
  url.searchParams.delete('sync');
  url.searchParams.set('trial', '1');
  url.searchParams.set('exp', String(now() + THREE_DAYS));
  url.hash = '';
  return url.href;
}

export function shouldBlockRestrictedCloudFeature() {
  return isTrialMode() || isTrialExpired();
}
