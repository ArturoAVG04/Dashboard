import { escapeHtml } from '../core/date-utils.js';
import { EARLY_CLOSE_OPTIONS, normalizeEarlyClose } from '../models/EarlyClose.js';

// Fila opcional de chips del corte: "¿Cerraste temprano?" (un toque, "Normal" por defecto)
export function renderEarlyCloseRow(current) {
    const selected = normalizeEarlyClose(current);
    const chips = EARLY_CLOSE_OPTIONS.map(option => {
        const active = option.value === selected;
        return `<button type="button" class="early-chip${active ? ' is-active' : ''}" aria-pressed="${active}" data-session-modal="early-close" data-value="${escapeHtml(option.value || '')}">${escapeHtml(option.label)}</button>`;
    }).join('');
    return `<div class="cut-section"><h4>¿Cerraste temprano?</h4><div class="early-chips" id="cut-early-close" role="group" aria-label="¿Cerraste temprano?">${chips}</div></div>`;
}

// Marca el chip tocado y devuelve su valor (null = normal)
export function selectEarlyChip(button) {
    button.closest('.early-chips')?.querySelectorAll('.early-chip').forEach(chip => {
        const on = chip === button;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', String(on));
    });
    return normalizeEarlyClose(button.dataset.value);
}

export function readEarlyClose() {
    return normalizeEarlyClose(document.querySelector('#cut-early-close .early-chip.is-active')?.dataset.value);
}
