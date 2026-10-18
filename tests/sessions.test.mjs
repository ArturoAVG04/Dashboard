import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, getBranchSessionConfig, getScheduleForDate, describeSchedule } from '../js/models/BranchConfig.js';
import { computeSessionStock, computeSoldOutTimes, computeSessionSummary, estimateCloseTime, formatDuration, computeItemSalesHistory } from '../js/analytics/session-metrics.js';

const at = (h, m = 0) => new Date(2026, 9, 17, h, m).toISOString();
const session = {
    id: 'ses_uni_2026-10-17', branchId: 'uni', openedAt: at(12),
    loads: [{ itemId: 'burrito', qty: 10, at: at(12) }, { itemId: 'burger', qty: 5, at: at(12) }, { itemId: 'burrito', qty: 2, at: at(15) }]
};
const sale = (h, m, amount, consumption, sessionId = session.id) => ({ type: 'income', amount, sessionId, soldAt: at(h, m), date: at(h, m), stockConsumption: consumption });
const txs = [
    sale(12, 30, 160, [{ itemId: 'burrito', qty: 3 }]),
    sale(13, 10, 255, [{ itemId: 'burger', qty: 3 }]),
    sale(13, 45, 200, [{ itemId: 'burrito', qty: 4 }, { itemId: 'burger', qty: 2 }]),
    sale(16, 0, 300, [{ itemId: 'burrito', qty: 5 }]),
    sale(13, 0, 999, [{ itemId: 'burrito', qty: 9 }], 'otra_jornada'),
    { type: 'expense', amount: 50, sessionId: session.id, date: at(13) }
];
const items = [{ id: 'burrito', name: 'Burrito', unit: 'pza', unitCost: 20 }, { id: 'burger', name: 'Hamburguesa', unit: 'pza', unitCost: null }];

test('horario: normaliza, describe y calcula apertura/cierre', () => {
    const schedule = normalizeSchedule({ 6: { open: '13:00', close: '21:00' }, 0: { open: '13:00', close: '19:00' }, 1: { open: 'x', close: '10:00' } });
    assert.deepEqual(Object.keys(schedule).sort(), ['0', '6']);
    assert.equal(describeSchedule(schedule), 'Sáb 13:00–21:00 · Dom 13:00–19:00');
    const saturday = new Date(2026, 9, 17, 10);
    const day = getScheduleForDate({ sessionsEnabled: true, schedule }, saturday);
    assert.equal(day.openAt.getHours(), 13);
    assert.equal(day.closeAt.getHours(), 21);
    assert.equal(getScheduleForDate({ schedule }, new Date(2026, 9, 16)), null);
});

test('horario que cruza medianoche cierra al día siguiente', () => {
    const day = getScheduleForDate({ schedule: { 6: { open: '20:00', close: '02:00' } } }, new Date(2026, 9, 17, 10));
    assert.equal(day.closeAt.getDate(), 18);
});

test('inventario solo aplica si las jornadas están activas', () => {
    assert.equal(getBranchSessionConfig({ inventoryEnabled: true }).inventoryEnabled, false);
    assert.equal(getBranchSessionConfig({ sessionsEnabled: true, inventoryEnabled: true }).inventoryEnabled, true);
    assert.equal(getBranchSessionConfig({}).openMode, 'manual');
});

test('existencias en vivo: solo cuenta ventas de esta jornada e incluye reabastecimiento', () => {
    const stock = computeSessionStock(session, txs);
    assert.deepEqual(stock.get('burrito'), { loaded: 12, sold: 12, remaining: 0 });
    assert.deepEqual(stock.get('burger'), { loaded: 5, sold: 5, remaining: 0 });
});

test('hora de agotado: cuando lo vendido alcanza todo lo llevado', () => {
    const soldOut = computeSoldOutTimes(session, txs);
    assert.equal(soldOut.get('burger').getHours(), 13);
    assert.equal(soldOut.get('burger').getMinutes(), 45);
    assert.equal(soldOut.get('burrito').getHours(), 16);
});

test('cierre estimado = última venta + 15 min', () => {
    const estimate = estimateCloseTime(session, txs);
    assert.equal(estimate.getHours(), 16);
    assert.equal(estimate.getMinutes(), 15);
});

test('resumen del corte con conteo físico: merma, diferencia, costo y % vendido', () => {
    const partialSession = { ...session, loads: [{ itemId: 'burrito', qty: 15, at: at(12) }, { itemId: 'burger', qty: 6, at: at(12) }] };
    const summary = computeSessionSummary(partialSession, txs, items, { closedAt: at(18), physicalCount: { burrito: 2, burger: 1 } });
    assert.equal(summary.durationMinutes, 360);
    assert.equal(summary.salesTotal, 915);
    assert.equal(summary.ticketCount, 4);
    assert.equal(summary.peakHour, 13);
    const burrito = summary.items.find(i => i.itemId === 'burrito');
    assert.equal(burrito.loaded, 15);
    assert.equal(burrito.sold, 12);
    assert.equal(burrito.expectedLeft, 3);
    assert.equal(burrito.leftover, 2);
    assert.equal(burrito.difference, 1);
    assert.equal(burrito.wasteCost, 40);
    assert.equal(burrito.sellThrough, 0.8);
    assert.equal(burrito.soldOutAt, null);
    const burger = summary.items.find(i => i.itemId === 'burger');
    assert.equal(burger.wasteCost, null);
    assert.equal(summary.totals.wasteCost, 40);
    assert.equal(summary.totals.loaded, 21);
});

test('minutos hasta agotarse desde la apertura', () => {
    const summary = computeSessionSummary(session, txs, items, { closedAt: at(18) });
    assert.equal(summary.items.find(i => i.itemId === 'burger').minutesToSellOut, 105);
});

test('formato de duración', () => {
    assert.equal(formatDuration(45), '45 min');
    assert.equal(formatDuration(120), '2 h');
    assert.equal(formatDuration(130), '2 h 10 min');
});

test('promedio vendido por artículo, general y del mismo día de la semana', () => {
    const mk = (dateKey, sold) => ({ branchId: 'uni', status: 'closed', dateKey, summary: { items: [{ itemId: 'b', loaded: 12, sold }] } });
    const sessions = [mk('2026-10-10', 10), mk('2026-10-03', 12), mk('2026-10-08', 5), { branchId: 'otra', status: 'closed', dateKey: '2026-10-09', summary: { items: [{ itemId: 'b', loaded: 1, sold: 1 }] } }];
    const history = computeItemSalesHistory(sessions, 'uni', 'b', { weekday: 6 });
    assert.equal(history.samples, 3);
    assert.equal(history.avgSold, 9);
    assert.equal(history.avgSoldWeekday, 11); // sábados 10 y 3 de oct
    assert.equal(computeItemSalesHistory(sessions, 'uni', 'nada'), null);
});
