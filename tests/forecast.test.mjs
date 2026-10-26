import test from 'node:test';
import assert from 'node:assert/strict';
import {
    weightedAverage, stdDev, recommendQuantity, curveShareAt, estimateItemDemand, buildSalesCurve,
    buildItemRecommendations, classifyItem, startOfWeekKey, getWeekKeys, computeWeeklyReport, generateInsights,
    buildProductRecommendations
} from '../js/analytics/forecast.js';

test('promedio ponderado favorece lo reciente', () => {
    assert.equal(weightedAverage([10, 0]), 20 / 3);
    assert.equal(Math.round(stdDev([2, 4, 4, 4, 5, 5, 7, 9]) * 100) / 100, 2.14);
});

test('recomendación: base + margen, sin margen si hay mucha merma', () => {
    const steady = recommendQuantity([{ demand: 10, loaded: 12, leftover: 2 }, { demand: 10, loaded: 12, leftover: 2 }]);
    assert.equal(steady.qty, 10);
    const variable = recommendQuantity([{ demand: 12 }, { demand: 8 }, { demand: 10 }]);
    assert.ok(variable.qty >= 11);
    const wasteful = recommendQuantity([{ demand: 5, loaded: 12, leftover: 7 }, { demand: 9, loaded: 12, leftover: 3 }, { demand: 4, loaded: 12, leftover: 8 }]);
    assert.equal(wasteful.highWaste, true);
    assert.equal(wasteful.qty, Math.ceil(wasteful.base));
    assert.equal(recommendQuantity([]), null);
});

test('demanda estimada cuando se agotó temprano', () => {
    assert.equal(curveShareAt(null, 0.5), 0.5);
    assert.equal(curveShareAt([0, 0.5, 1], 0.25), 0.25);
    const item = { sold: 10, loaded: 10, soldOutAt: 'x', minutesToSellOut: 120 };
    assert.equal(estimateItemDemand(item, 240, null), 20); // a la mitad del servicio → el doble (tope)
    assert.equal(estimateItemDemand({ ...item, minutesToSellOut: 180 }, 240, null), 13.3);
    assert.equal(estimateItemDemand({ sold: 7, loaded: 10 }, 240, null), 7); // no se agotó
});

test('curva de ventas promedio por fracción del servicio', () => {
    const session = { id: 's', openedAt: new Date(2026, 9, 20, 12).toISOString(), closedAt: new Date(2026, 9, 20, 16).toISOString() };
    const txs = [
        { type: 'income', sessionId: 's', amount: 75, soldAt: new Date(2026, 9, 20, 12, 30).toISOString() },
        { type: 'income', sessionId: 's', amount: 25, soldAt: new Date(2026, 9, 20, 15, 30).toISOString() }
    ];
    const curve = buildSalesCurve([session], txs, 4);
    assert.deepEqual(curve, [0, 0.75, 0.75, 0.75, 1]);
});

const mkSession = (dateKey, sold, loaded, extra = {}) => ({
    id: `ses_uni_${dateKey}`, branchId: 'uni', dateKey, status: 'closed',
    openedAt: `${dateKey}T12:00:00`, closedAt: `${dateKey}T18:00:00`,
    summary: { durationMinutes: 360, salesTotal: sold * 40, ticketCount: sold, totals: { wasteCost: 0, leftover: loaded - sold },
        items: [{ itemId: 'b', name: 'Burrito', unit: 'pza', loaded, sold, leftover: loaded - sold, sellThrough: sold / loaded, difference: 0, ...extra }] }
});

test('recomendación por día de la semana con confianza', () => {
    // sábados 3, 10, 17 oct; un martes
    const sessions = [mkSession('2026-10-17', 12, 12), mkSession('2026-10-10', 10, 12), mkSession('2026-10-03', 11, 12), mkSession('2026-10-13', 4, 12)];
    const [rec] = buildItemRecommendations(sessions, [], 'uni', [{ id: 'b', name: 'Burrito' }], 6);
    assert.equal(rec.basis, 'weekday');
    assert.equal(rec.confidence, 'media');
    assert.ok(rec.qty >= 11 && rec.qty <= 13);
    const [tuesday] = buildItemRecommendations(sessions, [], 'uni', [{ id: 'b', name: 'Burrito' }], 2);
    assert.equal(tuesday.basis, 'all');
    assert.equal(tuesday.confidence, 'baja');
});

test('clasificación de artículos', () => {
    assert.equal(classifyItem({ daysTracked: 5, avgSellThrough: 0.98, soldOutRate: 0.8, avgSoldOutFraction: 0.4, lowDays: 0, mermaRate: 0 }).key, 'short');
    assert.equal(classifyItem({ daysTracked: 5, avgSellThrough: 0.95, soldOutRate: 0.6, avgSoldOutFraction: 0.9, lowDays: 0, mermaRate: 0 }).key, 'star');
    assert.equal(classifyItem({ daysTracked: 5, avgSellThrough: 0.5, soldOutRate: 0, avgSoldOutFraction: null, lowDays: 4, mermaRate: 0 }).key, 'slow');
    assert.equal(classifyItem({ daysTracked: 5, avgSellThrough: 0.8, soldOutRate: 0, avgSoldOutFraction: null, lowDays: 0, mermaRate: 0 }).key, 'stable');
    assert.equal(classifyItem({ daysTracked: 5, avgSellThrough: 0.8, soldOutRate: 0, avgSoldOutFraction: null, lowDays: 0, mermaRate: 0.2 }).key, 'shrink');
});

test('semana de lunes a domingo', () => {
    assert.equal(startOfWeekKey(new Date(2026, 9, 25, 10)), '2026-10-19'); // domingo → lunes anterior
    assert.equal(startOfWeekKey(new Date(2026, 9, 19, 10)), '2026-10-19');
    assert.deepEqual(getWeekKeys('2026-10-19').slice(-1), ['2026-10-25']);
});

test('reporte semanal: totales, comparación, artículos e insights', () => {
    const sessions = [
        mkSession('2026-10-20', 10, 12),
        mkSession('2026-10-24', 12, 12, { soldOutAt: '2026-10-24T14:00:00', minutesToSellOut: 120 }),
        mkSession('2026-10-13', 5, 12)
    ];
    const txs = [
        { type: 'income', sessionId: 'ses_uni_2026-10-24', amount: 480, soldAt: '2026-10-24T13:00:00', itemsSoldArray: [{ productId: 'p1', name: 'Burrito', qty: 12, total: 480 }] },
        { type: 'income', sessionId: 'ses_uni_2026-10-20', amount: 400, soldAt: '2026-10-20T13:30:00', itemsSoldArray: [{ productId: 'p1', name: 'Burrito', qty: 10, total: 400 }] }
    ];
    const report = computeWeeklyReport({ sessions, transactions: txs, inventoryItems: [], products: [{ id: 'p1', name: 'Burrito' }, { id: 'p9', name: 'Tamal' }], branchId: 'uni', weekStartKey: '2026-10-19' });
    assert.equal(report.totals.sessions, 2);
    assert.equal(report.totals.sales, 880);
    assert.equal(report.totals.previousSales, 200);
    assert.equal(report.totals.changeVsPrevious, 3.4);
    assert.equal(report.items[0].soldOutDays, 1);
    assert.equal(report.items[0].avgSellThrough, 0.92);
    assert.deepEqual(report.unsold, ['Tamal']);
    assert.equal(report.peakWindow.from, 13);
    const insights = generateInsights(report, { 6: [{ itemId: 'b', qty: 14 }] }, { branchName: 'Universidad' });
    assert.ok(insights.some(i => i.text.includes('más que la semana anterior')));
    assert.ok(insights.some(i => i.text.includes('Burrito se agotó 1 de 2')));
});

test('recomendación por producto (sucursales sin inventario)', () => {
    const sessions = ['2026-10-17', '2026-10-10', '2026-10-03'].map(dateKey => ({ id: dateKey, branchId: 'presa', dateKey, status: 'closed', openedAt: `${dateKey}T13:00:00`, closedAt: `${dateKey}T21:00:00`, summary: { items: [] } }));
    const txs = sessions.map((session, index) => ({ type: 'income', sessionId: session.id, amount: 100, soldAt: `${session.dateKey}T15:00:00`, itemsSoldArray: [{ productId: 'alitas', name: 'Alitas', qty: 10 + index }] }));
    const [rec] = buildProductRecommendations(sessions, txs, 'presa', 6);
    assert.equal(rec.name, 'Alitas');
    assert.equal(rec.basis, 'weekday');
    assert.ok(rec.qty >= 11);
});

test('semana en curso compara contra los mismos días de la semana anterior', () => {
    const sessions = [mkSession('2026-10-20', 10, 12), mkSession('2026-10-13', 10, 12), mkSession('2026-10-17', 10, 12)];
    const report = computeWeeklyReport({ sessions, transactions: [], inventoryItems: [], branchId: 'uni', weekStartKey: '2026-10-19', now: new Date(2026, 9, 20, 18) });
    assert.equal(report.totals.partialWeek, true);
    assert.equal(report.totals.changeVsPrevious, 0); // martes vs martes (el sábado anterior no cuenta)
});
