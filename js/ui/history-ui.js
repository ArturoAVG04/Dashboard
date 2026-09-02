import { formatMoney, normalizeText } from '../core/date-utils.js';
import { formatExportDate } from './backup-ui.js';
import { getTopSellerStats, getTopExpenseStats } from './dashboard-ui.js';
import { getCustomProducts } from '../services/products-service.js';

let topSellersVisible = true;
let topExpensesVisible = true;
let historyTransactionsVisible = true;

export function setCollapsibleSectionState(panel, button, isVisible) {
    if (!panel || !button) return;
    panel.style.display = isVisible ? 'block' : 'none';
    const icon = button.querySelector('i');
    if (icon) {
        icon.className = isVisible ? 'ph ph-caret-up' : 'ph ph-caret-down';
    }
}

export function toggleTopSellersSection() {
    topSellersVisible = !topSellersVisible;
    return topSellersVisible;
}

export function toggleTopExpensesSection() {
    topExpensesVisible = !topExpensesVisible;
    return topExpensesVisible;
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

    const badgeType = t.type === 'income' ? 'Ingreso' : 'Gasto';
    const sign = t.type === 'income' ? '+' : '-';
    const zoneBadge = t.zone ? `<small style="display:block; color:var(--primary); font-size:0.75rem;"><i class="ph ph-map-pin"></i> ${t.zone}</small>` : '';

    tr.innerHTML = `
        <td>${dateStr}</td>
        <td><span class="badge ${t.type}">${badgeType}</span></td>
        <td>${t.desc} ${zoneBadge}</td>
        <td>${t.category}</td>
        <td class="align-right" style="font-weight: 600; color: var(--${t.type === 'income' ? 'success' : 'danger'})">
            ${sign}${formatMoney(t.amount)}
        </td>
        ${showActions ? `<td><div class="history-actions"><button class="btn-text" onclick="window.editTransaction('${t.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button><button class="btn-text" onclick="window.deleteTransaction('${t.id}')" title="Eliminar"><i class="ph ph-trash"></i></button></div></td>` : ''}
    `;
    return tr;
}

export function getHistorySearchText(transaction) {
    const dateText = formatExportDate(transaction.date);
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
        topSellersTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Sin datos para mostrar</td></tr>`;
        return;
    }

    sorted.forEach(([name, stats]) => {
        topSellersTbody.innerHTML += `
            <tr>
                <td style="font-weight: 500;">${stats.label || name}</td>
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

    const sorted = getTopExpenseStats(data);

    topExpensesTbody.innerHTML = '';
    if (sorted.length === 0) {
        topExpensesTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Sin gastos para mostrar</td></tr>`;
        return;
    }

    sorted.forEach(([name, stats]) => {
        topExpensesTbody.innerHTML += `
            <tr>
                <td style="font-weight: 500;">${stats.label || name}</td>
                <td class="align-right">${stats.count}</td>
                <td class="align-right text-danger">${formatMoney(stats.total)}</td>
            </tr>
        `;
    });
}

export function renderFullHistory(transactions = [], { typeFilter = 'all', searchTerm = '' } = {}) {
    renderTopSellers(transactions);
    renderTopExpenses(transactions);

    const historyTransactionsPanel = document.getElementById('history-transactions-panel');
    const btnToggleHistoryTransactions = document.getElementById('btn-toggle-history-transactions');
    const historyTbody = document.getElementById('history-tbody');
    const historyTypeFilterSelect = document.getElementById('history-type-filter');
    const historySearchInput = document.getElementById('history-search');

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
        ? visibleTransactions.filter(t => getHistorySearchText(t).includes(normalizedSearch))
        : visibleTransactions;

    if (filtered.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Sin registros en el historial</td></tr>`;
        return;
    }

    filtered.forEach(t => historyTbody.appendChild(createTransactionRow(t, true)));
}
