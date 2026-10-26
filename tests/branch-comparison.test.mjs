import test from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodRange, isInRange, computeBranchComparison, generateBranchInsights, median, isCompleteSession } from '../js/analytics/branch-comparison.js';

const branches = [{ id: 'uni', name: 'Universidad' }, { id: 'presa', name: 'La Presa' }];
const sale = (branchId, amount, date = '2026-10-26T15:00:00', extra = {}) => ({ type: 'income', branchId, amount, date, soldAt: date, ...extra });
const expense = (amount, extra = {}) => ({ type: 'expense', amount, date: '2026-10-26T09:00:00', zone: '', ...extra });
const session = (branchId, dateKey, extra = {}) => ({ branchId, dateKey, status: 'closed', openSource: 'manual', closeSource: 'cut', durationMinutes: 240, ticketCount: 0, wasteCost: 0, ...extra });

test('rangos de periodo y periodo anterior', () => {
    const now = new Date(2026, 9, 28, 12);
    const week = getPeriodRange('week', now);
    assert.equal(week.start.getDate(), 26);
    assert.equal(week.previous.start.getDate(), 19);
    const custom = getPeriodRange('custom', now, new Date(2026, 9, 10), new Date(2026, 9, 12));
    assert.equal(custom.previous.start.getDate(), 7);
    assert.equal(getPeriodRange('all', now).previous, null);
    assert.equal(isInRange({ date: '2026-10-27T10:00:00' }, week), true);
    assert.equal(isInRange({ date: '2026-10-20T10:00:00' }, week), false);
});

test('mediana y jornadas completas', () => {
    assert.equal(median([100, 5000, 200]), 200);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(isCompleteSession(session('x', 'd')), true);
    assert.equal(isCompleteSession(session('x', 'd', { openSource: 'auto-first-sale' })), false);
    assert.equal(isCompleteSession(session('x', 'd', { closeSource: 'estimated' })), false);
    assert.equal(isCompleteSession(session('x', 'd', { durationMinutes: 10 })), false);
});

test('día trabajado, día típico, pedidos por día y ganancia sin repartir gastos generales', () => {
    const transactions = [
        sale('uni', 1000, '2026-10-20T13:00:00'), sale('uni', 500, '2026-10-20T15:00:00'),
        sale('uni', 1500, '2026-10-21T13:00:00'), sale('uni', 6000, '2026-10-22T13:00:00'),
        sale('presa', 2000, '2026-10-24T20:00:00'),
        expense(300, { branchId: 'uni', zone: 'Universidad' }),
        expense(1000)
    ];
    const sessionSummaries = [session('presa', '2026-10-24'), session('presa', '2026-10-25')]; // el 25 sin ventas
    const { rows, generalExpenses } = computeBranchComparison({ branches, transactions, sessionSummaries });
    const uni = rows.find(r => r.branchId === 'uni');
    const presa = rows.find(r => r.branchId === 'presa');
    assert.equal(generalExpenses, 1000);
    assert.equal(uni.workedDays, 3);
    assert.equal(uni.typicalDay, 1500); // mediana: 1500 (el día de 6000 no la distorsiona)
    assert.equal(uni.bestDay, 6000);
    assert.equal(uni.worstDay, 1500);
    assert.equal(uni.ticketsPerDay, 1.3);
    assert.equal(uni.profit, 8700); // 9000 − 300 propios
    assert.equal(presa.workedDays, 2);
    assert.equal(presa.daysWithoutSales, 1);
    assert.equal(presa.typicalDay, 1000); // mediana de 2000 y 0
    assert.equal(presa.bestDaypart.label, 'Noche');
    assert.equal(uni.bestDaypart.label, 'Comida');
});

test('pedidos por hora solo con 3+ jornadas completas', () => {
    const summaries = [
        session('uni', 'a', { ticketCount: 20, durationMinutes: 240 }),
        session('uni', 'b', { ticketCount: 10, durationMinutes: 120 }),
        session('uni', 'c', { ticketCount: 30, durationMinutes: 360, openSource: 'auto-first-sale' }) // no cuenta
    ];
    let { rows } = computeBranchComparison({ branches, transactions: [sale('uni', 100)], sessionSummaries: summaries });
    assert.equal(rows[0].ordersPerHour, null);
    assert.equal(rows[0].incompleteSessions, 1);
    ({ rows } = computeBranchComparison({ branches, transactions: [sale('uni', 100)], sessionSummaries: [...summaries, session('uni', 'd', { ticketCount: 12, durationMinutes: 240 })] }));
    assert.equal(rows[0].ordersPerHour, 4.2); // 42 pedidos / 10 h
});

test('cambio por día comparando solo los mismos días de la semana', () => {
    const transactions = [sale('uni', 2000, '2026-10-24T13:00:00')]; // sábado
    const previousTransactions = [sale('uni', 1000, '2026-10-17T13:00:00'), sale('uni', 9000, '2026-10-14T13:00:00')]; // sábado y miércoles
    const { rows } = computeBranchComparison({ branches, transactions, previousTransactions });
    assert.equal(rows[0].previousPerDay, 1000); // solo el sábado anterior
    assert.equal(rows[0].change, 1);
});

test('ventas sin hora no entran en franjas y se marcan como datos incompletos', () => {
    const { rows } = computeBranchComparison({ branches, transactions: [sale('uni', 100, '2026-10-20T13:00:00', { timeEstimated: true }), sale('presa', 50)] });
    const uni = rows.find(r => r.branchId === 'uni');
    assert.equal(uni.estimatedTimeSales, 1);
    assert.equal(uni.bestDaypart, null);
    const insights = generateBranchInsights({ rows });
    assert.ok(insights.some(i => i.text.startsWith('Datos incompletos en Universidad')));
});

test('sucursal de eventos se mide por evento', () => {
    const eventBranches = [...branches, { id: 'ev', name: 'Eventos', isEvent: true }];
    const comparison = computeBranchComparison({ branches: eventBranches, transactions: [sale('ev', 3000, '2026-10-10T18:00:00'), sale('ev', 5000, '2026-10-17T18:00:00'), sale('uni', 100)] });
    const ev = comparison.rows.find(r => r.branchId === 'ev');
    assert.equal(ev.isEvent, true);
    assert.equal(ev.workedDays, 2);
    assert.ok(generateBranchInsights(comparison).some(i => i.text.startsWith('Eventos: 2 eventos')));
});

test('ventas viejas con zona en vez de branchId cuentan para su sucursal', () => {
    const { rows } = computeBranchComparison({ branches, transactions: [{ type: 'income', zone: 'La Presa', amount: 100, date: '2026-10-26' }] });
    assert.equal(rows[0].branchId, 'presa');
});
