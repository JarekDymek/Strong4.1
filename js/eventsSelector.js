// js/eventsSelector.js
// Modal wyboru i ustalania kolejnosci konkurencji przed startem oraz po starcie zawodow.

import { getEvents } from './eventsDb.js';

let allEvents = [];
let selectedIds = new Set();
let orderedIds = [];
let selectorMode = 'start';

function getModal() { return document.getElementById('selectEventsForCompetitionModal'); }
function getList() { return document.getElementById('eventsSelectionList'); }
function getCounter() { return document.getElementById('eventsSelectedCount'); }
function getConfirmBtn() { return document.getElementById('selectEventsConfirmBtn'); }

function normalizeExisting(existingEvents = []) {
  const ids = [];
  existingEvents.forEach(ev => {
    const match = ev?.id ? allEvents.find(e => String(e.id) === String(ev.id)) : allEvents.find(e => (e.name || '') === (ev?.name || ''));
    if (match && !ids.includes(match.id)) ids.push(match.id);
  });
  return ids;
}

function mergeExistingEvents(baseEvents, existingEvents = []) {
  const merged = [...baseEvents];
  existingEvents.forEach((ev, idx) => {
    if (!ev) return;
    const exists = merged.some(item => String(item.id) === String(ev.id) || (item.name || '') === (ev.name || ''));
    if (!exists) {
      merged.unshift({
        id: ev.id || ('planned-' + idx + '-' + (ev.name || 'event')),
        name: ev.name || ('Konkurencja ' + (idx + 1)),
        type: ev.type || 'high',
        isFinal: Boolean(ev.isFinal),
      });
    }
  });
  return merged;
}
function updateCounter() {
  const counter = getCounter();
  if (counter) counter.textContent = selectedIds.size;
}

function moveSelected(id, direction) {
  const idx = orderedIds.indexOf(id);
  if (idx < 0) return;
  const next = idx + direction;
  if (next < 0 || next >= orderedIds.length) return;
  [orderedIds[idx], orderedIds[next]] = [orderedIds[next], orderedIds[idx]];
  renderList();
}

function renderList() {
  const list = getList();
  if (!list) return;
  list.innerHTML = '';

  const selectedRows = orderedIds
    .map(id => allEvents.find(e => String(e.id) === String(id)))
    .filter(Boolean);
  const unselectedRows = allEvents.filter(ev => !selectedIds.has(ev.id));
  const rows = [...selectedRows, ...unselectedRows];

  rows.forEach(ev => {
    const isSelected = selectedIds.has(ev.id);
    const order = orderedIds.indexOf(ev.id);
    const isFinal = isSelected && order === orderedIds.length - 1 && orderedIds.length > 0;

    const row = document.createElement('div');
    row.className = 'event-select-row' + (isSelected ? ' selected' : '') + (isFinal ? ' is-final' : '');
    row.dataset.id = ev.id;

    const badge = document.createElement('div');
    badge.className = 'event-order-badge' + (isFinal ? ' final-badge' : '');
    badge.textContent = isSelected ? (order + 1) : '';

    const name = document.createElement('div');
    name.className = 'event-select-name';
    name.textContent = (ev.name || '') + (isFinal ? ' FINAL' : '');

    const type = document.createElement('div');
    type.className = 'event-select-type';
    type.textContent = ev.type === 'low' ? 'Mniej=Lepiej' : 'Wiecej=Lepiej';

    const controls = document.createElement('div');
    controls.className = 'event-order-controls';
    if (isSelected) {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'event-order-move';
      up.textContent = '\u2191';
      up.disabled = order === 0;
      up.addEventListener('click', event => { event.stopPropagation(); moveSelected(ev.id, -1); });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'event-order-move';
      down.textContent = '\u2193';
      down.disabled = order === orderedIds.length - 1;
      down.addEventListener('click', event => { event.stopPropagation(); moveSelected(ev.id, 1); });
      controls.append(up, down);
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'event-select-checkbox';
    cb.checked = isSelected;
    cb.readOnly = true;

    row.append(badge, name, type, controls, cb);
    row.addEventListener('click', () => toggleEvent(ev.id));
    list.appendChild(row);
  });

  updateCounter();
}

function toggleEvent(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    orderedIds = orderedIds.filter(x => x !== id);
  } else {
    selectedIds.add(id);
    orderedIds.push(id);
  }
  renderList();
}

export async function openEventsSelector(existingEvents = [], mode = 'start') {
  selectorMode = mode || 'start';
  allEvents = mergeExistingEvents(await getEvents(), existingEvents);
  const existingIds = normalizeExisting(existingEvents);
  selectedIds = new Set(existingIds);
  orderedIds = [...existingIds];
  renderList();
  const confirm = getConfirmBtn();
  if (confirm) confirm.textContent = selectorMode === 'edit' ? 'Zapisz kolejnosc' : 'Zatwierdz i Startuj';
  const modal = getModal();
  if (modal) modal.classList.add('visible');
}

export function closeEventsSelector() {
  const modal = getModal();
  if (modal) modal.classList.remove('visible');
}

export function getSelectorMode() { return selectorMode; }

export function getSelectedEventsOrdered() {
  return orderedIds.map((id, idx) => {
    const ev = allEvents.find(e => String(e.id) === String(id));
    const isFinal = idx === orderedIds.length - 1;
    return ev ? { ...ev, isFinal } : null;
  }).filter(Boolean);
}

export function selectAll() {
  selectedIds = new Set(allEvents.map(e => e.id));
  orderedIds = allEvents.map(e => e.id);
  renderList();
}

export function deselectAll() {
  selectedIds.clear();
  orderedIds = [];
  renderList();
}
