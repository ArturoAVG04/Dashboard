import { formatMoney, normalizeText, toTitleCase, escapeHtml } from '../core/date-utils.js';
import { createTransactionRow } from './history-ui.js';
import { getCustomBranches, getStableBranchColor } from '../services/branches-service.js';

export function updateDashboardSummaryCards(transactions) {
    const summaryIncome = document.getElementById('summary-income');
    const summaryExpense = document.getElementById('summary-expense');
    const summaryProfit = document.getElementById('summary-profit');

    let totalIncome = 0;
    let totalExpense = 0;
    let incomeCount = 0;
    let expenseCount = 0;

    (transactions || []).forEach(item => {
        const amount = Number(item.amount) || 0;
        if (item.type === 'income') {
            totalIncome += amount;
            incomeCount += 1;
        } else if (item.type === 'expense') {
            totalExpense += amount;
            expenseCount += 1;
        }
    });

    const profit = totalIncome - totalExpense;
    if (summaryIncome) summaryIncome.textContent = formatMoney(totalIncome);
    if (summaryExpense) summaryExpense.textContent = formatMoney(totalExpense);
    if (summaryProfit) {
        summaryProfit.textContent = formatMoney(profit);
        summaryProfit.classList.toggle('is-negative', profit < 0);
        summaryProfit.classList.toggle('is-positive', profit > 0);
    }

    setMeta('summary-income-meta', incomeCount > 0
        ? `${incomeCount} venta${incomeCount === 1 ? '' : 's'} · ticket promedio ${formatMoney(totalIncome / incomeCount)}`
        : 'Sin ventas en este periodo');
    setMeta('summary-expense-meta', expenseCount > 0
        ? `${expenseCount} gasto${expenseCount === 1 ? '' : 's'} registrado${expenseCount === 1 ? '' : 's'}`
        : 'Sin gastos en este periodo');
    setMeta('summary-profit-meta', totalIncome > 0
        ? `Margen ${Math.round((profit / totalIncome) * 100)}% sobre ventas`
        : '—');
}

function setMeta(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

export function renderRecentTransactions(transactions, limit = 6) {
    const recentTbody = document.getElementById('recent-tbody');
    if (!recentTbody) return;

    recentTbody.innerHTML = '';
    const slice = (transactions || []).slice(0, limit);

    if (slice.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="6" class="table-empty">Sin movimientos registrados</td></tr>`;
        return;
    }

    slice.forEach(t => recentTbody.appendChild(createTransactionRow(t, false)));
}

export function getItemsForTransaction(transaction, products = []) {
    if (Array.isArray(transaction.itemsSoldArray) && transaction.itemsSoldArray.length > 0) {
        return transaction.itemsSoldArray.map(item => ({
            name: item.name,
            qty: Number(item.qty) || 0,
            total: Number(item.total) || ((Number(item.price) || 0) * (Number(item.qty) || 0))
        }));
    }

    if (!transaction.desc || transaction.desc === 'Venta General') return [];

    const normalizedDesc = transaction.desc
        .replace(/\s+[xX]\s+/g, 'x ')
        .replace(/[•|]/g, ',')
        .trim();
    const parts = normalizedDesc.split(/\s*,\s*/).filter(Boolean);
    const parsedItems = parts
        .map(part => {
            const match = part.match(/^(\d+)\s*x\s+(.+)$/i);
            if (!match) return null;
            return {
                qty: parseInt(match[1], 10),
                name: match[2].trim()
            };
        })
        .filter(Boolean);

    if (parsedItems.length === 0) return [];

    const totalQty = parsedItems.reduce((sum, item) => sum + item.qty, 0) || 1;

    return parsedItems.map(item => {
        const product = products.find(prod => prod.name === item.name);
        const fallbackUnitPrice = product ? product.price : (transaction.amount / totalQty);

        return {
            ...item,
            total: fallbackUnitPrice * item.qty
        };
    });
}

export function getAggregationMeta(productName) {
    const originalName = (productName || '').trim();
    const normalizedName = normalizeText(originalName);

    const compactComboMatch = normalizedName.match(/^(\d+)\s*x\s*\$?\s*(\d+(?:\.\d+)?)\s+(.+)$/i);
    if (compactComboMatch) {
        const [, qty, price, rawProduct] = compactComboMatch;
        const product = normalizeText(rawProduct);
        return {
            key: `combo:${product}:${qty}:${price}`,
            label: `${qty} ${toTitleCase(product)} por $${price}`
        };
    }

    const naturalComboMatch = normalizedName.match(/^(\d+)\s+(.+?)\s+por\s+\$?\s*(\d+(?:\.\d+)?)$/i);
    if (naturalComboMatch) {
        const [, qty, rawProduct, price] = naturalComboMatch;
        const product = normalizeText(rawProduct);
        return {
            key: `combo:${product}:${qty}:${price}`,
            label: `${qty} ${toTitleCase(product)} por $${price}`
        };
    }

    return {
        key: `name:${normalizedName}`,
        label: originalName
    };
}

export function getTopSellerStats(data, products = []) {
    const productStats = {};

    (data || []).forEach(t => {
        if (t.type === 'income') {
            const items = getItemsForTransaction(t, products);

            if (items.length > 0) {
                items.forEach(item => {
                    const aggregation = getAggregationMeta(item.name);
                    if (!productStats[aggregation.key]) {
                        productStats[aggregation.key] = {
                            label: aggregation.label,
                            qty: 0,
                            total: 0
                        };
                    }

                    productStats[aggregation.key].qty += item.qty;
                    productStats[aggregation.key].total += (item.total || 0);
                });
            }
        }
    });

    return Object.entries(productStats)
        .sort((a, b) => {
            if (b[1].qty !== a[1].qty) return b[1].qty - a[1].qty;
            return b[1].total - a[1].total;
        });
}

export function getTopExpenseStats(data) {
    const expenseStats = {};

    (data || [])
        .filter(transaction => transaction.type === 'expense')
        .forEach(transaction => {
            const label = (transaction.desc || transaction.category || 'Gasto sin descripción').trim();
            const key = normalizeText(label) || 'gasto-sin-descripcion';

            if (!expenseStats[key]) {
                expenseStats[key] = {
                    label,
                    count: 0,
                    total: 0
                };
            }

            expenseStats[key].count += 1;
            expenseStats[key].total += Number(transaction.amount) || 0;
        });

    return Object.entries(expenseStats)
        .sort((a, b) => {
            if (b[1].total !== a[1].total) return b[1].total - a[1].total;
            return b[1].count - a[1].count;
        });
}

function dayText(stats) {
    if (!stats?.workedDays) return '';
    const n = stats.workedDays;
    return stats.isEvent
        ? ` · ${formatMoney(stats.salesPerDay)} por evento (${n} evento${n === 1 ? '' : 's'})`
        : ` · día típico ${formatMoney(stats.typicalDay)} (${n} día${n === 1 ? '' : 's'})`;
}

export function renderBranchSalesSummary(data, dayStats = []) {
    const statsById = new Map(dayStats.map(row => [row.branchId, row]));
    const branchSalesList = document.getElementById('branch-sales-list');
    if (!branchSalesList) return;

    const customBranches = getCustomBranches();
    const salesByBranch = customBranches.map(branch => ({
        id: branch.id,
        name: branch.name,
        color: getStableBranchColor(branch),
        total: (data || [])
            .filter(item => item.type === 'income' && (item.zone === branch.name || item.branch === branch.id || item.branchId === branch.id))
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    }));

    const grandTotal = salesByBranch.reduce((sum, branch) => sum + branch.total, 0);
    branchSalesList.innerHTML = salesByBranch
        .sort((a, b) => b.total - a.total)
        .map(branch => {
            const share = grandTotal > 0 ? Math.round((branch.total / grandTotal) * 100) : 0;
            return `
            <div class="branch-sales-item">
                <div class="branch-sales-row">
                    <span class="branch-sales-name"><span class="branch-color-dot" style="background:${branch.color};"></span>${escapeHtml(branch.name)}</span>
                    <strong>${formatMoney(branch.total)}</strong>
                </div>
                <div class="share-bar" aria-hidden="true"><span style="width:${share}%; background:${branch.color};"></span></div>
                <small class="branch-sales-share">${share}% de las ventas${dayText(statsById.get(branch.id))}</small>
            </div>
        `;
        }).join('');
}

export function getProductsPeriodStats(data, products = []) {
    const productStats = {};

    (data || [])
        .filter(transaction => transaction.type === 'income')
        .forEach(transaction => {
            getItemsForTransaction(transaction, products).forEach(item => {
                if (!item.name || item.qty <= 0) return;

                const aggregation = getAggregationMeta(item.name);
                if (!productStats[aggregation.key]) {
                    productStats[aggregation.key] = {
                        label: aggregation.label,
                        qty: 0
                    };
                }

                productStats[aggregation.key].qty += Number(item.qty) || 0;
            });
        });

    return Object.values(productStats)
        .filter(item => item.qty > 0)
        .sort((a, b) => {
            if (b.qty !== a.qty) return b.qty - a.qty;
            return a.label.localeCompare(b.label, 'es');
        });
}

export function renderProductsPeriodSummary(data, filterLabel = 'Resumen', products = []) {
    const dailyProductsList = document.getElementById('daily-products-list');
    const dailyProductsTitle = document.getElementById('daily-products-title');
    if (!dailyProductsList) return;

    if (dailyProductsTitle) {
        dailyProductsTitle.textContent = `Productos vendidos · ${filterLabel}`;
    }

    const periodProducts = getProductsPeriodStats(data, products);

    dailyProductsList.innerHTML = '';
    if (periodProducts.length === 0) {
        dailyProductsList.innerHTML = `
            <div class="empty-state empty-state-compact">
                <i class="ph ph-hamburger"></i>
                <p>Sin productos vendidos en este periodo</p>
            </div>
        `;
        return;
    }

    periodProducts.forEach(product => {
        const row = document.createElement('div');
        row.className = 'daily-product-item';

        const name = document.createElement('span');
        name.textContent = product.label;

        const qty = document.createElement('strong');
        qty.textContent = product.qty;

        row.append(name, qty);
        dailyProductsList.appendChild(row);
    });
}


// ---------- Comparativa de sucursales (F8/F8b) ----------
export function renderBranchComparison({ comparison, insights, periodLabel, hasPrevious }) {
    const panel = document.getElementById('branch-comparison-panel');
    const grid = document.getElementById('branch-comparison-grid');
    const list = document.getElementById('branch-comparison-insights');
    const period = document.getElementById('branch-comparison-period');
    if (!panel || !grid) return;

    const branches = getCustomBranches();
    if (branches.length < 2) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    if (period) period.textContent = `${periodLabel}. Día trabajado = día con ventas o con jornada abierta. Día típico = la mitad de los días se vende más y la otra mitad menos.`;
    document.querySelectorAll('[data-comparison-sort]').forEach(button => {
        button.classList.toggle('active', button.dataset.comparisonSort === comparison.sortBy);
    });

    if (comparison.rows.length === 0) {
        if (list) list.innerHTML = '';
        grid.innerHTML = `<div class="empty-state empty-state-compact"><i class="ph ph-storefront"></i><p>Sin movimientos en este periodo</p></div>`;
        return;
    }

    if (list) {
        list.innerHTML = insights.map(insight => `<li class="insight insight-${insight.tone}"><i class="ph ${insight.tone === 'good' ? 'ph-trophy' : insight.tone === 'warn' ? 'ph-warning' : 'ph-info'}"></i><span>${escapeHtml(insight.text)}</span></li>`).join('');
    }

    const colorOf = (branchId) => {
        const branch = branches.find(entry => entry.id === branchId);
        return branch ? getStableBranchColor(branch) : 'var(--text-muted)';
    };
    const byDay = comparison.sortBy !== 'total';
    const daypartColors = { morning: '#f59e0b', lunch: '#10b981', afternoon: '#0ea5e9', night: '#8b5cf6' };

    grid.innerHTML = comparison.rows.map(row => {
        const dayWord = row.isEvent ? 'evento' : 'día';
        const timed = row.dayparts.some(part => part.share > 0);
        return `
        <article class="comparison-card${row.rank === 1 && comparison.rows.length > 1 ? ' is-best' : ''}">
            <div class="comparison-head">
                <span class="comparison-rank">#${row.rank}</span>
                <span class="branch-sales-name"><span class="branch-color-dot" style="background:${colorOf(row.branchId)};"></span>${escapeHtml(row.name)}</span>
                ${row.isEvent ? '<span class="tag"><i class="ph ph-confetti"></i> Eventos</span>' : ''}
                ${hasPrevious && row.change !== null ? `<span class="comparison-change ${row.change >= 0 ? 'is-up' : 'is-down'}" title="Venta por ${dayWord} contra los mismos días de la semana del periodo anterior"><i class="ph ${row.change >= 0 ? 'ph-trend-up' : 'ph-trend-down'}"></i> ${Math.round(Math.abs(row.change) * 100)}%</span>` : ''}
            </div>
            <div class="comparison-profit">
                <span>${byDay ? (row.isEvent ? 'Venta promedio por evento' : 'Día típico') : 'Ventas del periodo'}</span>
                <strong class="text-success">${formatMoney(byDay ? (row.isEvent ? row.salesPerDay : row.typicalDay) : row.sales)}</strong>
                <small>${row.workedDays} ${row.isEvent ? `evento${row.workedDays === 1 ? '' : 's'}` : `día${row.workedDays === 1 ? '' : 's'} trabajado${row.workedDays === 1 ? '' : 's'}`}${row.scheduledDays !== null ? ` de ${row.scheduledDays} de su horario` : ''}${row.workedDays > 1 ? ` · entre ${formatMoney(row.worstDay)} y ${formatMoney(row.bestDay)}` : ''}</small>
            </div>
            <dl class="comparison-stats">
                <div><dt>${byDay ? 'Ventas del periodo' : (row.isEvent ? 'Promedio por evento' : 'Día típico')}</dt><dd>${formatMoney(byDay ? row.sales : (row.isEvent ? row.salesPerDay : row.typicalDay))}</dd></div>
                <div><dt>Promedio por ${dayWord}</dt><dd>${formatMoney(row.salesPerDay)}</dd></div>
                <div><dt>Pedidos por ${dayWord}</dt><dd>${row.ticketsPerDay}</dd></div>
                <div><dt>Ticket promedio</dt><dd>${formatMoney(row.avgTicket)}</dd></div>
                ${row.ordersPerHour !== null ? `<div><dt>Pedidos por hora</dt><dd>${row.ordersPerHour}</dd></div>` : ''}
                ${row.daysWithoutSales > 0 ? `<div><dt>Días abiertos sin ventas</dt><dd>${row.daysWithoutSales}</dd></div>` : ''}
                ${row.ownExpenses > 0 ? `<div><dt>Gastos de la sucursal</dt><dd>${formatMoney(row.ownExpenses)}</dd></div><div><dt>Ganancia por ${dayWord}</dt><dd>${formatMoney(row.profitPerDay)}</dd></div>` : ''}
                ${row.wasteCost > 0 ? `<div><dt>Merma</dt><dd>${formatMoney(row.wasteCost)}</dd></div>` : ''}
            </dl>
            ${timed ? `
                <div class="daypart-block">
                    <span class="daypart-title">Venta por franja del día</span>
                    <div class="daypart-bar">
                        ${row.dayparts.filter(part => part.share > 0).map(part => `<span style="width:${Math.max(2, Math.round(part.share * 100))}%; background:${daypartColors[part.key]};" title="${part.label}: ${formatMoney(part.sales)} · ${Math.round(part.share * 100)}%"></span>`).join('')}
                    </div>
                    <div class="daypart-legend">
                        ${row.dayparts.filter(part => part.share > 0).map(part => `<span><i style="background:${daypartColors[part.key]};"></i>${part.label} ${Math.round(part.share * 100)}%</span>`).join('')}
                    </div>
                </div>` : ''}
            ${row.incompleteSessions > 0 || row.estimatedTimeSales > 0 ? `<p class="data-quality"><i class="ph ph-warning-circle"></i> ${[
                row.incompleteSessions > 0 ? `${row.incompleteSessions} jornada${row.incompleteSessions === 1 ? '' : 's'} con horario incompleto` : '',
                row.estimatedTimeSales > 0 ? `${row.estimatedTimeSales} venta${row.estimatedTimeSales === 1 ? '' : 's'} sin hora` : ''
            ].filter(Boolean).join(' · ')}</p>` : ''}
            <small class="branch-sales-share">${Math.round(row.salesShare * 100)}% de las ventas del periodo</small>
        </article>
    `;
    }).join('');
}
