
// Plik: js/persistence.js (Zmieniona wersja - async IndexedDB autosave z opcją wyłączenia)
// Cel: Zarządza utrwalaniem stanu i eksportami. Autosave przeniesiony z localStorage do IndexedDB,
// co zapobiega blokowaniu głównego wątku. Dodano opcję włączenia/wyłączenia autosave.

import { getState, restoreState, resetState } from './state.js';
import { showNotification, showConfirmation, showPrompt, DOMElements, renderFinalSummary } from './ui.js';
import { clearHistory } from './history.js';
import * as CheckpointsDB from './checkpointsDb.js';

const AUTO_SAVE_DB_KEY = 'strongman_autoSave_v1';
const AUTO_SAVE_PREF_KEY = 'strongman_autosave_enabled_v1';
const THEME_KEY = 'strongmanTheme_v12';
const BACKUP_EMAIL_KEY = 'strongman_backup_email_v1';
const LAST_BACKUP_FILE_KEY = 'strongman_last_backup_file_v1';

let autoSaveTimer = null;
let autosaveEnabled = true;
const AUTOSAVE_DELAY = 1000; // ms debounce

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- IndexedDB helper (very small key-value store) ---
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('strongman-db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const req = store.put(value, key);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const req = store.get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = (e) => rej(e.target.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const req = store.delete(key);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

// Theme helpers (unchanged)
export function saveTheme(themeName) { localStorage.setItem(THEME_KEY, themeName); }
export function loadTheme() { return localStorage.getItem(THEME_KEY) || 'light'; }
export function setBackupEmail(email) {
  try { localStorage.setItem(BACKUP_EMAIL_KEY, String(email || '').trim()); } catch(e) {}
}
export function getBackupEmail() {
  try { return localStorage.getItem(BACKUP_EMAIL_KEY) || ''; } catch(e) { return ''; }
}

// --- Autosave preference ---
export function setAutosaveEnabled(flag) {
  autosaveEnabled = !!flag;
  try { localStorage.setItem(AUTO_SAVE_PREF_KEY, JSON.stringify(autosaveEnabled)); } catch(e) {}
}
export function isAutosaveEnabled() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_PREF_KEY);
    if (raw === null) return true;
    autosaveEnabled = JSON.parse(raw);
    return autosaveEnabled;
  } catch(e) { return true; }
}

// --- Autosave: debounce + async IDB save ---
let autosaveSuspended = false;

export function suspendAutosave() { autosaveSuspended = true; }
export function resumeAutosave() { autosaveSuspended = false; }

export function triggerAutoSave() {
    if (!isAutosaveEnabled()) return;
    if (autosaveSuspended) return;   // BUG-05 fix: suspended flag was never checked
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
        try {
            const stateObj = getState();
            await idbPut(AUTO_SAVE_DB_KEY, stateObj);
            import('./cloudSync.js').then(m => m.queueCloudPush('Autozapis')).catch(() => {});
            const indicator = document.getElementById('saveIndicator');
            if (indicator) {
              indicator.classList.add('visible');
              setTimeout(() => indicator.classList.remove('visible'), 1200);
            }
        } catch (e) {
            console.error('Async autosave failed', e);
            showNotification("Błąd auto-zapisu (IDB).", "error");
        } finally {
            autoSaveTimer = null;
        }
    }, AUTOSAVE_DELAY);
}

/**
 * Zapisuje autosave (IDB, nadpisywany) ORAZ osobny nazwany checkpoint
 * z opisem kontekstowym — np. "Po losowaniu", "Po Konkurencji 2 – Atlas Stones".
 * Wywoływany w kluczowych momentach zamiast zwykłego triggerAutoSave().
 *
 * @param {string} label - Opisowa nazwa punktu kontrolnego
 */
export function triggerAutoSaveWithContext(label) {
    triggerAutoSave();   // zawsze też zwykły autosave (nadpisywany)
    if (!isAutosaveEnabled()) return;
    // Zapis checkpointu z opóźnieniem AUTOSAVE_DELAY + 200ms,
    // żeby stan zdążył się ustabilizować przed snapshootem
    setTimeout(async () => {
        try {
            const st = getState();
            // BUG-10 fix: use shared sanitizeForIDB from utils.js instead of inline duplicate
            const { sanitizeForIDB } = await import('./utils.js');
            const record = {
                name: label,
                state: sanitizeForIDB(st) || {},
                timestamp: Date.now(),
                auto: true
            };
            await CheckpointsDB.saveCheckpoint(record);
            import('./cloudSync.js').then(m => m.queueCloudPush(label || 'Punkt kontrolny')).catch(() => {});
        } catch (e) {
            console.warn('triggerAutoSaveWithContext: checkpoint error', e);
        }
    }, AUTOSAVE_DELAY + 200);
}

// Load state from async IDB autosave (called at startup)
export async function loadStateFromAutoSave() {
    try {
        const loaded = await idbGet(AUTO_SAVE_DB_KEY);
        if (!loaded) return false;
        if (await showConfirmation("Wykryto niezakończoną sesję. Czy chcesz ją przywrócić?")) {
            restoreState(loaded);
            showNotification("Sesja została przywrócona!", "success");
            return true;
        } else {
            // user declined -> remove autosave
            await idbDelete(AUTO_SAVE_DB_KEY);
            return false;
        }
    } catch (e) {
        console.error('Failed to load autosave from IDB', e);
        return false;
    }
}

export async function clearAutoSave() {
  try { await idbDelete(AUTO_SAVE_DB_KEY); } catch(e) { console.warn('clearAutoSave failed', e); }
}

// --- Checkpoints (existing code expects CheckpointsDB usage) ---
// Forwarding to existing CheckpointsDB
export async function getCheckpoints() {
  return CheckpointsDB.getCheckpointsDB();
}
export async function deleteCheckpoint(key) {
  return CheckpointsDB.deleteCheckpoint(key);
}

// --- Import / Export functions (keep original behavior but use IDB where appropriate) ---

async function rememberLastBackup(backup) {
    try {
        await idbPut(LAST_BACKUP_FILE_KEY, {
            filename: backup.filename,
            blob: backup.blob,
            createdAt: Date.now(),
            contextLabel: backup.contextLabel || ''
        });
    } catch (err) {
        console.warn('rememberLastBackup failed', err);
    }
}

async function getLastSavedBackup(contextLabel) {
    try {
        const saved = await idbGet(LAST_BACKUP_FILE_KEY);
        if (saved?.blob && saved?.filename) return saved;
    } catch (err) {
        console.warn('getLastSavedBackup failed', err);
    }

    try {
        const checkpoints = await CheckpointsDB.getCheckpointsDB();
        const latest = checkpoints?.[0];
        if (latest?.state) return buildStateBackup(latest.name || contextLabel || 'Ostatni_punkt_kontrolny', latest.state);
    } catch (err) {
        console.warn('latest checkpoint backup fallback failed', err);
    }

    return null;
}

function downloadBackupFile(backup) {
    const url = URL.createObjectURL(backup.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backup.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function buildStateBackup(contextLabel, sourceState = null) {
    const data = sourceState || getState();
    const eventName  = (data.eventName || 'Zawody').replace(/[\s\/\\:*?"<>|]/g, '_').slice(0, 30);
    const eventNum   = data.eventNumber || 1;
    const eventTitle = (data.eventTitle || '').replace(/[\s\/\\:*?"<>|]/g, '_').slice(0, 25);
    const dateStr    = new Date().toLocaleDateString('pl-PL').replace(/\./g, '-');
    const timeStr    = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }).replace(/:/g, '-');
    let label        = contextLabel || `Konk_${eventNum}_${eventTitle}` || 'stan';
    label = label.replace(/[\s\/\\:*?"<>|]/g, '_').slice(0, 50);
    const filename   = `${eventName}_${label}_${dateStr}_${timeStr}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    return { data, filename, blob };
}

export async function exportStateToFile(contextLabel) {
    const backup = buildStateBackup(contextLabel);
    await rememberLastBackup({ ...backup, contextLabel });
    downloadBackupFile(backup);
    showNotification(`Backup zapisany: ${backup.filename}`, 'success', 2500);
    return backup;
}

export async function shareStateBackup(contextLabel) {
    let backup = await getLastSavedBackup(contextLabel);
    let usedExistingFile = true;
    if (!backup) {
        backup = buildStateBackup(contextLabel);
        usedExistingFile = false;
        await rememberLastBackup({ ...backup, contextLabel });
    }

    const email = getBackupEmail();
    const file = new File([backup.blob], backup.filename, { type: 'application/json' });
    const data = getState();
    const title = `Backup zawod\u00f3w: ${data.eventName || 'Strong Man'}`;
    const text = [
        `Backup stanu zawod\u00f3w: ${data.eventName || 'Strong Man'}`,
        `Konkurencja: ${data.eventNumber || 1} - ${data.eventTitle || ''}`,
        `Plik: ${backup.filename}`,
        usedExistingFile ? 'Do\u0142\u0105czony plik to ostatni zapisany backup/punkt kontrolny.' : 'Nie by\u0142o wcze\u015bniejszego pliku, wi\u0119c utworzono nowy backup.',
        email ? `Adres kopii: ${email}` : '',
        'Zachowaj ten plik. Mo\u017cna go wczyta\u0107 przez Importuj Stan.'
    ].filter(Boolean).join('\n');

    try {
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({ files: [file], title, text });
            showNotification('Backup z plikiem przekazany do udost\u0119pnienia.', 'success');
            return true;
        }
        if (navigator.share) {
            downloadBackupFile(backup);
            await navigator.share({ title, text });
            showNotification('Opis backupu udost\u0119pniony, a plik pobrany na urz\u0105dzenie.', 'info', 4500);
            return true;
        }
    } catch (err) {
        if (err?.name === 'AbortError') return false;
        console.warn('shareStateBackup failed', err);
    }

    downloadBackupFile(backup);
    if (email) {
        const subject = encodeURIComponent(title);
        const body = encodeURIComponent(text + '\n\nPlik zosta\u0142 pobrany na urz\u0105dzenie. Do\u0142\u0105cz go jako za\u0142\u0105cznik do tej wiadomo\u015bci, je\u015bli system nie zrobi\u0142 tego automatycznie.');
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    } else {
        showNotification('Plik backupu zosta\u0142 pobrany. Mo\u017cesz do\u0142\u0105czy\u0107 go r\u0119cznie do maila lub wiadomo\u015bci.', 'info', 5000);
    }
    return true;
}


export async function importStateFromFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!importedData.competitors || !importedData.eventHistory) {
                    throw new Error("Plik nie wygląda na prawidłowy plik stanu aplikacji.");
                }
                if (await showConfirmation("Czy na pewno chcesz zaimportować stan z pliku? Spowoduje to nadpisanie bieżącej sesji.")) {
                    restoreState(importedData);
                    clearHistory();
                    showNotification("Stan pomyślnie zaimportowano!", "success");
                    resolve(true);
                } else resolve(false);
            } catch(err) {
                console.error(err);
                showNotification("Błąd przy imporcie pliku.", "error");
                resolve(false);
            }
        };
        reader.readAsText(file);
    });
}

// --- Checkpoints UI & Handlers (added) ---
/*
  Functions:
   - saveCheckpoint(eventOrName): saves current state or named checkpoint
   - handleShowCheckpoints(): fetches checkpoints and displays them in the UI
   - handleCheckpointListActions(e, refreshFullUI): handles click actions in the checkpoint list (load/delete)
   - resetApplication(): resets app state and UI
*/
export async function saveCheckpoint(eventOrName) {
    try {
        // accept either (string name) or nothing — prompt for name
        let name = (typeof eventOrName === 'string' && eventOrName.trim()) ? eventOrName.trim() : null;
        if (!name) {
            const defaultName = 'Ręczny ' + new Date().toLocaleString('pl-PL');
            name = await showPrompt('Podaj nazwę punktu kontrolnego:', defaultName);
            if (!name) return; // user cancelled
        }
        const st = getState();
        // sanitize state to avoid DataCloneError
        function sanitize(obj, _seen = new WeakSet()) {
            if (obj === null || obj === undefined) return obj;
            if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
            if (typeof obj === 'function') return undefined;
            if (typeof obj === 'object') {
                if (_seen.has(obj)) return undefined;
                _seen.add(obj);
                // skip DOM Nodes, Events, Window
                if (typeof Node !== 'undefined' && obj instanceof Node) return undefined;
                if (typeof Event !== 'undefined' && obj instanceof Event) return undefined;
                if (typeof Window !== 'undefined' && obj instanceof Window) return undefined;
                if (Array.isArray(obj)) {
                    return obj.map(i => sanitize(i, _seen)).filter(i => i !== undefined);
                }
                const out = {};
                for (const k of Object.keys(obj)) {
                    try {
                        const v = obj[k];
                        if (typeof v === 'function') continue;
                        if (v && typeof v === 'object' && (v.nodeType || v instanceof Event || (typeof Window !== "undefined" && v instanceof Window))) continue;
                        const sv = sanitize(v, _seen);
                        if (sv !== undefined) out[k] = sv;
                    } catch (e) {
                        continue;
                    }
                }
                return out;
            }
            return undefined;
        }
        const record = {
            name: name || ('Checkpoint ' + new Date().toISOString()),
            state: sanitize(st) || {},
            timestamp: Date.now()
        };
        await CheckpointsDB.saveCheckpoint(record);
        await rememberLastBackup({ ...buildStateBackup(name, record.state), contextLabel: name });
        import('./cloudSync.js').then(m => m.queueCloudPush(name || 'Reczny punkt kontrolny')).catch(() => {});
        showNotification('Punkt kontrolny zapisany.', 'success');
    } catch (err) {
        console.error('saveCheckpoint error', err);
        showNotification('Błąd zapisu punktu kontrolnego.', 'error');
        throw err;
    }
}

export async function handleShowCheckpoints(containerId, listId) {
    try {
        const cps = await getCheckpoints();
        // Obsługa zarówno domyślnego panelu jak i dodatkowych (np. intro)
        const list = listId
            ? document.getElementById(listId)
            : DOMElements.checkpointList;
        const container = containerId
            ? document.getElementById(containerId)
            : DOMElements.checkpointListContainer;
        if (!list || !container) {
            showNotification('Interfejs punktów kontrolnych nie znaleziony.', 'error');
            return;
        }
        if (!cps.length) {
            list.innerHTML = '<p class="checkpoint-empty">Brak zapisanych punktow kontrolnych.</p>';
            container.classList.add('visible');
            return;
        }
        const toolbar = `
            <div class="checkpoint-bulk-toolbar">
                <label class="checkpoint-select-all">
                    <input type="checkbox" data-action="select-all-checkpoints">
                    <span>Zaznacz wszystkie</span>
                </label>
                <button data-action="delete-selected-checkpoints" class="btn small danger checkpoint-delete-selected" type="button">Usun zaznaczone</button>
            </div>
        `;
        list.innerHTML = toolbar + cps.map(cp => {
            const when  = cp.timestamp ? (new Date(cp.timestamp)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            const day   = cp.timestamp ? (new Date(cp.timestamp)).toLocaleDateString('pl-PL') : '';
            const isAuto = cp.auto === true;
            // Ikona: auto-checkpoint = 🔄, ręczny = 📌
            const icon  = isAuto ? '🔄' : '📌';
            const badge = isAuto
                ? `<span style="font-size:0.72rem;background:#2980b9;color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px;white-space:nowrap;">auto</span>`
                : `<span style="font-size:0.72rem;background:#27ae60;color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px;white-space:nowrap;">ręczny</span>`;
            const label = escapeHTML(cp.name || 'Bez nazwy');
            const safeKey = escapeHTML(cp.key);
            return `<li class="checkpoint-item" data-key="${safeKey}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 6px;border-bottom:1px solid #eee;gap:8px;">
                <input type="checkbox" class="checkpoint-select" data-key="${safeKey}" aria-label="Zaznacz punkt kontrolny">
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:0.95rem;white-space:normal;line-height:1.3;">${icon} ${label}${badge}</div>
                  <div style="font-size:0.78rem;color:#888;margin-top:2px;">${day} ${when}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  <button data-action="load" data-key="${safeKey}" class="btn small" style="padding:6px 12px;font-size:0.85rem;">Wczytaj</button>
                  <button data-action="delete" data-key="${safeKey}" class="btn small danger" style="padding:6px 12px;font-size:0.85rem;">Usuń</button>
                </div>
            </li>`;
        }).join('');
        container.classList.add('visible');
    } catch (err) {
        console.error('handleShowCheckpoints error', err);
        showNotification('Błąd podczas pobierania punktów kontrolnych.', 'error');
    }
}

export async function handleCheckpointListActions(e, refreshFullUI, containerId, listId) {
    try {
        const list = listId
            ? document.getElementById(listId)
            : DOMElements.checkpointList;
        const selectAll = e.target.closest?.('[data-action="select-all-checkpoints"]');
        if (selectAll && list) {
            list.querySelectorAll('.checkpoint-select').forEach(cb => {
                cb.checked = selectAll.checked;
            });
            return;
        }

        const deleteSelected = e.target.closest?.('[data-action="delete-selected-checkpoints"]');
        if (deleteSelected && list) {
            const keys = Array.from(list.querySelectorAll('.checkpoint-select:checked'))
                .map(cb => cb.getAttribute('data-key'))
                .filter(Boolean);
            if (keys.length === 0) {
                showNotification('Zaznacz punkty kontrolne do usuniecia.', 'info');
                return;
            }
            if (!await showConfirmation(`Usunac ${keys.length} zaznaczonych punktow kontrolnych?`)) return;
            for (const selectedKey of keys) {
                await deleteCheckpoint(selectedKey);
            }
            showNotification(`Usunieto ${keys.length} punktow kontrolnych.`, 'success');
            await handleShowCheckpoints(containerId, listId);
            return;
        }

        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const key = btn.getAttribute('data-key');
        if (!action || !key) return;
        if (action === 'delete') {
            if (!await showConfirmation('Na pewno usunąć punkt kontrolny?')) return;
            await deleteCheckpoint(key);
            showNotification('Usunięto punkt kontrolny.', 'success');
            // Odśwież listę w miejscu zamiast przeładowywać całe UI
            await handleShowCheckpoints(containerId, listId);
            return;
        }
        if (action === 'load') {
            // fetch all checkpoints and find key
            const cps = await getCheckpoints();
            const cp = cps.find(c => (c.key == key || c.key === key));
            if (!cp) {
                showNotification('Nie znaleziono punktu kontrolnego.', 'error');
                return;
            }
            // restore sanitized state
            try {
                if (!await showConfirmation(`Wczytać punkt "${cp.name}"? Bieżący stan zawodów zostanie nadpisany.`)) return;
                restoreState(cp.state);
                clearHistory();
                // Ukryj listę po wczytaniu
                const container = containerId
                    ? document.getElementById(containerId)
                    : document.getElementById('checkpointListContainer');
                if (container) container.classList.remove('visible');
                showNotification(`Wczytano: ${cp.name}`, 'success');
                if (typeof refreshFullUI === 'function') refreshFullUI();
            } catch (e) {
                console.error('restore checkpoint failed', e);
                showNotification('Błąd przy wczytywaniu punktu kontrolnego.', 'error');
            }
            return;
        }
    } catch (err) {
        console.error('handleCheckpointListActions error', err);
        showNotification('Błąd akcji na liście punktów kontrolnych.', 'error');
    }
}

export async function resetApplication(refreshCallback) {
    try {
        const current = getState();
        const hasCompetitionData = (current.competitors?.length || 0) > 0 ||
            (current.eventHistory?.length || 0) > 0 ||
            Object.keys(current.draftResults || {}).length > 0;
        if (!await showConfirmation('Czy na pewno zresetowac aplikacje? Wszystkie dane biezacych zawodow zostana utracone.')) return;
        if (hasCompetitionData) {
            const typed = await showPrompt('To sa aktywne dane zawodow. Aby zresetowac, wpisz RESET:', '');
            if (String(typed || '').trim().toUpperCase() !== 'RESET') {
                showNotification('Reset anulowany - dane zawodow zostaly zachowane.', 'info', 3500);
                return;
            }
        }
        await clearAutoSave();
        resetState();
        clearHistory();
        // Wyczyść tokeny sędziów pomocniczych
        try {
            const { resetSession } = await import('./judge.js');
            resetSession();
        } catch(_) {}
        showNotification('Aplikacja zresetowana.', 'info');
        if (typeof refreshCallback === 'function') refreshCallback();
    } catch (err) {
        console.error('resetApplication error', err);
        showNotification('Błąd resetu aplikacji.', 'error');
    }
}
// --- Existing persistence logic (if any) should remain above ---
