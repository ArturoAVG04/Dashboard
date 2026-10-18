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

export function renderBranchSalesSummary(data) {
    const branchSalesList = document.getElementById('branch-sales-list');
    if (!branchSalesList) return;

    const customBranches = getCustomBranches();
    const salesByBranch = customBranches.map(branch => ({
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
                <small class="branch-sales-share">${share}% de las ventas</small>
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

