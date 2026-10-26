import { escapeHtml, formatMoney, formatTimeDisplay, getLocalTimeInputValue, combineLocalDateAndTime } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { getCustomBranches, getBranchById } from '../services/branches-service.js';
import { getTransactions } from '../services/transactions-service.js';
import { getInventoryItems, getBranchInventoryItems } from '../services/inventory-service.js';
import { getItemUnitPrice } from './inventory-ui.js';
import { getOpenTables } from '../services/tables-service.js';
import {
    getSessions,
    getSessionById,
    getTodaySession,
    getActiveSession,
    getStaleOpenSessions,
    openSession,
    addSessionLoads,
    closeSession,
    reopenSession
} from '../services/sessions-service.js';
import { getBranchSessionConfig, getScheduleForDate } from '../models/BranchConfig.js';
import {
    computeSessionStock,
    computeSessionSummary,
    computeSoldOutTimes,
    estimateCloseTime,
    formatDuration,
    computeItemSalesHistory
} from '../analytics/session-metrics.js';
import { buildItemRecommendations } from '../analytics/forecast.js';

let modalState = null; // { mode: 'open'|'restock'|'cut'|'view', branchId, sessionId }
let onChangeCallback = null;

export function setSessionsChangeHandler(callback) {
    onChangeCallback = callback;
}

function notifyChange() {
    renderSessionsSection();
    if (typeof onChangeCallback === 'function') onChangeCallback();
}

function formatDateKey(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`);
    return isNaN(date.getTime()) ? dateKey : date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

function itemName(itemId) {
    return getInventoryItems().find(item => item.id === itemId)?.name || 'Artículo eliminado';
}

// ---------- Sección "Jornadas de hoy" en Principal ----------
export function renderSessionsSection() {
    const section = document.getElementById('sessions-section');
    if (!section) return;

    const now = new Date();
    const branches = getCustomBranches().filter(branch => getBranchSessionConfig(branch).sessionsEnabled);
    const stale = getStaleOpenSessions(now);
    updateSessionsNavDot(branches, stale, now);
    if (branches.length === 0 && stale.length === 0) {
        section.innerHTML = `<div class="empty-state"><i class="ph ph-clock-clockwise"></i><p>Ninguna sucursal registra jornadas.</p><small>Actívalo en Productos → Sucursales → editar → "Registrar jornadas y métricas".</small></div>`;
        return;
    }

    const transactions = getTransactions();
    const staleCards = stale.map(session => {
        const branch = getBranchById(session.branchId);
        return `
            <article class="session-card is-pending">
                <div class="session-card-top">
                    <span class="session-status status-pending"><i class="ph-fill ph-warning-circle"></i> Corte pendiente</span>
                    <span class="session-branch">${escapeHtml(branch?.name || 'Sucursal')}</span>
                </div>
                <p class="session-main">Jornada del ${escapeHtml(formatDateKey(session.dateKey))} sin corte</p>
                <p class="session-meta">Cierre estimado ${formatTimeDisplay(estimateCloseTime(session, transactions))} (última venta + 15 min)</p>
                <div class="session-actions">
                    <button type="button" class="btn btn-warning btn-sm" data-session-action="cut" data-session-id="${escapeHtml(session.id)}"><i class="ph ph-scissors"></i> Hacer corte</button>
                </div>
            </article>
        `;
    }).join('');

    const branchCards = branches.map(branch => renderBranchSessionCard(branch, transactions, now)).join('');

    section.innerHTML = `
        <div class="sessions-header">
            <h3>Hoy</h3>
        </div>
        <div class="sessions-grid">${staleCards}${branchCards}</div>
    `;
}

// Punto en el menú: verde si hay algo en servicio, ámbar si hay un corte pendiente
function updateSessionsNavDot(branches, stale, now) {
    const dot = document.getElementById('nav-sessions-dot');
    if (!dot) return;
    const anyOpen = branches.some(branch => getActiveSession(branch.id, now));
    dot.hidden = !anyOpen && stale.length === 0;
    dot.classList.toggle('is-warning', stale.length > 0);
}

function renderBranchSessionCard(branch, transactions, now) {
    const config = getBranchSessionConfig(branch);
    const session = getTodaySession(branch.id, now);
    const schedule = getScheduleForDate(branch, now);
    const scheduleText = schedule ? `Hoy ${schedule.open}–${schedule.close}` : 'Sin horario hoy';
    const branchName = escapeHtml(branch.name);

    if (session?.status === 'open') {
        const summary = computeSessionSummary(session, transactions, getInventoryItems(), { now });
        const stock = config.inventoryEnabled ? computeSessionStock(session, transactions) : null;
        const soldOut = config.inventoryEnabled ? computeSoldOutTimes(session, transactions) : new Map();
        const stockChips = stock
            ? [...stock.entries()].map(([itemId, entry]) => {
                const out = entry.loaded > 0 && entry.remaining <= 0;
                return `<span class="stock-chip${out ? ' is-out' : entry.loaded > 0 && entry.remaining <= Math.max(1, entry.loaded * 0.2) ? ' is-low' : ''}">${escapeHtml(itemName(itemId))} <b>${out ? `agotado ${soldOut.get(itemId) ? formatTimeDisplay(soldOut.get(itemId)) : ''}` : `${entry.remaining}/${entry.loaded}`}</b></span>`;
            }).join('')
            : '';
        const needsLoad = config.inventoryEnabled && !(session.loads || []).length;
        return `
            <article class="session-card is-open">
                <div class="session-card-top">
                    <span class="session-status status-open"><span class="live-dot"></span> En servicio</span>
                    <span class="session-branch">${branchName}</span>
                </div>
                <p class="session-main">${formatMoney(summary.salesTotal)} <small>· ${summary.ticketCount} venta${summary.ticketCount === 1 ? '' : 's'}</small></p>
                <p class="session-meta">Desde ${formatTimeDisplay(new Date(session.openedAt))} · ${formatDuration(summary.durationMinutes)}${session.openSource === 'auto-first-sale' ? ' · abierta con la primera venta' : ''}${session.openSource === 'schedule' ? ' · por horario' : ''}</p>
                ${needsLoad ? '<p class="session-warning"><i class="ph ph-warning"></i> Sin inventario cargado</p>' : ''}
                ${stockChips ? `<div class="stock-chips">${stockChips}</div>` : ''}
                <div class="session-actions">
                    ${config.inventoryEnabled ? `<button type="button" class="btn btn-secondary btn-sm" data-session-action="restock" data-branch-id="${escapeHtml(branch.id)}"><i class="ph ph-plus"></i> ${needsLoad ? 'Cargar inventario' : 'Reabastecer'}</button>` : ''}
                    <button type="button" class="btn btn-primary btn-sm" data-session-action="cut" data-session-id="${escapeHtml(session.id)}"><i class="ph ph-scissors"></i> Hacer corte</button>
                </div>
            </article>
        `;
    }

    if (session?.status === 'closed') {
        const summary = session.summary || computeSessionSummary(session, transactions, getInventoryItems());
        const sellThrough = summary.totals?.sellThrough;
        return `
            <article class="session-card is-closed">
                <div class="session-card-top">
                    <span class="session-status status-closed"><i class="ph-fill ph-check-circle"></i> Corte hecho</span>
                    <span class="session-branch">${branchName}</span>
                </div>
                <p class="session-main">${formatMoney(summary.salesTotal)} <small>· ${summary.ticketCount} ventas</small></p>
                <p class="session-meta">${formatTimeDisplay(new Date(session.openedAt))}–${formatTimeDisplay(new Date(session.closedAt))} · ${formatDuration(summary.durationMinutes)}${typeof sellThrough === 'number' ? ` · ${Math.round(sellThrough * 100)}% vendido` : ''}</p>
                <div class="session-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-session-action="view" data-session-id="${escapeHtml(session.id)}"><i class="ph ph-receipt"></i> Ver corte</button>
                </div>
            </article>
        `;
    }

    // Sin jornada hoy
    const isLate = config.openMode === 'manual' && schedule && now >= schedule.openAt && now < schedule.closeAt;
    const waitingSchedule = config.openMode === 'schedule' && schedule && now < schedule.openAt;
    let mainText = 'Lista para abrir';
    if (waitingSchedule) mainText = `Abre a las ${schedule.open}`;
    if (isLate) mainText = `Son las ${getLocalTimeInputValue(now)}: ¿poner en servicio?`;
    if (config.openMode === 'schedule' && config.inventoryEnabled && schedule && now >= schedule.openAt && now < schedule.closeAt) mainText = 'Carga el inventario para abrir';

    const action = config.inventoryEnabled
        ? `<button type="button" class="btn btn-success btn-sm" data-session-action="open" data-branch-id="${escapeHtml(branch.id)}"><i class="ph ph-cube"></i> Cargar inventario y abrir</button>`
        : `<button type="button" class="btn btn-success btn-sm" data-session-action="open" data-branch-id="${escapeHtml(branch.id)}"><i class="ph ph-power"></i> Poner en servicio</button>`;
    return `
        <article class="session-card${isLate ? ' is-late' : ''}">
            <div class="session-card-top">
                <span class="session-status status-off"><i class="ph ph-moon"></i> Fuera de servicio</span>
                <span class="session-branch">${branchName}</span>
            </div>
            <p class="session-main session-main-sm">${escapeHtml(mainText)}</p>
            <p class="session-meta">${escapeHtml(scheduleText)}${config.openMode === 'schedule' ? ' · horario fijo' : ''}</p>
            <div class="session-actions">${action}</div>
        </article>
    `;
}

export async function handleSessionsSectionClick(event) {
    const button = event.target.closest('[data-session-action]');
    if (!button) return;
    const { sessionAction, branchId, sessionId } = button.dataset;

    if (sessionAction === 'open') {
        const config = getBranchSessionConfig(getBranchById(branchId));
        if (config.inventoryEnabled) {
            openLoadModal(branchId, 'open');
        } else {
            await openSession(branchId, { openSource: 'manual' });
            showToast(`${getBranchById(branchId)?.name || 'Sucursal'} en servicio`, 'success');
            notifyChange();
        }
    }
    if (sessionAction === 'restock') openLoadModal(branchId, 'restock');
    if (sessionAction === 'cut') openCutModal(sessionId);
    if (sessionAction === 'view') openCutModal(sessionId, { readOnly: true });
}

// ---------- Modal ----------
function setModal({ title, subtitle = '', body, footer }) {
    document.getElementById('session-modal-title').textContent = title;
    document.getElementById('session-modal-subtitle').textContent = subtitle;
    document.getElementById('session-modal-body').innerHTML = body;
    document.getElementById('session-modal-footer').innerHTML = footer;
    document.getElementById('session-modal')?.classList.add('open');
}

export function closeSessionModal() {
    document.getElementById('session-modal')?.classList.remove('open');
    modalState = null;
}

// Sugerencia simple: lo que se llevó el mismo día de la semana anterior (o la última jornada)
// Sugerencia de carga: la recomendación del algoritmo para el día de hoy (F6) o,
// si aún no hay jornadas cerradas, lo que se llevó la última vez.
function getLoadSuggestion(branchId) {
    const today = new Date().getDay();
    const recommendations = buildItemRecommendations(getSessions(), getTransactions(), branchId, getBranchInventoryItems(branchId), today, { beforeDateKey: getTodayKeyLocal() });
    if (recommendations.length > 0) {
        const confidence = recommendations.some(entry => entry.confidence === 'alta') ? 'alta'
            : recommendations.some(entry => entry.confidence === 'media') ? 'media' : 'baja';
        return {
            totals: new Map(recommendations.map(entry => [entry.itemId, entry.qty])),
            label: `Recomendado para hoy según tus jornadas anteriores (confianza ${confidence})`,
            chip: 'Recomendado'
        };
    }

    const previous = getSessions()
        .filter(session => session.branchId === branchId && (session.loads || []).length > 0 && session.dateKey < getTodayKeyLocal())
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const sameDay = previous.find(session => new Date(`${session.dateKey}T12:00:00`).getDay() === today);
    const source = sameDay || previous[0];
    if (!source) return null;
    const totals = new Map();
    source.loads.forEach(load => totals.set(load.itemId, (totals.get(load.itemId) || 0) + (Number(load.qty) || 0)));
    return { totals, label: `${sameDay ? 'Igual que el' : 'Como la última vez,'} ${formatDateKey(source.dateKey)}`, chip: 'Sugerido' };
}

function getTodayKeyLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function openLoadModal(branchId, mode = 'open') {
    const branch = getBranchById(branchId);
    const items = getBranchInventoryItems(branchId).filter(item => item.active !== false);
    modalState = { mode, branchId };
    const session = getActiveSession(branchId);
    const stock = session ? computeSessionStock(session, getTransactions()) : new Map();
    const suggestion = mode === 'open' ? getLoadSuggestion(branchId) : null;
    const weekday = new Date().getDay();
    const weekdayName = new Date().toLocaleDateString('es-MX', { weekday: 'long' });

    if (items.length === 0) {
        setModal({
            title: mode === 'open' ? '¿Qué llevas hoy?' : 'Reabastecer',
            subtitle: branch?.name || '',
            body: `<div class="empty-state"><i class="ph ph-cube"></i><p>${escapeHtml(branch?.name || 'Esta sucursal')} no tiene artículos de inventario.</p><small>Créalos en Productos → Inventario y marca qué productos los descuentan.</small></div>`,
            footer: `<button type="button" class="btn btn-secondary btn-block" data-session-modal="close">Entendido</button>`
        });
        return;
    }

    const rows = items.map(item => {
        const suggested = suggestion?.totals.get(item.id);
        const current = stock.get(item.id);
        const history = computeItemSalesHistory(getSessions(), branchId, item.id, { weekday, beforeDateKey: getTodayKeyLocal() });
        const price = getItemUnitPrice(item, branchId);
        const unit = escapeHtml(item.unit || 'pza');
        const historyText = history
            ? `Promedio vendido ${history.avgSold} ${unit}${history.avgSoldWeekday !== null ? ` · ${weekdayName}: ${history.avgSoldWeekday}` : ''}`
            : 'Sin historial todavía';
        return `
            <div class="load-row">
                <div class="load-row-info">
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>${mode === 'restock' && current ? `Quedan ${current.remaining} de ${current.loaded} · ` : ''}${historyText}</small>
                    <small>${price ? `Precio medio ${formatMoney(price.unitPrice)} por ${unit}${price.basis === 'history' ? ' (según tus ventas)' : ' (según el menú)'}` : 'Ningún producto lo descuenta: configúralo en Inventario'}</small>
                </div>
                ${suggested ? `<button type="button" class="suggest-chip" data-session-modal="suggest" data-item-id="${escapeHtml(item.id)}" data-qty="${suggested}">${escapeHtml(suggestion.chip)} ${suggested}</button>` : '<span></span>'}
                <input type="number" class="load-qty" data-item-id="${escapeHtml(item.id)}" data-unit-price="${price?.unitPrice ?? ''}" min="0" step="any" inputmode="decimal" placeholder="0" aria-label="Cantidad de ${escapeHtml(item.name)}">
                <span class="load-expected" data-expected-for="${escapeHtml(item.id)}"></span>
            </div>
        `;
    }).join('');

    setModal({
        title: mode === 'open' ? '¿Qué llevas hoy?' : 'Reabastecer',
        subtitle: `${branch?.name || ''} · ${mode === 'open' ? 'al guardar queda en servicio' : 'se suma a lo que ya llevas'}`,
        body: `
            ${suggestion ? `<div class="notice"><i class="ph ph-lightbulb"></i><span>${escapeHtml(suggestion.label)}. <button type="button" class="btn btn-ghost btn-sm" data-session-modal="suggest-all">Usar sugerencias</button></span></div>` : ''}
            <div class="load-list">${rows}</div>
            <div class="load-total">
                <span>Venta esperada si se vende todo</span>
                <strong id="load-expected-total">${formatMoney(0)}</strong>
            </div>
            <p class="field-hint">El precio medio sale de los productos que descuentan cada artículo (si vendes 1 o 2 por precio distinto, se promedia según lo que más vendes). Deja vacío lo que no lleves.</p>
        `,
        footer: `
            <button type="button" class="btn btn-ghost" data-session-modal="close">Cancelar</button>
            <button type="button" class="btn btn-success btn-lg session-primary" data-session-modal="confirm-load">
                <i class="ph ph-check-circle"></i> ${mode === 'open' ? 'Guardar y poner en servicio' : 'Agregar al inventario'}
            </button>
        `
    });
}

// Venta esperada por artículo y total, al escribir las cantidades
function updateLoadExpected() {
    let total = 0;
    document.querySelectorAll('#session-modal-body .load-qty').forEach(input => {
        const qty = parseFloat(input.value);
        const unitPrice = parseFloat(input.dataset.unitPrice);
        const cell = document.querySelector(`#session-modal-body [data-expected-for="${CSS.escape(input.dataset.itemId)}"]`);
        const expected = qty > 0 && Number.isFinite(unitPrice) ? qty * unitPrice : 0;
        total += expected;
        if (cell) cell.textContent = expected > 0 ? `Venta esperada ${formatMoney(expected)}` : '';
    });
    const totalCell = document.getElementById('load-expected-total');
    if (totalCell) totalCell.textContent = formatMoney(total);
}

function readLoads() {
    const now = new Date().toISOString();
    return [...document.querySelectorAll('#session-modal-body .load-qty')]
        .map(input => ({ itemId: input.dataset.itemId, qty: parseFloat(input.value) }))
        .filter(load => Number.isFinite(load.qty) && load.qty > 0)
        .map(load => ({ ...load, at: now }));
}

async function confirmLoad() {
    if (!modalState) return;
    const loads = readLoads();
    const { mode, branchId } = modalState;
    if (loads.length === 0) {
        showToast("Anota la cantidad de al menos un artículo");
        return;
    }
    const branchName = getBranchById(branchId)?.name || 'Sucursal';
    const active = getActiveSession(branchId);
    if (mode === 'restock' && active) {
        await addSessionLoads(active.id, loads);
        showToast(`Inventario de ${branchName} actualizado`, 'success');
    } else {
        await openSession(branchId, { openSource: 'inventory', loads });
        showToast(`${branchName} en servicio`, 'success');
    }
    closeSessionModal();
    notifyChange();
}

export function openCutModal(sessionId, { readOnly = false } = {}) {
    const session = getSessionById(sessionId);
    if (!session) return;
    const branch = getBranchById(session.branchId);
    const config = getBranchSessionConfig(branch);
    const transactions = getTransactions();
    const isToday = session.dateKey === getTodayKeyLocal();
    modalState = { mode: readOnly ? 'view' : 'cut', sessionId };

    const defaultClose = readOnly ? new Date(session.closedAt) : (isToday ? new Date() : estimateCloseTime(session, transactions));
    const summary = readOnly && session.summary
        ? session.summary
        : computeSessionSummary(session, transactions, getInventoryItems(), { closedAt: defaultClose });
    const openTables = getOpenTables().filter(table => table.branchId === session.branchId);
    const needsCount = config.inventoryEnabled && summary.items.length > 0;

    const stats = `
        <div class="cut-stats">
            <div><span>Tiempo en servicio</span><strong id="cut-duration">${formatDuration(summary.durationMinutes)}</strong></div>
            <div><span>Ventas</span><strong>${formatMoney(summary.salesTotal)}</strong></div>
            <div><span>Tickets</span><strong>${summary.ticketCount}</strong></div>
            <div><span>Ticket promedio</span><strong>${formatMoney(summary.avgTicket)}</strong></div>
            <div><span>Hora pico</span><strong>${summary.peakHour !== null && summary.peakHour !== undefined ? `${String(summary.peakHour).padStart(2, '0')}:00` : '—'}</strong></div>
        </div>
    `;

    const maxHour = Math.max(1, ...summary.salesByHour.map(entry => entry.total));
    const hours = summary.salesByHour.length > 0 ? `
        <div class="cut-section">
            <h4>Ventas por hora</h4>
            <div class="hour-bars">
                ${summary.salesByHour.map(entry => `
                    <div class="hour-bar" title="${String(entry.hour).padStart(2, '0')}:00 · ${formatMoney(entry.total)} · ${entry.count} ventas">
                        <span class="hour-bar-fill" style="height:${Math.max(6, Math.round((entry.total / maxHour) * 100))}%"></span>
                        <small>${String(entry.hour).padStart(2, '0')}</small>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    const items = summary.items.length > 0 ? `
        <div class="cut-section">
            <h4>Inventario</h4>
            ${needsCount && !readOnly ? '<p class="field-hint">Ya viene lo que debería sobrar según las ventas. Si al contar no cuadra, cámbialo; si sí, solo confirma el corte. Todo lo que sobra se registra como merma.</p>' : ''}
            <div class="cut-items">
                ${summary.items.map(item => `
                    <div class="cut-item" data-item-id="${escapeHtml(item.itemId)}" data-expected="${item.expectedLeft}" data-loaded="${item.loaded}" data-cost="${(getInventoryItems().find(i => i.id === item.itemId)?.unitCost) ?? ''}">
                        <div class="cut-item-head">
                            <strong>${escapeHtml(item.name)}</strong>
                            ${item.sellThrough !== null ? `<span class="sell-through${item.sellThrough >= 0.9 ? ' is-high' : item.sellThrough < 0.6 ? ' is-low' : ''}">${Math.round(item.sellThrough * 100)}% vendido</span>` : ''}
                        </div>
                        <div class="cut-item-stats">
                            <span>Llevado <b>${item.loaded}</b></span>
                            <span>Vendido <b>${item.sold}</b></span>
                            <span>Debería quedar <b>${item.expectedLeft}</b></span>
                            <span>${item.soldOutAt ? `Agotado <b>${formatTimeDisplay(new Date(item.soldOutAt))}</b>${item.minutesToSellOut !== null ? ` (${formatDuration(item.minutesToSellOut)})` : ''}` : 'No se agotó'}</span>
                        </div>
                        <div class="cut-item-count">
                            ${readOnly
                                ? `<span>Contado <b>${item.counted ?? '—'}</b></span>`
                                : `<label>Sobró <input type="number" class="cut-count" min="0" step="any" inputmode="decimal" value="${item.counted ?? item.expectedLeft}" aria-label="Piezas que sobraron de ${escapeHtml(item.name)}"></label>`}
                            <span class="cut-result">${renderCutResult(readOnly ? item.counted : (item.counted ?? item.expectedLeft), item.expectedLeft, getInventoryItems().find(i => i.id === item.itemId)?.unitCost ?? null)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${summary.totals?.wasteCost ? `<p class="cut-total-waste">Merma total: <b>${summary.totals.leftover} pzas · ${formatMoney(summary.totals.wasteCost)}</b></p>` : ''}
        </div>
    ` : (config.inventoryEnabled ? '<div class="notice notice-warning"><i class="ph ph-info"></i><span>No se cargó inventario en esta jornada.</span></div>' : '');

    const closeTimeField = readOnly ? '' : `
        <div class="form-row">
            <div class="form-group">
                <label class="field-label" for="cut-close-time">Hora de cierre</label>
                <input type="time" id="cut-close-time" value="${getLocalTimeInputValue(defaultClose)}">
                ${!isToday ? '<span class="field-hint">Estimada: última venta + 15 min. Ajústala si sabes la hora real.</span>' : ''}
            </div>
        </div>
    `;

    setModal({
        title: readOnly ? 'Corte del día' : 'Hacer corte',
        subtitle: `${branch?.name || 'Sucursal'} · ${formatDateKey(session.dateKey)} · desde ${formatTimeDisplay(new Date(session.openedAt))}${readOnly && session.closedAt ? ` hasta ${formatTimeDisplay(new Date(session.closedAt))}` : ''}`,
        body: `
            ${openTables.length > 0 && !readOnly ? `<div class="notice notice-warning"><i class="ph ph-warning"></i><span>Hay ${openTables.length} mesa(s) abierta(s) sin cobrar en esta sucursal. Cóbralas antes del corte para que cuenten.</span></div>` : ''}
            ${stats}
            ${closeTimeField}
            ${items}
            ${hours}
        `,
        footer: readOnly
            ? `<button type="button" class="btn btn-ghost" data-session-modal="reopen">Reabrir jornada</button>
               <button type="button" class="btn btn-secondary btn-lg session-primary" data-session-modal="close">Cerrar</button>`
            : `<button type="button" class="btn btn-ghost" data-session-modal="close">Cancelar</button>
               <button type="button" class="btn btn-primary btn-lg session-primary" data-session-modal="confirm-cut"><i class="ph ph-scissors"></i> Confirmar corte</button>`
    });
}

function renderCutResult(counted, expected, unitCost) {
    if (counted === null || counted === undefined || counted === '') return '';
    const count = Number(counted);
    const difference = Math.round((expected - count) * 1000) / 1000;
    const parts = [`Merma ${count}${typeof unitCost === 'number' && Number.isFinite(unitCost) ? ` (${formatMoney(count * unitCost)})` : ''}`];
    if (difference > 0) parts.push(`<span class="text-danger">faltan ${difference}</span>`);
    if (difference < 0) parts.push(`<span class="text-warning">sobran ${Math.abs(difference)} más de lo esperado</span>`);
    return parts.join(' · ');
}

export function handleSessionModalInput(event) {
    if (event.target.closest('.load-qty')) {
        updateLoadExpected();
        return;
    }
    const input = event.target.closest('.cut-count');
    if (input) {
        const card = input.closest('.cut-item');
        const cost = card.dataset.cost === '' ? null : Number(card.dataset.cost);
        card.querySelector('.cut-result').innerHTML = renderCutResult(input.value === '' ? null : input.value, Number(card.dataset.expected), cost);
    }
}

async function confirmCut() {
    const session = getSessionById(modalState?.sessionId);
    if (!session) return;
    // El conteo viene lleno con lo esperado; si se dejó vacío se toma lo esperado
    const physicalCount = {};
    document.querySelectorAll('#session-modal-body .cut-item').forEach(card => {
        const value = card.querySelector('.cut-count')?.value;
        const expected = Number(card.dataset.expected) || 0;
        physicalCount[card.dataset.itemId] = value === '' || value === undefined ? expected : Math.max(0, parseFloat(value) || 0);
    });

    const timeValue = document.getElementById('cut-close-time')?.value;
    let closedAt = combineLocalDateAndTime(session.dateKey, timeValue) || new Date();
    const openedAt = new Date(session.openedAt);
    if (closedAt < openedAt) {
        // El campo de hora no tiene segundos: en el mismo minuto de la apertura se toma la apertura
        if (openedAt - closedAt < 60000) closedAt = new Date(Math.max(openedAt.getTime(), Math.min(Date.now(), openedAt.getTime() + 59000)));
        else {
            showToast("La hora de cierre no puede ser antes de la apertura");
            return;
        }
    }
    const isToday = session.dateKey === getTodayKeyLocal();
    const summary = computeSessionSummary(session, getTransactions(), getInventoryItems(), { closedAt, physicalCount });
    await closeSession(session.id, {
        closedAt,
        closeSource: isToday ? 'cut' : 'estimated',
        physicalCount: Object.keys(physicalCount).length > 0 ? physicalCount : null,
        summary
    });
    showToast(`Corte de ${getBranchById(session.branchId)?.name || 'la sucursal'} guardado`, 'success');
    closeSessionModal();
    notifyChange();
}

export async function handleSessionModalClick(event) {
    const button = event.target.closest('[data-session-modal]');
    if (!button) return;
    const action = button.dataset.sessionModal;

    if (action === 'close') closeSessionModal();
    if (action === 'suggest') {
        const input = document.querySelector(`#session-modal-body .load-qty[data-item-id="${CSS.escape(button.dataset.itemId)}"]`);
        if (input) input.value = button.dataset.qty;
        updateLoadExpected();
    }
    if (action === 'suggest-all') {
        document.querySelectorAll('#session-modal-body [data-session-modal="suggest"]').forEach(chip => {
            const input = document.querySelector(`#session-modal-body .load-qty[data-item-id="${CSS.escape(chip.dataset.itemId)}"]`);
            if (input && !input.value) input.value = chip.dataset.qty;
        });
        updateLoadExpected();
    }
    if (action === 'confirm-load') await confirmLoad();
    if (action === 'confirm-cut') await confirmCut();
    if (action === 'reopen') {
        const session = getSessionById(modalState?.sessionId);
        if (!session) return;
        if (session.dateKey !== getTodayKeyLocal()) {
            showToast("Solo se puede reabrir la jornada de hoy");
            return;
        }
        if (!confirm("¿Reabrir la jornada? El corte guardado se recalculará cuando vuelvas a cerrarla.")) return;
        await reopenSession(session.id);
        showToast("Jornada reabierta", 'success');
        closeSessionModal();
        notifyChange();
    }
}

// ---------- Horario fijo: apertura y cierre automáticos ----------
// Solo para sucursales sin inventario (las de inventario abren al cargar y cierran con conteo).
export async function runScheduleTick(now = new Date()) {
    let changed = false;
    const transactions = getTransactions();

    for (const branch of getCustomBranches()) {
        const config = getBranchSessionConfig(branch);
        if (!config.sessionsEnabled || config.openMode !== 'schedule' || config.inventoryEnabled) continue;

        const schedule = getScheduleForDate(branch, now);
        const todaySession = getTodaySession(branch.id, now);
        if (schedule && now >= schedule.openAt && now < schedule.closeAt && !todaySession) {
            await openSession(branch.id, { openedAt: schedule.openAt, openSource: 'schedule' });
            changed = true;
        }
        const active = getActiveSession(branch.id, now);
        if (active && schedule && now >= schedule.closeAt) {
            const summary = computeSessionSummary(active, transactions, getInventoryItems(), { closedAt: schedule.closeAt });
            await closeSession(active.id, { closedAt: schedule.closeAt, closeSource: 'schedule', summary });
            changed = true;
        }
    }

    // Jornadas de días anteriores de sucursales con horario fijo: se cierran a su hora programada
    for (const session of getStaleOpenSessions(now)) {
        const branch = getBranchById(session.branchId);
        const config = getBranchSessionConfig(branch);
        if (config.openMode !== 'schedule' || config.inventoryEnabled) continue;
        const scheduleDay = getScheduleForDate(branch, new Date(`${session.dateKey}T12:00:00`));
        const closedAt = scheduleDay?.closeAt || estimateCloseTime(session, transactions);
        if (now < closedAt) continue;
        const summary = computeSessionSummary(session, transactions, getInventoryItems(), { closedAt });
        await closeSession(session.id, { closedAt, closeSource: scheduleDay ? 'schedule' : 'estimated', summary });
        changed = true;
    }

    if (changed) notifyChange();
}

export function getSessionLabelForSale(branchId) {
    const branch = getBranchById(branchId);
    const config = getBranchSessionConfig(branch);
    if (!config.sessionsEnabled) return null;
    const session = getTodaySession(branchId);
    if (session?.status === 'open') {
        const loaded = (session.loads || []).length > 0;
        return {
            tone: config.inventoryEnabled && !loaded ? 'warning' : 'ok',
            text: `En servicio desde ${formatTimeDisplay(new Date(session.openedAt))}${config.inventoryEnabled && !loaded ? ' · sin inventario cargado' : ''}`
        };
    }
    if (session?.status === 'closed') return { tone: 'warning', text: 'El corte de hoy ya se hizo: esta venta no contará en la jornada' };
    return {
        tone: 'warning',
        text: config.inventoryEnabled
            ? 'Fuera de servicio: carga el inventario en Principal, o esta venta abrirá la jornada sin inventario'
            : 'Fuera de servicio: esta venta pondrá la sucursal en servicio'
    };
}

