// js/eventsDb.js - unified Dexie-backed events store
import { showNotification } from './ui.js';
import { INITIAL_EVENTS } from './initialData.js';
import { dbAction } from './db-dexie.js';

const eventCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

function normalizeEventName(name) {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .toLocaleLowerCase('pl');
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return {
    ...raw,
    name,
    type: raw.type === 'low' ? 'low' : 'high'
  };
}

function sortEvents(events) {
  return [...events].sort((a, b) => eventCollator.compare(a.name || '', b.name || ''));
}

function uniqueEvents(events) {
  const byName = new Map();
  let duplicates = 0;
  for (const raw of events || []) {
    const event = sanitizeEvent(raw);
    if (!event) continue;
    const key = normalizeEventName(event.name);
    if (byName.has(key)) {
      duplicates++;
      continue;
    }
    byName.set(key, event);
  }
  return { events: sortEvents([...byName.values()]), duplicates };
}

export async function getEvents() {
  return await dbAction(null, 'events', 'readonly', async (store) => {
    const events = await store.toArray();
    return uniqueEvents(events).events;
  });
}

export async function dedupeEventsDatabase() {
  return await dbAction(null, 'events', 'readwrite', async (store) => {
    const events = await store.toArray();
    const sorted = [...events].sort((a, b) => {
      const byName = eventCollator.compare(a.name || '', b.name || '');
      if (byName !== 0) return byName;
      return Number(a.id || 0) - Number(b.id || 0);
    });
    const seen = new Set();
    const duplicateIds = [];
    for (const event of sorted) {
      const clean = sanitizeEvent(event);
      const key = normalizeEventName(clean?.name || '');
      if (!key) {
        if (event.id != null) duplicateIds.push(Number(event.id));
        continue;
      }
      if (seen.has(key)) {
        if (event.id != null) duplicateIds.push(Number(event.id));
      } else {
        seen.add(key);
      }
    }
    if (duplicateIds.length > 0) await store.bulkDelete(duplicateIds);
    return { removed: duplicateIds.length };
  });
}

export async function saveEvent(eventData) {
  const clean = sanitizeEvent(eventData);
  if (!clean) throw new Error('Podaj nazw\u0119 konkurencji.');

  const existingEvents = await getEvents();
  const duplicate = existingEvents.find(event =>
    normalizeEventName(event.name) === normalizeEventName(clean.name) &&
    Number(event.id) !== Number(clean.id || 0)
  );
  if (duplicate) {
    throw new Error('Konkurencja o takiej nazwie ju\u017c istnieje w bazie. Edytuj istniej\u0105cy wpis zamiast dodawa\u0107 duplikat.');
  }

  return await dbAction(null, 'events', 'readwrite', (store, data) => {
    if (data.id !== undefined && data.id !== null && data.id !== '') {
      return store.put({ ...data, id: Number(data.id) });
    }
    const { id: _ignored, ...withoutId } = data;
    return store.add(withoutId);
  }, clean);
}

export async function addEvent(eventData) {
  return await saveEvent(eventData);
}

export async function deleteEvent(id) {
  return await dbAction(null, 'events', 'readwrite', (store, key) => store.delete(Number(key)), id);
}

export async function clearEventsDatabase() {
  await dbAction(null, 'events', 'readwrite', (store) => store.clear());
  showNotification('Baza konkurencji zosta\u0142a wyczyszczona.', 'info', 3000);
}

export async function seedEventsDatabaseIfNeeded() {
  await dedupeEventsDatabase();
  const existing = await getEvents();
  if ((!existing || existing.length === 0) && INITIAL_EVENTS && INITIAL_EVENTS.length > 0) {
    showNotification('Wype\u0142niam baz\u0119 pocz\u0105tkowymi konkurencjami...', 'info', 3000);
    const { events } = uniqueEvents(INITIAL_EVENTS);
    await dbAction(null, 'events', 'readwrite', (store, data) => store.bulkAdd(data), events.map(({ id, ...event }) => event));
    showNotification(`Baza konkurencji gotowa: ${events.length} pozycji.`, 'success', 2500);
    return;
  }

  const { removed } = await dedupeEventsDatabase();
  if (removed > 0) showNotification(`Usuni\u0119to duplikaty konkurencji: ${removed}.`, 'info', 3000);
}

export async function importEventsFromJson(jsonArray) {
  if (!Array.isArray(jsonArray) || jsonArray.length === 0)
    throw new Error('Nieprawid\u0142owy lub pusty plik - oczekiwana tablica konkurencji.');

  const { events, duplicates } = uniqueEvents(jsonArray);
  if (events.length === 0) throw new Error('Plik nie zawiera poprawnych konkurencji.');

  await dbAction(null, 'events', 'readwrite', async (store, data) => {
    await store.clear();
    await store.bulkAdd(data.map(({ id, ...event }) => event));
  }, events);

  const duplicateText = duplicates ? ` Pomini\u0119to duplikaty: ${duplicates}.` : '';
  showNotification(`Import konkurencji: wczytano ${events.length}.${duplicateText}`, 'success');
  return { added: events.length, updated: 0, duplicates };
}

export async function exportEventsToJson() {
  const events = await getEvents();
  const dataStr = JSON.stringify(events, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'strongman_baza_konkurencji.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification('Baza konkurencji wyeksportowana alfabetycznie.', 'success');
}
