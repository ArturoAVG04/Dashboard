import { formatMoney, normalizeText, getSaleTimestamp, formatTimeDisplay, escapeHtml } from '../core/date-utils.js';
import { getCustomExpenseTags } from '../services/products-service.js';
import { getExpenseGroups } from '../services/expense-groups-service.js';
import { getExpenseStatsByGroup } from '../models/ExpenseTag.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { formatExportDate } from './backup-ui.js';
import { getTopSellerStats, getTopExpenseStats } from './dashboard-ui.js';
import { getCustomProducts } from '../services/products-service.js';

let topSellersVisible = true;
let topExpensesVisible = true;
let historyTransactionsVisible = true;
let topExpensesByGroup = false;

// Rendimiento (F7b): se dibujan 50 filas a la vez, con periodo propio y texto de búsqueda en caché
const HISTORY_PAGE = 50;
let historyLimit = HISTORY_PAGE;
let historyPeriod = loadLocalState(STORAGE_KEYS.historyPeriod, '30');
const searchTextCache = new WeakMap();

export function getHistoryPeriod() {
    return historyPeriod;
}

export function setHistoryPeriod(period) {
    historyPeriod = ['7', '30', '90', 'year', 'all'].includes(period) ? period : '30';
    saveLocalState(STORAGE_KEYS.historyPeriod, historyPeriod);
    historyLimit = HISTORY_PAGE;
}

export function resetHistoryPaging() {
    historyLimit = HISTORY_PAGE;
}

export function showMoreHistory() {
    historyLimit += HISTORY_PAGE;
}

function filterByHistoryPeriod(transactions, now = new Date()) {
    if (historyPeriod === 'all') return transactions;
    const start = historyPeriod === 'year'
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(historyPeriod) - 1));
    const startTime = start.getTime();
    return transactions.filter(t => {
        const time = new Date(t.date || t.createdAt || 0).getTime();
        return time >= startTime;
    });
}

function cachedSearchText(transaction) {
    let text = searchTextCache.get(transaction);
    if (text === undefined) {
        text = getHistorySearchText(transaction);
        searchTextCache.set(transaction, text);
    }
    return text;
}

export function setCollapsibleSectionState(panel, button, isVisible) {
    if (!panel || !button) return;
    panel.style.display = isVisible ? '' : 'none';
    button.setAttribute('aria-expanded', String(isVisible));
    const icon = button.querySelector('i');
    if (icon) {
        icon.className = isVisible ? 'ph ph-caret-up' : 'ph ph-caret-down';
    }
    const label = button.querySelector('span');
    if (label) label.textContent = isVisible ? 'Ocultar' : 'Mostrar';
}

export function toggleTopSellersSection() {
    topSellersVisible = !topSellersVisible;
    return topSellersVisible;
}

export function toggleTopExpensesSection() {
    topExpensesVisible = !topExpensesVisible;
    return topExpensesVisible;
}

export function toggleTopExpensesMode() {
    topExpensesByGroup = !topExpensesByGroup;
    const button = document.getElementById('btn-top-expenses-mode');
    const label = button?.querySelector('span');
    const icon = button?.querySelector('i');
    if (label) label.textContent = topExpensesByGroup ? 'Por concepto' : 'Por grupo';
    if (icon) icon.className = topExpensesByGroup ? 'ph ph-list' : 'ph ph-folders';
    return topExpensesByGroup;
}

export function toggleHistoryTransactionsSection() {
    historyTransactionsVisible = !historyTransactionsVisible;
    return historyTransactionsVisible;
}

export function createTransactionRow(t, showActions = true) {
    const tr = document.createElement('tr');

    let dateStr = "Fecha desconocida";
    try {
        if (t.date) {
            const d = new Date(t.date);
            if (!isNaN(d.getTime())) {
                const options = { day: '2-digit', month: 'short', year: 'numeric' };
                dateStr = d.toLocaleDateString('es-ES', options);
            }
        }
    } catch (e) { }

    const timeStr = getTransactionTimeText(t);
    const timeBadge = timeStr ? `<small class="tx-time"><i class="ph ph-clock"></i> ${timeStr}</small>` : '';

    const badgeType = t.type === 'income' ? 'Venta' : 'Gasto';
    const sign = t.type === 'income' ? '+' : '-';
    const zoneBadge = t.zone ? `<small class="tx-zone"><i class="ph ph-map-pin"></i> ${escapeHtml(t.zone)}</small>` : '';

    tr.innerHTML = `
        <td class="tx-date" data-label="Fecha">${dateStr}${timeBadge}</td>
        <td class="tx-type" data-label="Tipo"><span class="badge ${t.type}">${badgeType}</span></td>
        <td class="tx-desc" data-label="Descripción">${escapeHtml(t.desc)} ${zoneBadge}</td>
        <td class="tx-category" data-label="Categoría">${escapeHtml(t.category)}</td>
        <td class="align-right amount-cell ${t.type}" data-label="Monto">${sign}${formatMoney(t.amount)}</td>
        ${showActions ? `<td class="align-right tx-actions"><div class="history-actions"><button type="button" class="btn-icon" onclick="window.editTransaction('${t.id}')" title="Editar" aria-label="Editar"><i class="ph ph-pencil-simple"></i></button><button type="button" class="btn-icon btn-icon-danger" onclick="window.deleteTransaction('${t.id}')" title="Eliminar" aria-label="Eliminar"><i class="ph ph-trash"></i></button></div></td>` : ''}
    `;
    return tr;
}

// Hora a mostrar; vacía si es estimada (ventas registradas de otro día sin hora).
export function getTransactionTimeText(transaction) {
    const { date, estimated } = getSaleTimestamp(transaction);
    return estimated ? '' : formatTimeDisplay(date);
}

export function getHistorySearchText(transaction) {
    const dateText = `${formatExportDate(transaction.date)} ${getTransactionTimeText(transaction)}`;
    const typeText = transaction.type === 'income' ? 'venta ingreso' : 'gasto egreso';
    const amountText = String(transaction.amount || '');

    return normalizeText([
        dateText,
        typeText,
        transaction.desc,
        transaction.category,
        transaction.zone,
        amountText
    ].filter(Boolean).join(' '));
}

export function renderTopSellers(data) {
    const topSellersPanel = document.getElementById('top-sellers-panel');
    const btnToggleTopSellers = document.getElementById('btn-toggle-top-sellers');
    const topSellersTbody = document.getElementById('top-sellers-tbody');

    setCollapsibleSectionState(topSellersPanel, btnToggleTopSellers, topSellersVisible);
    if (!topSellersTbody) return;
    if (!topSellersVisible) {
        topSellersTbody.innerHTML = '';
        return;
    }

    const customProducts = getCustomProducts();
    const sorted = getTopSellerStats(data, customProducts);

    topSellersTbody.innerHTML = '';
    if (sorted.length === 0) {
        topSellersTbody.innerHTML = `<tr><td colspan="3" class="table-empty">Sin datos para mostrar</td></tr>`;
        return;
    }

    sorted.forEach(([name, stats]) => {
        topSellersTbody.innerHTML += `
            <tr>
                <td class="cell-strong">${escapeHtml(stats.label || name)}</td>
                <td class="align-right">${stats.qty}</td>
                <td class="align-right text-success">${formatMoney(stats.total)}</td>
            </tr>
        `;
    });
}

export function renderTopExpenses(data) {
    const topExpensesPanel = document.getElementById('top-expenses-panel');
    const btnToggleTopExpenses = document.getElementById('btn-toggle-top-expenses');
    const topExpensesTbody = document.getElementById('top-expenses-tbody');

    setCollapsibleSectionState(topExpensesPanel, btnToggleTopExpenses, topExpensesVisible);
    if (!topExpensesTbody) return;
    if (!topExpensesVisible) {
        topExpensesTbody.innerHTML = '';
        return;
    }

    if (topExpensesByGroup) {
        renderTopExpensesByGroup(data, topExpensesTbody);
        return;
    }

    const sorted = getTopExpenseStats(data);

    topExpensesTbody.innerHTML = '';
    if (sorted.length === 0) {
        topExpensesTbody.innerHTML = `<tr><td colspan="3" class="table-empty">Sin gastos para mostrar</td></tr>`;
        return;
    }

    sorted.forEach(([name, stats]) => {
        topExpensesTbody.innerHTML += `
            <tr>
                <td class="cell-strong">${escapeHtml(stats.label || name)}</td>
                <td class="align-right">${stats.count}</td>
                <td class="align-right text-danger">${formatMoney(stats.total)}</td>
            </tr>
        `;
    });
}

function renderTopExpensesByGroup(data, tbody) {
    const sections = getExpenseStatsByGroup(data, getCustomExpenseTags(), getExpenseGroups());
    if (sections.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Sin gastos para mostrar</td></tr>`;
        return;
    }

    tbody.innerHTML = sections.map(section => `
        <tr class="expense-group-row">
            <td><span class="expense-group-dot" style="background:${escapeHtml(section.group.color || 'var(--text-muted)')};"></span> ${escapeHtml(section.group.name)}</td>
            <td class="align-right">${section.count}</td>
            <td class="align-right text-danger">${formatMoney(section.total)}</td>
        </tr>
        ${section.concepts.map(concept => `
            <tr class="expense-concept-row">
                <td>${escapeHtml(concept.label)}</td>
                <td class="align-right">${concept.count}</td>
                <td class="align-right">${formatMoney(concept.total)}</td>
            </tr>
        `).join('')}
    `).join('');
}

export function renderFullHistory(allTransactions = [], { typeFilter = 'all', searchTerm = '' } = {}) {
    const transactions = filterByHistoryPeriod(allTransactions);
    renderTopSellers(transactions);
    renderTopExpenses(transactions);

    const historyTransactionsPanel = document.getElementById('history-transactions-panel');
    const btnToggleHistoryTransactions = document.getElementById('btn-toggle-history-transactions');
    const historyTbody = document.getElementById('history-tbody');
    const historyTypeFilterSelect = document.getElementById('history-type-filter');
    const historySearchInput = document.getElementById('history-search');
    const historyPeriodSelect = document.getElementById('history-period-filter');
    const historyMore = document.getElementById('history-more');
    if (historyPeriodSelect && historyPeriodSelect.value !== historyPeriod) historyPeriodSelect.value = historyPeriod;
    if (historyMore) historyMore.innerHTML = '';

    setCollapsibleSectionState(historyTransactionsPanel, btnToggleHistoryTransactions, historyTransactionsVisible);
    if (historyTypeFilterSelect && historyTypeFilterSelect.value !== typeFilter) {
        historyTypeFilterSelect.value = typeFilter;
    }
    if (historySearchInput && historySearchInput.value !== searchTerm) {
        historySearchInput.value = searchTerm;
    }
    if (!historyTbody) return;
    historyTbody.innerHTML = '';
    if (!historyTransactionsVisible) return;

    const normalizedSearch = normalizeText(searchTerm);
    const visibleTransactions = typeFilter === 'all'
        ? transactions
        : transactions.filter(t => t.type === typeFilter);

    const filtered = normalizedSearch
        ? visibleTransactions.filter(t => cachedSearchText(t).includes(normalizedSearch))
        : visibleTransactions;

    if (filtered.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="6" class="table-empty">Sin registros${historyPeriod !== 'all' ? ' en este periodo. Prueba con "Todo" para buscar más atrás' : ' en el historial'}.</td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    filtered.slice(0, historyLimit).forEach(t => fragment.appendChild(createTransactionRow(t, true)));
    historyTbody.appendChild(fragment);

    if (historyMore) {
        const shown = Math.min(historyLimit, filtered.length);
        historyMore.innerHTML = filtered.length > shown
            ? `<span>Mostrando ${shown} de ${filtered.length}</span><button type="button" class="btn btn-secondary btn-sm" data-history-action="more">Ver ${Math.min(HISTORY_PAGE, filtered.length - shown)} más</button>`
            : `<span>${filtered.length} registro${filtered.length === 1 ? '' : 's'}</span>`;
    }
}
