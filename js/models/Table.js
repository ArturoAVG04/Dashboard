import { isSameLocalDate } from '../core/date-utils.js';

export class Table {
    constructor({
        id = `table_${Date.now()}`,
        branchId = '',
        name = 'Mesa',
        items = [],
        total = 0,
        status = 'open',
        createdAt = new Date().toISOString()
    } = {}) {
        this.id = id;
        this.branchId = branchId;
        this.name = name;
        this.items = normalizeTableItems(items);
        this.total = typeof total === 'number' && total > 0 ? total : calculateItemsTotal(this.items);
        this.status = status;
        this.createdAt = createdAt;
    }
}

export function normalizeTableItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, itemIdx) => ({
        id: item.id || `item_${item.productId || 'p'}_${Date.now()}_${itemIdx}`,
        productId: item.productId || '',
        name: item.name || 'Producto',
        basePrice: typeof item.basePrice === 'number' ? item.basePrice : (Number(item.price) || 0),
        price: Number(item.price) || 0,
        qty: Number(item.qty) || 0,
        selectedModifiers: Array.isArray(item.selectedModifiers)
            ? item.selectedModifiers
            : (Array.isArray(item.modifiers) ? item.modifiers : []),
        modifierText: item.modifierText || '',
        modSignature: item.modSignature || '',
        ...(item.addedAt ? { addedAt: item.addedAt } : {})
    })).filter(item => item.qty > 0);
}

export function calculateItemsTotal(items) {
    return (items || []).reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
}

export const getItemsTotal = calculateItemsTotal;

export function normalizeTable(table, index = 0) {
    return new Table({
        ...table,
        id: table?.id || `table_${Date.now()}_${index}`
    });
}

export function normalizeOpenTables(tables) {
    return (tables || [])
        .map((table, index) => normalizeTable(table, index))
        .filter(table => table.status === 'open');
}

// ---------- Numeración diaria de mesas ----------
// Cuenta las mesas abiertas y las ya cobradas (ventas source 'table') de hoy en una sucursal.
// Con `since` (hora del último corte del día) solo cuenta las posteriores, para reiniciar tras el corte.
function timeOf(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
}

function todayOpen(openTables, branchId, since, now) {
    const sinceTime = since ? new Date(since).getTime() : null;
    return (openTables || []).filter(table => table.status === 'open'
        && isSameLocalDate(table.createdAt, now)
        && (!branchId || table.branchId === branchId)
        && (!sinceTime || timeOf(table.createdAt) > sinceTime));
}

function todayClosed(transactions, branchId, since, now) {
    const sinceTime = since ? new Date(since).getTime() : null;
    return (transactions || []).filter(t => t.source === 'table'
        && isSameLocalDate(t.soldAt || t.date || t.createdAt, now)
        && (!branchId || t.branchId === branchId || t.branch === branchId)
        && (!sinceTime || timeOf(t.soldAt || t.date || t.createdAt) > sinceTime));
}

export function countTodayTables(openTables, transactions, branchId, since = null, now = new Date()) {
    return todayOpen(openTables, branchId, since, now).length + todayClosed(transactions, branchId, since, now).length;
}

export function nextTableName(openTables, transactions, branchId, since = null, now = new Date()) {
    const numberOf = (text) => {
        const match = String(text || '').match(/Mesa\s*(\d+)/i);
        return match ? parseInt(match[1], 10) : 0;
    };
    const numbers = [
        ...todayOpen(openTables, branchId, since, now).map(table => numberOf(table.name)),
        ...todayClosed(transactions, branchId, since, now).map(t => numberOf(t.tableName || t.desc))
    ].filter(num => num > 0);
    return `Mesa ${numbers.length > 0 ? Math.max(...numbers) + 1 : 1}`;
}
