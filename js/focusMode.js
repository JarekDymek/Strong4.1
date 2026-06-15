// Plik: js/focusMode.js
// Cel: szybkie wpisywanie wynikow w kartach wzorowanych na panelu sedziego pomocniczego.

import { getActiveCompetitors, getCompetitorProfile, setFocusModeIndex } from './state.js';
import { DOMElements } from './ui.js';

const RESULT_INPUT_SELECTOR = '#resultsTable .resultInput';

function safeId(name) {
    return String(name).replace(/[^a-zA-Z0-9]/g, '_');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getMainInput(name) {
    return document.querySelector(`${RESULT_INPUT_SELECTOR}[data-name="${CSS.escape(name)}"]`);
}

function getCard(name) {
    return document.getElementById(`focusCard_${safeId(name)}`);
}

function getCardInput(name) {
    return document.getElementById(`focusInput_${safeId(name)}`);
}

function getCardButton(name) {
    return document.getElementById(`focusSave_${safeId(name)}`);
}

function syncCardState(name) {
    const input = getCardInput(name);
    const card = getCard(name);
    if (!input || !card) return;
    input.classList.toggle('filled', input.value.trim() !== '');
    updateProgress();
}

function updateProgress() {
    const progress = document.getElementById('focusProgressText');
    const inputs = Array.from(document.querySelectorAll('.score-result-input'));
    const filled = inputs.filter(input => input.value.trim() !== '').length;
    const saved = document.querySelectorAll('.score-entry-card.is-saved').length;
    if (progress) progress.textContent = `${saved} zapisanych / ${filled} wpisanych / ${inputs.length} zawodnikow`;
}

function focusCard(name, options = {}) {
    const card = getCard(name);
    const input = getCardInput(name);
    if (!card || !input) return;

    document.querySelectorAll('.score-entry-card.is-active').forEach(el => el.classList.remove('is-active'));
    card.classList.add('is-active');
    card.scrollIntoView({ behavior: options.instant ? 'auto' : 'smooth', block: 'start' });
    setFocusModeIndex(getActiveCompetitors().findIndex(c => c === name));

    if (!input.readOnly) {
        setTimeout(() => {
            input.focus({ preventScroll: true });
            input.select();
        }, options.instant ? 0 : 120);
    }
}

function focusNextEditable(afterName) {
    const competitors = getActiveCompetitors();
    const startIndex = Math.max(0, competitors.findIndex(c => c === afterName) + 1);
    const next = competitors.slice(startIndex).find(name => {
        const input = getCardInput(name);
        return input && !input.readOnly;
    }) || competitors.find(name => {
        const input = getCardInput(name);
        return input && !input.readOnly;
    });
    if (next) focusCard(next);
}

function saveResult(name, options = {}) {
    const input = getCardInput(name);
    const card = getCard(name);
    const button = getCardButton(name);
    const mainInput = getMainInput(name);
    if (!input || !card || !mainInput) return false;

    if (input.readOnly) {
        const status = card.querySelector('.score-card-status');
        input.readOnly = false;
        card.classList.remove('is-saved');
        if (button) button.textContent = '✓';
        if (status) status.textContent = 'czeka';
        focusCard(name);
        updateProgress();
        return false;
    }

    const newResult = input.value.trim();
    if (!newResult) {
        focusCard(name);
        return false;
    }

    if (mainInput.value !== newResult) {
        mainInput.value = newResult;
        mainInput.dispatchEvent(new Event('input', { bubbles: true }));
        mainInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.value = newResult;
    input.readOnly = true;
    input.classList.add('filled');
    card.classList.add('is-saved');
    const status = card.querySelector('.score-card-status');
    if (button) button.textContent = '↺';
    if (status) status.textContent = 'zapisano';
    document.dispatchEvent(new CustomEvent('strongman:result-updated'));
    updateProgress();

    if (!options.keepFocus) focusNextEditable(name);
    return true;
}

function saveAllFilled(options = {}) {
    let saved = 0;
    getActiveCompetitors().forEach(name => {
        const input = getCardInput(name);
        if (input && !input.readOnly && input.value.trim()) {
            if (saveResult(name, { keepFocus: true })) saved++;
        }
    });
    const next = getActiveCompetitors().find(name => {
        const input = getCardInput(name);
        return input && !input.readOnly;
    });
    if (next && options.refocus !== false) focusCard(next);
    updateProgress();
    return saved;
}

function openStopwatchFor(name) {
    handleCloseFocusMode();
    const trigger = document.querySelector(`#resultsTable tr[data-name="${CSS.escape(name)}"] [data-action="openStopwatch"]`);
    if (trigger) trigger.click();
}

function renderScoreEntryCards(activeName) {
    const list = document.getElementById('focusCardsList');
    const title = document.getElementById('focusCompetitorName');
    if (!list) return;

    const competitors = getActiveCompetitors();
    if (title) title.textContent = 'Wpisywanie wynikow';

    list.innerHTML = competitors.map((name, index) => {
        const profile = getCompetitorProfile(name) || {};
        const mainInput = getMainInput(name);
        const value = mainInput?.value || '';
        const readonly = !!mainInput?.readOnly;
        const id = safeId(name);
        const isActive = name === activeName;
        const isFirst = index === 0;
        const isFilled = value.trim() !== '';
        const savedInCard = readonly || isFilled;
        const photo = profile.photo || `https://placehold.co/48x48/1E3A5F/fff?text=${encodeURIComponent(String(name).charAt(0) || '?')}`;

        return `
          <div class="score-entry-card ${isActive ? 'is-active' : ''} ${savedInCard ? 'is-saved' : ''}"
               id="focusCard_${id}" data-name="${escapeHtml(name)}">
            <div class="score-card-header">
              <span class="score-order-badge">${isFirst ? 'START' : index + 1}</span>
              <img src="${escapeHtml(photo)}" class="competitor-photo-thumb" alt="${escapeHtml(name)}">
              <span class="score-card-name">${escapeHtml(name)}</span>
              <span class="score-card-status">${savedInCard ? 'zapisano' : 'czeka'}</span>
            </div>
            <div class="score-card-body">
              <span class="result-label">Wynik dla</span>
              <div class="score-current-name">${escapeHtml(name)}</div>
              <div class="score-input-wrap">
                <input class="score-result-input ${isFilled ? 'filled' : ''}" id="focusInput_${id}"
                       type="text" inputmode="decimal" placeholder="wpisz wynik"
                       value="${escapeHtml(value)}" data-name="${escapeHtml(name)}"
                       ${savedInCard ? 'readonly' : ''}>
                <button class="score-save-btn" id="focusSave_${id}" data-action="save-score"
                        data-name="${escapeHtml(name)}">${savedInCard ? '↺' : '✓'}</button>
              </div>
              <div class="score-card-tools">
                <button class="score-stopwatch-btn" data-action="open-stopwatch" data-name="${escapeHtml(name)}">Stoper / licznik</button>
              </div>
              <div class="score-saved-info">Zapisano do tabeli glownej. Kliknij ↺, aby poprawic.</div>
            </div>
          </div>`;
    }).join('');

    updateProgress();
}

export function setupFocusModeEventListeners() {
    document.getElementById('closeFocusBtn')?.addEventListener('click', handleCloseFocusMode);
    document.getElementById('focusBackBtn')?.addEventListener('click', handleCloseFocusMode);
    document.getElementById('focusSendAllBtn')?.addEventListener('click', saveAllFilled);

    document.getElementById('focusCardsList')?.addEventListener('input', (event) => {
        const input = event.target.closest('.score-result-input');
        if (!input) return;
        syncCardState(input.dataset.name);
    });

    document.getElementById('focusCardsList')?.addEventListener('keydown', (event) => {
        const input = event.target.closest('.score-result-input');
        if (!input || event.key !== 'Enter') return;
        event.preventDefault();
        saveResult(input.dataset.name);
    });

    document.getElementById('focusCardsList')?.addEventListener('click', (event) => {
        const saveBtn = event.target.closest('[data-action="save-score"]');
        const stopwatchBtn = event.target.closest('[data-action="open-stopwatch"]');
        const card = event.target.closest('.score-entry-card');

        if (saveBtn) {
            saveResult(saveBtn.dataset.name);
            return;
        }
        if (stopwatchBtn) {
            openStopwatchFor(stopwatchBtn.dataset.name);
            return;
        }
        if (card) focusCard(card.dataset.name);
    });
}

export function handleEnterFocusMode(competitorName) {
    const competitors = getActiveCompetitors();
    const activeName = competitors.includes(competitorName) ? competitorName : competitors[0];
    if (!activeName) return;

    renderScoreEntryCards(activeName);
    DOMElements.focusModeModal.classList.add('visible');
    focusCard(activeName, { instant: true });
}

function handleCloseFocusMode() {
    saveAllFilled({ refocus: false });
    DOMElements.focusModeModal.classList.remove('visible');
    setFocusModeIndex(-1);
}
