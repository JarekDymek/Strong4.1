// js/cloudSync.js
// Cloud checkpoints for using one competition on more than one trusted device.

import { FIREBASE_CONFIG } from './judge.js';
import { getState, restoreState } from './state.js';
import { isTrialMode } from './trialMode.js';

export const CLOUD_APP_VERSION = '2.3.6';

const CLOUD_ID_KEY = 'strongman_cloud_sync_id_v1';
const DEVICE_ID_KEY = 'strongman_cloud_device_id_v1';
const LAST_PULL_KEY = 'strongman_cloud_last_pull_ts_v1';
const LAST_PUSH_KEY = 'strongman_cloud_last_push_ts_v1';
const LAST_LOCAL_DIRTY_KEY = 'strongman_cloud_last_local_dirty_ts_v1';
const PUSH_DELAY = 1800;
const CONFLICT_GRACE_MS = 2500;

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

function numberFromStorage(key) {
  return Number(localStorage.getItem(key) || 0);
}

function setNumberStorage(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) {}
}

function markLocalDirty(ts = Date.now()) {
  setNumberStorage(LAST_LOCAL_DIRTY_KEY, ts);
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

export function extractCloudIdFromText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.searchParams.get('sync') || '';
  } catch (_) {}
  const match = text.match(/(?:sync=)?(cloud_[A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

export function adoptCloudSessionFromText(value) {
  const id = extractCloudIdFromText(value);
  if (!id) return '';
  setCloudSessionId(id);
  cloudIdFromUrl = true;
  return id;
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
  markLocalDirty(updatedAt);
  const payload = {
    cloudId: id,
    deviceId: getDeviceId(),
    label,
    updatedAt,
    appVersion: CLOUD_APP_VERSION,
    state: compactStateForCloud(getState()),
  };
  await fbFn.set(fbFn.ref(firebaseDb, 'cloudStates/' + id + '/latest'), payload);
  setNumberStorage(LAST_PUSH_KEY, updatedAt);
  window.dispatchEvent(new CustomEvent('strongman:cloud-pushed', { detail: payload }));
  return { ok: true, payload };
}

export function queueCloudPush(label = 'Autozapis') {
  if (isTrialMode()) return;
  markLocalDirty();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateToCloud(label).catch(err => {
      lastError = err?.message || String(err);
      window.dispatchEvent(new CustomEvent('strongman:cloud-error', { detail: { message: lastError } }));
    });
  }, PUSH_DELAY);
}

function shouldBlockPull(payload, options = {}) {
  if (options.force) return false;
  const remoteTs = Number(payload?.updatedAt || 0);
  const localDirtyTs = numberFromStorage(LAST_LOCAL_DIRTY_KEY);
  const lastPushTs = numberFromStorage(LAST_PUSH_KEY);
  const localHasUnpushedOrNewerWork = localDirtyTs > Math.max(lastPushTs, remoteTs) + CONFLICT_GRACE_MS;
  return localHasUnpushedOrNewerWork;
}

export async function pullStateFromCloud(options = {}) {
  if (isTrialMode()) return { ok: false, reason: 'trial' };
  const ready = await initFirebase();
  if (!ready) return { ok: false, reason: lastError || 'offline' };
  const id = getCloudSessionId();
  const snap = await fbFn.get(fbFn.ref(firebaseDb, 'cloudStates/' + id + '/latest'));
  if (!snap.exists()) return { ok: false, reason: 'empty' };
  const payload = snap.val();
  if (!payload?.state) return { ok: false, reason: 'invalid' };
  if (shouldBlockPull(payload, options)) {
    return { ok: false, reason: 'local-newer', payload };
  }
  restoreState(payload.state);
  const pulledAt = Number(payload.updatedAt || Date.now());
  setNumberStorage(LAST_PULL_KEY, pulledAt);
  setNumberStorage(LAST_LOCAL_DIRTY_KEY, pulledAt);
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
    deviceId: getDeviceId(),
    lastPull: numberFromStorage(LAST_PULL_KEY),
    lastPush: numberFromStorage(LAST_PUSH_KEY),
    lastLocalDirty: numberFromStorage(LAST_LOCAL_DIRTY_KEY),
    lastError,
    disabled: isTrialMode(),
  };
}
