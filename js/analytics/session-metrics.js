import { getSaleTimestamp } from '../core/date-utils.js';
import { normalizeStockUsage } from '../models/Inventory.js';

// Métricas de una jornada (F5). Todo se calcula a partir de las ventas ligadas por sessionId,
// así que editar o borrar una venta corrige automáticamente el inventario y el corte.

const ESTIMATED_CLOSE_MARGIN_MIN = 15;

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

// Ventas de la jornada en orden cronológico, con su hora real
export function getSessionSales(session, transactions) {
    if (!session?.id) return [];
    return (transactions || [])
        .filter(tx => tx.type === 'income' && tx.sessionId === session.id)
        .map(tx => ({ tx, at: getSaleTimestamp(tx).date }))
        .filter(entry => entry.at)
        .sort((a, b) => a.at - b.at);
}

export function getLoadedTotals(session) {
    const totals = new Map();
    (session?.loads || []).forEach(load => {
        const qty = Number(load.qty) || 0;
        if (!load.itemId || qty <= 0) return;
        totals.set(load.itemId, round((totals.get(load.itemId) || 0) + qty));
    });
    return totals;
}

function getSoldTotals(sales) {
    const totals = new Map();
    sales.forEach(({ tx }) => {
        normalizeStockUsage(tx.stockConsumption).forEach(({ itemId, qty }) => {
            totals.set(itemId, round((totals.get(itemId) || 0) + qty));
        });
    });
    return totals;
}

// Existencias en vivo: llevado, vendido y lo que queda por artículo
export function computeSessionStock(session, transactions) {
    const loaded = getLoadedTotals(session);
    const sold = getSoldTotals(getSessionSales(session, transactions));
    const ids = new Set([...loaded.keys(), ...sold.keys()]);
    const stock = new Map();
    ids.forEach(itemId => {
        const loadedQty = loaded.get(itemId) || 0;
        const soldQty = sold.get(itemId) || 0;
        stock.set(itemId, { loaded: loadedQty, sold: soldQty, remaining: round(loadedQty - soldQty) });
    });
    return stock;
}

// Momento en que cada artículo se agotó (lo vendido alcanzó todo lo llevado, incluidos reabastecimientos)
export function computeSoldOutTimes(session, transactions) {
    const loaded = getLoadedTotals(session);
    const cumulative = new Map();
    const soldOut = new Map();
    getSessionSales(session, transactions).forEach(({ tx, at }) => {
        normalizeStockUsage(tx.stockConsumption).forEach(({ itemId, qty }) => {
            const total = round((cumulative.get(itemId) || 0) + qty);
            cumulative.set(itemId, total);
            const loadedQty = loaded.get(itemId) || 0;
            if (loadedQty > 0 && total >= loadedQty && !soldOut.has(itemId)) soldOut.set(itemId, at);
        });
    });
    return soldOut;
}

// Si se olvidó cerrar: última venta + 15 min (o la apertura si no hubo ventas)
export function estimateCloseTime(session, transactions) {
    const sales = getSessionSales(session, transactions);
    const last = sales.length > 0 ? sales[sales.length - 1].at : toDate(session?.openedAt);
    return last ? new Date(last.getTime() + ESTIMATED_CLOSE_MARGIN_MIN * 60000) : new Date();
}

export function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins} min`;
    return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

// Resumen completo de la jornada (se guarda como snapshot al hacer el corte).
// physicalCount: { itemId: piezas contadas al cierre }. Todo lo que sobra es merma (no pasa al día siguiente).
export function computeSessionSummary(session, transactions, inventoryItems, { closedAt = null, physicalCount = null, now = new Date() } = {}) {
    const openedAt = toDate(session?.openedAt) || now;
    const end = toDate(closedAt) || toDate(session?.closedAt) || now;
    const sales = getSessionSales(session, transactions);
    const itemsById = new Map((inventoryItems || []).map(item => [item.id, item]));

    const salesTotal = round(sales.reduce((sum, { tx }) => sum + (Number(tx.amount) || 0), 0), 2);
    const ticketCount = sales.length;

    const byHour = new Map();
    sales.forEach(({ tx, at }) => {
        const hour = at.getHours();
        const entry = byHour.get(hour) || { hour, total: 0, count: 0 };
        entry.total = round(entry.total + (Number(tx.amount) || 0), 2);
        entry.count += 1;
        byHour.set(hour, entry);
    });
    const salesByHour = [...byHour.values()].sort((a, b) => a.hour - b.hour);
    const peakHour = salesByHour.reduce((best, entry) => (!best || entry.total > best.total ? entry : best), null);

    const stock = computeSessionStock(session, transactions);
    const soldOut = computeSoldOutTimes(session, transactions);
    const counts = physicalCount || session?.physicalCount || null;

    const items = [...stock.entries()].map(([itemId, { loaded, sold }]) => {
        const item = itemsById.get(itemId);
        const expectedLeft = round(Math.max(0, loaded - sold));
        const countedRaw = counts && counts[itemId] !== undefined && counts[itemId] !== null && counts[itemId] !== '' ? Number(counts[itemId]) : null;
        const counted = Number.isFinite(countedRaw) ? countedRaw : null;
        const leftover = counted !== null ? counted : expectedLeft;
        const unitCost = typeof item?.unitCost === 'number' ? item.unitCost : null;
        const soldOutAt = soldOut.get(itemId) || null;
        return {
            itemId,
            name: item?.name || 'Artículo eliminado',
            unit: item?.unit || 'pza',
            loaded,
            sold,
            expectedLeft,
            counted,
            leftover,
            difference: counted !== null ? round(expectedLeft - counted) : null,
            wasteCost: unitCost !== null ? round(leftover * unitCost, 2) : null,
            sellThrough: loaded > 0 ? round(Math.min(sold / loaded, 1.5), 4) : null,
            soldOutAt: soldOutAt ? soldOutAt.toISOString() : null,
            minutesToSellOut: soldOutAt ? Math.max(0, Math.round((soldOutAt - openedAt) / 60000)) : null
        };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    const totalLoaded = round(items.reduce((sum, item) => sum + item.loaded, 0));
    const totalSold = round(items.reduce((sum, item) => sum + Math.min(item.sold, item.loaded || item.sold), 0));

    return {
        openedAt: openedAt.toISOString(),
        closedAt: end.toISOString(),
        durationMinutes: Math.max(0, Math.round((end - openedAt) / 60000)),
        salesTotal,
        ticketCount,
        avgTicket: ticketCount > 0 ? round(salesTotal / ticketCount, 2) : 0,
        salesByHour,
        peakHour: peakHour ? peakHour.hour : null,
        items,
        totals: {
            loaded: totalLoaded,
            sold: round(items.reduce((sum, item) => sum + item.sold, 0)),
            leftover: round(items.reduce((sum, item) => sum + item.leftover, 0)),
            wasteCost: round(items.reduce((sum, item) => sum + (item.wasteCost || 0), 0), 2),
            sellThrough: totalLoaded > 0 ? round(totalSold / totalLoaded, 4) : null
        }
    };
}

// Promedio de piezas vendidas de un artículo en jornadas cerradas anteriores de la sucursal
// (general y del mismo día de la semana). Usa el snapshot guardado en cada corte.
export function computeItemSalesHistory(sessions, branchId, itemId, { weekday = null, limit = 8, beforeDateKey = null } = {}) {
    const entries = (sessions || [])
        .filter(session => session.branchId === branchId && session.status === 'closed' && session.summary?.items
            && (!beforeDateKey || session.dateKey < beforeDateKey))
        .map(session => ({ session, item: session.summary.items.find(entry => entry.itemId === itemId && entry.loaded > 0) }))
        .filter(entry => entry.item)
        .sort((a, b) => b.session.dateKey.localeCompare(a.session.dateKey))
        .slice(0, limit);
    if (entries.length === 0) return null;

    const average = (list) => list.length > 0 ? round(list.reduce((sum, entry) => sum + entry.item.sold, 0) / list.length, 1) : null;
    const sameDay = weekday === null ? [] : entries.filter(({ session }) => new Date(`${session.dateKey}T12:00:00`).getDay() === weekday);
    return {
        avgSold: average(entries),
        samples: entries.length,
        avgSoldWeekday: sameDay.length > 0 ? average(sameDay) : null,
        weekdaySamples: sameDay.length
    };
}
