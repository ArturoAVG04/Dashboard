import { escapeHtml, formatMoney, formatTimeDisplay } from '../core/date-utils.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { getCustomBranches, getBranchById, productAvailableInBranch } from '../services/branches-service.js';
import { getTransactions, needsFullHistory, loadFullHistory } from '../services/transactions-service.js';
import { getInventoryItems, getBranchInventoryItems } from '../services/inventory-service.js';
import { getCustomProducts } from '../services/products-service.js';
import { getSessions } from '../services/sessions-service.js';
import { getBranchSessionConfig } from '../models/BranchConfig.js';
import { computeSessionSummary, formatDuration } from '../analytics/session-metrics.js';
import {
    WEEKDAY_LABELS,
    WEEKDAY_SHORT,
    startOfWeekKey,
    addDaysToKey,
    dateFromKey,
    weekdayOf,
    computeWeeklyReport,
    buildItemRecommendations,
    buildProductRecommendations,
    getBranchClosedSessions,
    generateInsights
} from '../analytics/forecast.js';
import { openCutModal, renderSessionsSection } from './sessions-ui.js';

const CUTS_PAGE = 20;
let activeTab = loadLocalState(STORAGE_KEYS.sessionsTab, 'today');
let cutsBranchId = loadLocalState(STORAGE_KEYS.cutsBranch, '');
let cutsLimit = CUTS_PAGE;
let weekBranchId = loadLocalState(STORAGE_KEYS.reportBranch, '');
let weekStartKey = startOfWeekKey();

function sessionBranches() {
    return getCustomBranches().filter(branch => getBranchSessionConfig(branch).sessionsEnabled);
}

function shortDate(dateKey, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    const text = dateFromKey(dateKey).toLocaleDateString('es-MX', options);
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function weekRangeLabel(startKey) {
    const endKey = addDaysToKey(startKey, 6);
    return `${shortDate(startKey, { day: 'numeric', month: 'short' })} – ${shortDate(endKey, { day: 'numeric', month: 'short' })}`;
}

function sellThroughClass(value) {
    if (value === null || value === undefined) return '';
    if (value >= 0.9) return 'is-high';
    if (value >= 0.7) return 'is-mid';
    return 'is-low';
}

// ---------- Pestañas de Jornadas ----------
export function setSessionsTab(tab) {
    activeTab = ['today', 'cuts', 'week'].includes(tab) ? tab : 'today';
    saveLocalState(STORAGE_KEYS.sessionsTab, activeTab);
    document.querySelectorAll('[data-sessions-tab]').forEach(button => {
        const isActive = button.dataset.sessionsTab === activeTab;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-sessions-panel]').forEach(panel => {
        panel.hidden = panel.dataset.sessionsPanel !== activeTab;
    });
    renderSessionsView();
}

export function renderSessionsView() {
    if (activeTab === 'today') renderSessionsSection();
    if (activeTab === 'cuts') renderCutsList();
    if (activeTab === 'week') renderWeeklyReport();
}

export function initSessionsTabs() {
    setSessionsTab(activeTab);
}

// ---------- Historial de cortes ----------
// Sucursales con cortes o con jornadas activadas (los cortes se ven por sucursal)
function cutsBranches() {
    const withSessions = new Set(getSessions().map(session => session.branchId));
    return getCustomBranches().filter(branch => getBranchSessionConfig(branch).sessionsEnabled || withSessions.has(branch.id));
}

export function renderCutsList() {
    const container = document.getElementById('cuts-list');
    const picker = document.getElementById('cuts-branch-picker');
    if (!container) return;

    const branches = cutsBranches();
    if (!branches.some(branch => branch.id === cutsBranchId)) cutsBranchId = branches[0]?.id || '';
    if (picker) {
        picker.innerHTML = branches.length > 1 ? `
            <div class="segmented" role="tablist" aria-label="Sucursal">
                ${branches.map(branch => `<button type="button" class="segmented-btn${branch.id === cutsBranchId ? ' active' : ''}" data-report-action="cuts-branch" data-branch-id="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</button>`).join('')}
            </div>` : '';
    }

    const transactions = getTransactions();
    const items = getInventoryItems();
    const sessions = getSessions()
        .filter(session => session.branchId === cutsBranchId && (session.status === 'closed' || session.dateKey < startOfDayKey()))
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    if (sessions.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="ph ph-scissors"></i><p>Aún no hay cortes${cutsBranchId ? ` en ${escapeHtml(getBranchById(cutsBranchId)?.name || 'esta sucursal')}` : ''}.</p><small>${branches.length === 0 ? 'Activa "Registrar jornadas" en una sucursal para empezar.' : 'Aparecen aquí al hacer el corte del día.'}</small></div>`;
        return;
    }

    const visible = sessions.slice(0, cutsLimit);
    const groups = new Map();
    visible.forEach(session => {
        const week = startOfWeekKey(dateFromKey(session.dateKey));
        if (!groups.has(week)) groups.set(week, []);
        groups.get(week).push(session);
    });

    container.innerHTML = [...groups.entries()].map(([week, list]) => {
        const summaries = list.map(session => ({ session, summary: session.summary || computeSessionSummary(session, transactions, items) }));
        const weekSales = summaries.reduce((sum, entry) => sum + (entry.summary.salesTotal || 0), 0);
        return `
            <div class="cuts-week">
                <div class="cuts-week-header">
                    <h4>Semana del ${escapeHtml(weekRangeLabel(week))} · ${list.length} jornada${list.length === 1 ? '' : 's'}</h4>
                    <span>${formatMoney(weekSales)}</span>
                </div>
                <div class="cuts-grid">
                    ${summaries.map(({ session, summary }) => renderCutCard(session, summary)).join('')}
                </div>
            </div>
        `;
    }).join('') + (sessions.length > cutsLimit
        ? `<button type="button" class="btn btn-secondary btn-block" data-report-action="more-cuts">Ver más cortes (${sessions.length - cutsLimit})</button>`
        : '');
}

function startOfDayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function renderCutCard(session, summary) {
    const branch = getBranchById(session.branchId);
    const isPending = session.status !== 'closed';
    const soldOut = (summary.items || []).filter(item => item.soldOutAt).length;
    const sellThrough = summary.totals?.sellThrough;
    const sourceTag = isPending
        ? '<span class="tag tag-warning">Corte pendiente</span>'
        : session.closeSource === 'estimated' ? '<span class="tag tag-warning">Cierre estimado</span>'
        : session.closeSource === 'schedule' ? '<span class="tag">Por horario</span>' : '';
    return `
        <article class="cut-card${isPending ? ' is-pending' : ''}">
            <div class="cut-card-top">
                <strong>${escapeHtml(shortDate(session.dateKey))}</strong>
                <span class="session-branch">${escapeHtml(branch?.name || 'Sucursal eliminada')}</span>
            </div>
            <p class="session-main">${formatMoney(summary.salesTotal || 0)} <small>· ${summary.ticketCount || 0} venta${summary.ticketCount === 1 ? '' : 's'}</small></p>
            <p class="session-meta">${formatTimeDisplay(new Date(session.openedAt))}${session.closedAt ? `–${formatTimeDisplay(new Date(session.closedAt))}` : ''} · ${formatDuration(summary.durationMinutes || 0)}</p>
            <div class="option-chips">
                ${sourceTag}
                ${typeof sellThrough === 'number' ? `<span class="sell-through ${sellThroughClass(sellThrough)}">${Math.round(sellThrough * 100)}% vendido</span>` : ''}
                ${summary.totals?.wasteCost ? `<span class="option-chip">Merma <b>${formatMoney(summary.totals.wasteCost)}</b></span>` : ''}
                ${soldOut > 0 ? `<span class="option-chip">${soldOut} agotado${soldOut === 1 ? '' : 's'}</span>` : ''}
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-report-action="${isPending ? 'cut' : 'view-cut'}" data-session-id="${escapeHtml(session.id)}">
                <i class="ph ${isPending ? 'ph-scissors' : 'ph-receipt'}"></i> ${isPending ? 'Hacer corte' : 'Ver corte'}
            </button>
        </article>
    `;
}

// ---------- Reporte semanal ----------
function getWeekBranchId() {
    const branches = sessionBranches();
    if (!branches.some(branch => branch.id === weekBranchId)) weekBranchId = branches[0]?.id || '';
    return weekBranchId;
}

// Días de la semana con historial en la sucursal (para recomendar la próxima semana)
function weekdaysWithHistory(branchId) {
    const days = new Set(getBranchClosedSessions(getSessions(), branchId).slice(0, 60).map(session => weekdayOf(session.dateKey)));
    return [1, 2, 3, 4, 5, 6, 0].filter(day => days.has(day));
}

export function renderWeeklyReport() {
    const controls = document.getElementById('weekly-controls');
    const container = document.getElementById('weekly-report');
    if (!container) return;

    const branches = sessionBranches();
    const branchId = getWeekBranchId();
    const currentWeek = startOfWeekKey();

    if (controls) {
        controls.innerHTML = branches.length > 0 ? `
            <div class="segmented weekly-branches" role="tablist" aria-label="Sucursal">
                ${branches.map(branch => `<button type="button" class="segmented-btn${branch.id === branchId ? ' active' : ''}" data-report-action="week-branch" data-branch-id="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</button>`).join('')}
            </div>
            <div class="week-nav">
                <button type="button" class="btn-icon" data-report-action="prev-week" aria-label="Semana anterior"><i class="ph ph-caret-left"></i></button>
                <span>${escapeHtml(weekRangeLabel(weekStartKey))}${weekStartKey === currentWeek ? ' · esta semana' : ''}</span>
                <button type="button" class="btn-icon" data-report-action="next-week" aria-label="Semana siguiente" ${weekStartKey >= currentWeek ? 'disabled' : ''}><i class="ph ph-caret-right"></i></button>
            </div>
        ` : '';
    }

    if (!branchId) {
        container.innerHTML = `<div class="empty-state"><i class="ph ph-chart-bar"></i><p>Ninguna sucursal registra jornadas.</p><small>Actívalo en Productos → Sucursales → editar.</small></div>`;
        return;
    }

    const branch = getBranchById(branchId);
    const config = getBranchSessionConfig(branch);
    const sessions = getSessions();
    const transactions = getTransactions();
    const branchItems = getBranchInventoryItems(branchId);
    const branchProducts = getCustomProducts().filter(product => productAvailableInBranch(product, branchId));
    const report = computeWeeklyReport({
        sessions,
        transactions,
        inventoryItems: getInventoryItems(),
        products: branchProducts,
        branchId,
        weekStartKey
    });

    const recommendationDays = weekdaysWithHistory(branchId);
    const todayKey = startOfDayKey();
    const recommendations = {};
    recommendationDays.forEach(weekday => {
        recommendations[weekday] = config.inventoryEnabled && branchItems.length > 0
            ? buildItemRecommendations(sessions, transactions, branchId, branchItems, weekday, { beforeDateKey: todayKey })
            : buildProductRecommendations(sessions, transactions, branchId, weekday, { beforeDateKey: todayKey, top: 8 });
    });
    const insights = generateInsights(report, config.inventoryEnabled ? recommendations : {}, { branchName: branch?.name || 'la sucursal', money: formatMoney });

    if (report.totals.sessions === 0) {
        container.innerHTML = `
            <div class="empty-state"><i class="ph ph-calendar-x"></i><p>Sin jornadas en esta semana.</p><small>Cambia de semana con las flechas o revisa la pestaña Cortes.</small></div>
            ${renderRecommendations(recommendations, config, recommendationDays)}
        `;
        return;
    }

    const change = report.totals.changeVsPrevious;
    container.innerHTML = `
        <div class="report-kpis">
            <div class="report-kpi">
                <span>Ventas</span>
                <strong>${formatMoney(report.totals.sales)}</strong>
                ${change !== null ? `<small class="${change >= 0 ? 'text-success' : 'text-danger'}"><i class="ph ${change >= 0 ? 'ph-trend-up' : 'ph-trend-down'}"></i> ${Math.round(Math.abs(change) * 100)}% vs ${report.totals.partialWeek ? 'mismos días de la semana anterior' : 'semana anterior'}</small>` : '<small>Sin semana anterior</small>'}
            </div>
            <div class="report-kpi">
                <span>Jornadas</span>
                <strong>${report.totals.sessions}</strong>
                <small>${formatDuration(report.totals.minutes)} en servicio</small>
            </div>
            <div class="report-kpi">
                <span>Ticket promedio</span>
                <strong>${formatMoney(report.totals.avgTicket)}</strong>
                <small>${report.totals.tickets} ventas</small>
            </div>
            ${config.inventoryEnabled ? `
                <div class="report-kpi">
                    <span>Merma</span>
                    <strong>${formatMoney(report.totals.wasteCost)}</strong>
                    <small>${report.totals.leftover} piezas sobrantes</small>
                </div>` : ''}
        </div>

        ${insights.length > 0 ? `
            <section class="panel">
                <div class="panel-header"><h3>Recomendaciones</h3></div>
                <ul class="insights-list">
                    ${insights.map(insight => `<li class="insight insight-${insight.tone}"><i class="ph ${insight.tone === 'good' ? 'ph-trend-up' : insight.tone === 'warn' ? 'ph-lightbulb' : 'ph-info'}"></i><span>${escapeHtml(insight.text)}</span></li>`).join('')}
                </ul>
            </section>` : ''}

        ${renderRecommendations(recommendations, config, recommendationDays)}

        <section class="panel">
            <div class="panel-header"><h3>Ventas por día</h3></div>
            ${renderDayBars(report)}
        </section>

        ${report.items.length > 0 ? renderItemsSection(report) : ''}
        ${renderProductsSection(report)}
        ${renderHeatmap(report)}
    `;
}

function renderRecommendations(recommendations, config, days) {
    if (days.length === 0) return '';
    const isInventory = config.inventoryEnabled && getBranchInventoryItems(getWeekBranchId()).length > 0;
    const cards = days.map(weekday => {
        const list = recommendations[weekday] || [];
        if (list.length === 0) return '';
        return `
            <div class="reco-day">
                <h4>${WEEKDAY_LABELS[weekday]}</h4>
                <ul>
                    ${list.map(entry => `
                        <li>
                            <span>${escapeHtml(entry.name)}</span>
                            <strong>${entry.qty}</strong>
                            <i class="confidence confidence-${entry.confidence}" title="Confianza ${entry.confidence} (${entry.samples} jornada${entry.samples === 1 ? '' : 's'}${entry.basis === 'all' ? ', usando todos los días' : ''})"></i>
                        </li>`).join('')}
                </ul>
            </div>
        `;
    }).join('');
    if (!cards.trim()) return '';
    return `
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h3>${isInventory ? 'Cuánto llevar' : 'Cuánto preparar'} la próxima semana</h3>
                    <p class="panel-description">Según tus jornadas anteriores del mismo día${isInventory ? ', corrigiendo los días que se agotó' : ''}. El punto indica la confianza: <span class="confidence-legend"><i class="confidence confidence-alta"></i> alta <i class="confidence confidence-media"></i> media <i class="confidence confidence-baja"></i> baja</span></p>
                </div>
            </div>
            <div class="reco-grid">${cards}</div>
        </section>
    `;
}

function renderDayBars(report) {
    const max = Math.max(1, ...report.salesByDay.map(day => day.sales || 0));
    return `
        <div class="day-bars">
            ${report.salesByDay.map(day => `
                <div class="day-bar${day.sales === null ? ' is-empty' : ''}" title="${escapeHtml(shortDate(day.dateKey))}: ${day.sales === null ? 'sin jornada' : formatMoney(day.sales)}">
                    <small class="day-bar-value">${day.sales ? formatMoney(day.sales).replace('.00', '') : ''}</small>
                    <span class="day-bar-fill" style="height:${day.sales ? Math.max(6, Math.round((day.sales / max) * 100)) : 0}%"></span>
                    <small>${WEEKDAY_SHORT[day.weekday]}</small>
                </div>
            `).join('')}
        </div>
    `;
}

function renderItemsSection(report) {
    return `
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h3>Inventario de la semana</h3>
                    <p class="panel-description">Vendido / llevado por día. Verde: casi todo; ámbar: sobró algo; rojo: sobró mucho.</p>
                </div>
            </div>
            <div class="report-items">
                ${report.items.map(item => `
                    <article class="report-item">
                        <div class="report-item-head">
                            <strong>${escapeHtml(item.name)}</strong>
                            <span class="item-label item-label-${item.label.key}" title="${escapeHtml(item.label.hint || '')}">${escapeHtml(item.label.label)}</span>
                        </div>
                        <div class="day-chips">
                            ${report.weekKeys.map(dateKey => {
                                const day = item.days[dateKey];
                                return `<span class="day-chip ${day ? sellThroughClass(day.sellThrough) : 'is-none'}" title="${escapeHtml(shortDate(dateKey))}${day?.soldOutAt ? ` · agotado ${formatTimeDisplay(new Date(day.soldOutAt))}` : ''}">
                                    <small>${WEEKDAY_SHORT[weekdayOf(dateKey)]}</small>
                                    ${day ? `<b>${day.sold}/${day.loaded}</b>${day.soldOutAt ? '<i class="ph-fill ph-lightning"></i>' : ''}` : '<b>—</b>'}
                                </span>`;
                            }).join('')}
                        </div>
                        <p class="session-meta">
                            ${item.sold} de ${item.loaded} (${Math.round((item.avgSellThrough || 0) * 100)}%)
                            ${item.soldOutDays > 0 ? ` · se agotó ${item.soldOutDays} día${item.soldOutDays === 1 ? '' : 's'}${item.avgMinutesToSellOut !== null ? `, a las ${formatDuration(item.avgMinutesToSellOut)} de abrir` : ''}` : ''}
                            ${item.perHour !== null ? ` · ${item.perHour} por hora` : ''}
                            ${item.wasteCost > 0 ? ` · merma ${formatMoney(item.wasteCost)}` : ''}
                        </p>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderProductsSection(report) {
    if (report.products.length === 0) return '';
    const max = Math.max(1, ...report.products.map(product => product.qty));
    const slow = new Set(report.slowProducts);
    return `
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h3>Productos de la semana</h3>
                    <p class="panel-description">Del más al menos vendido.</p>
                </div>
            </div>
            <div class="product-ranking">
                ${report.products.map(product => `
                    <div class="product-rank-row">
                        <div class="product-rank-info">
                            <span>${escapeHtml(product.name)} ${slow.has(product.name) ? '<span class="item-label item-label-slow">Le cuesta salir</span>' : ''}</span>
                            <small>${product.qty} · ${formatMoney(product.revenue)} · ${Math.round(product.share * 100)}%</small>
                        </div>
                        <div class="share-bar"><span style="width:${Math.round((product.qty / max) * 100)}%; background: var(--primary);"></span></div>
                    </div>
                `).join('')}
            </div>
            ${report.unsold.length > 0 ? `<p class="field-hint report-unsold">Sin ventas esta semana: ${report.unsold.map(name => escapeHtml(name)).join(', ')}.</p>` : ''}
        </section>
    `;
}

function renderHeatmap(report) {
    const hours = Object.keys(report.hourly).map(Number).sort((a, b) => a - b);
    if (hours.length === 0) return '';
    const order = [1, 2, 3, 4, 5, 6, 0];
    return `
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h3>Horas pico</h3>
                    <p class="panel-description">Ventas por hora y día; más intenso = más ventas.</p>
                </div>
            </div>
            <div class="heatmap">
                <span></span>${order.map(day => `<small class="heatmap-head">${WEEKDAY_SHORT[day]}</small>`).join('')}
                ${hours.map(hour => `
                    <small class="heatmap-hour">${String(hour).padStart(2, '0')}:00</small>
                    ${order.map(day => {
                        const value = report.hourly[hour]?.[day] || 0;
                        const intensity = report.maxHourly > 0 ? value / report.maxHourly : 0;
                        return `<span class="heatmap-cell" style="background: rgba(16, 185, 129, ${value ? (0.15 + intensity * 0.85).toFixed(2) : 0.04});" title="${WEEKDAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00 · ${formatMoney(value)}"></span>`;
                    }).join('')}
                `).join('')}
            </div>
        </section>
    `;
}

// ---------- Eventos ----------
export function handleReportsClick(event) {
    const tab = event.target.closest('[data-sessions-tab]');
    if (tab) {
        setSessionsTab(tab.dataset.sessionsTab);
        return;
    }
    const button = event.target.closest('[data-report-action]');
    if (!button) return;
    const { reportAction, branchId, sessionId } = button.dataset;
    if (reportAction === 'cuts-branch') {
        cutsBranchId = branchId;
        cutsLimit = CUTS_PAGE;
        saveLocalState(STORAGE_KEYS.cutsBranch, branchId);
        renderCutsList();
    }
    if (reportAction === 'more-cuts') {
        cutsLimit += CUTS_PAGE;
        renderCutsList();
    }
    if (reportAction === 'view-cut') openCutModal(sessionId, { readOnly: true });
    if (reportAction === 'cut') openCutModal(sessionId);
    if (reportAction === 'week-branch') {
        weekBranchId = branchId;
        saveLocalState(STORAGE_KEYS.reportBranch, branchId);
        renderWeeklyReport();
    }
    if (reportAction === 'prev-week') {
        weekStartKey = addDaysToKey(weekStartKey, -7);
        // Semanas de más de 90 días atrás necesitan el historial completo (se vuelve a dibujar al llegar)
        if (needsFullHistory(dateFromKey(addDaysToKey(weekStartKey, -7)))) loadFullHistory().catch(() => {});
        renderWeeklyReport();
    }
    if (reportAction === 'next-week') {
        const next = addDaysToKey(weekStartKey, 7);
        if (next <= startOfWeekKey()) {
            weekStartKey = next;
            renderWeeklyReport();
        }
    }
}
