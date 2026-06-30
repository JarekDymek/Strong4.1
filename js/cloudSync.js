// js/cloudSync.js
// Cloud checkpoints for using one competition on more than one trusted device.

import { FIREBASE_CONFIG } from './judge.js';
import { getState, restoreState } from './state.js';
import { isTrialMode } from './trialMode.js';

const CLOUD_ID_KEY = 'strongman_cloud_sync_id_v1';
const DEVICE_ID_KEY = 'strongman_cloud_device_id_v1';
const LAST_PULL_KEY = 'strongman_cloud_last_pull_ts_v1';
const LAST_PUSH_KEY = 'strongman_cloud_last_push_ts_v1';
const PUSH_DELAY = 1800;

let firebaseDb = null;
let fbFn = null;
let pushTimer = null;
let lastError = '';
let cloudIdFromUrl = false;

function configured() {
  return FIREBASE_CONFIG?.apiKey && !String(FIREBASE_CONFIG.apiKey).startsWith('WPISZ');
}

function randomId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function getCloudSessionId() {
  let id = localStorage.getItem(CLOUD_ID_KEY);
  if (!id) {
    id = randomId('cloud');
    localStorage.setItem(CLOUD_ID_KEY, id);
  }
  return id;
}

export function setCloudSessionId(id) {
  const clean = String(id || '').trim();
  if (!clean) return getCloudSessionId();
  localStorage.setItem(CLOUD_ID_KEY, clean);
  return clean;
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = randomId('device');
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function applyCloudIdFromUrl() {
  try {
    const url = new URL(location.href);
    const id = url.searchParams.get('sync');
    if (id) {
      setCloudSessionId(id);
      cloudIdFromUrl = true;
    }
  } catch (_) {}
}

async function initFirebase() {
  if (firebaseDb && fbFn) return true;
  if (!configured() || isTrialMode()) return false;
  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    firebaseDb = dbModule.getDatabase(app);
    fbFn = { ref: dbModule.ref, set: dbModule.set, get: dbModule.get };
    lastError = '';
    return true;
  } catch (err) {
    lastError = err?.message || String(err);
    return false;
  }
}

function compactStateForCloud(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

export async function pushStateToCloud(label = 'Autozapis') {
  if (isTrialMode()) return { ok: false, reason: 'trial' };
  const ready = await initFirebase();
  if (!ready) return { ok: false, reason: lastError || 'offline' };
  const id = getCloudSessionId();
  const updatedAt = Date.now();
  const payload = {
    cloudId: id,
    deviceId: getDeviceId(),
    label,
    updatedAt,
    appVersion: '2.3.0',
    state: compactStateForCloud(getState()),
  };
  await fbFn.set(fbFn.ref(firebaseDb, 'cloudStates/' + id + '/latest'), payload);
  localStorage.setItem(LAST_PUSH_KEY, String(updatedAt));
  window.dispatchEvent(new CustomEvent('strongman:cloud-pushed', { detail: payload }));
  return { ok: true, payload };
}

export function queueCloudPush(label = 'Autozapis') {
  if (isTrialMode()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateToCloud(label).catch(err => {
      lastError = err?.message || String(err);
      window.dispatchEvent(new CustomEvent('strongman:cloud-error', { detail: { message: lastError } }));
    });
  }, PUSH_DELAY);
}

export async function pullStateFromCloud() {
  if (isTrialMode()) return { ok: false, reason: 'trial' };
  const ready = await initFirebase();
  if (!ready) return { ok: false, reason: lastError || 'offline' };
  const id = getCloudSessionId();
  const snap = await fbFn.get(fbFn.ref(firebaseDb, 'cloudStates/' + id + '/latest'));
  if (!snap.exists()) return { ok: false, reason: 'empty' };
  const payload = snap.val();
  if (!payload?.state) return { ok: false, reason: 'invalid' };
  restoreState(payload.state);
  localStorage.setItem(LAST_PULL_KEY, String(payload.updatedAt || Date.now()));
  window.dispatchEvent(new CustomEvent('strongman:cloud-pulled', { detail: payload }));
  return { ok: true, payload };
}

export function wasCloudIdProvidedInUrl() {
  return cloudIdFromUrl;
}

export function getCloudShareUrl() {
  const url = new URL(location.href);
  url.searchParams.set('sync', getCloudSessionId());
  url.hash = '';
  return url.href;
}

export function getCloudStatus() {
  return {
    cloudId: getCloudSessionId(),
    lastPull: Number(localStorage.getItem(LAST_PULL_KEY) || 0),
    lastPush: Number(localStorage.getItem(LAST_PUSH_KEY) || 0),
    lastError,
    disabled: isTrialMode(),
  };
}
