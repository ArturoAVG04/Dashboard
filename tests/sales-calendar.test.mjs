import test from 'node:test';
import assert from 'node:assert/strict';
import { getDayFlags, findBranchRule, calendarFactor, describeSalesDay, nextDateForWeekday, adjustSamplesForCalendar } from '../js/analytics/sales-calendar.js';
import { buildProductRecommendations, resolveTargetDateKey } from '../js/analytics/forecast.js';

// Calendario de prueba: 2026-11-16 (lunes) puente, 17 (martes) semana de puente, 18 sin clases, 20 quincena
const data = {
    range: { from: '2026-11-01', to: '2026-11-30' },
    flags: { '2026-11-16': 'p', '2026-11-17': 'cd', '2026-11-19': 'c', '2026-11-20': 'cq', '2026-11-26': 'c' },
    rules: [
        { name: 'Universidad', match: 'universidad', factors: { afterHoliday: 0.5 }, closedWithoutClasses: true },
        { name: 'La Presa', match: 'la_presa', factors: { payday: 1.5 }, closedWithoutClasses: false }
    ]
};

test('banderas del día y fuera de rango', () => {
    const flags = getDayFlags('2026-11-18', data);
    assert.equal(flags.classes, false);
    assert.equal(flags.noClasses, true); // miércoles sin clases
    assert.equal(getDayFlags('2026-11-21', data).noClasses, false); // sábado no cuenta
    assert.equal(getDayFlags('2026-12-05', data), null);
});

test('regla por id o nombre de sucursal, sin acentos', () => {
    assert.equal(findBranchRule('branch_0_universidad', { data }).name, 'Universidad');
    assert.equal(findBranchRule('abc', { branchName: 'La Presa', data }).name, 'La Presa');
    assert.equal(findBranchRule('otra', { data }), null);
});

test('factor del día y descripción', () => {
    assert.equal(calendarFactor('universidad', '2026-11-17', { data }), 0.5);
    assert.equal(calendarFactor('universidad', '2026-11-19', { data }), 1);
    assert.equal(calendarFactor('la_presa', '2026-11-20', { data }), 1.5);
    assert.equal(calendarFactor('desconocida', '2026-11-20', { data }), 1);
    const day = describeSalesDay('universidad', '2026-11-18', { data });
    assert.equal(day.likelyClosed, true);
    assert.deepEqual(day.notes, ['Sin clases']);
    assert.equal(describeSalesDay('la_presa', '2026-11-18', { data }).likelyClosed, false);
});

test('próxima fecha de un día de la semana', () => {
    assert.equal(nextDateForWeekday('2026-11-21', 6), '2026-11-21'); // sábado → hoy
    assert.equal(nextDateForWeekday('2026-11-21', 1), '2026-11-23');
    assert.equal(resolveTargetDateKey(2, { beforeDateKey: '2026-11-21' }), '2026-11-24');
    assert.equal(resolveTargetDateKey(2, { targetDateKey: '2026-11-17' }), '2026-11-17');
});

test('ajusta muestras: quita el efecto del día pasado y aplica el del objetivo', () => {
    const rows = [{ dateKey: '2026-11-17', demand: 5 }, { dateKey: '2026-11-19', demand: 10 }];
    const toNormal = adjustSamplesForCalendar(rows, 'universidad', '2026-11-26', { data });
    assert.deepEqual(toNormal.map(row => row.demand), [10, 10]);
    const toHoliday = adjustSamplesForCalendar(rows, 'universidad', '2026-11-17', { data });
    assert.deepEqual(toHoliday.map(row => row.demand), [5, 5]);
});

test('recomendación por producto usa el calendario y lo reporta', () => {
    const mk = (dateKey) => ({ id: `ses_${dateKey}`, branchId: 'universidad', dateKey, status: 'closed', summary: {} });
    const sessions = ['2026-11-03', '2026-11-10', '2026-11-17'].map(mk);
    const txs = sessions.map(session => ({ type: 'income', sessionId: session.id, amount: 100, soldAt: `${session.dateKey}T13:00:00`,
        itemsSoldArray: [{ productId: 'b', name: 'Burrito', qty: session.dateKey === '2026-11-17' ? 5 : 10, price: 45 }] }));
    const [rec] = buildProductRecommendations(sessions, txs, 'universidad', 2, { targetDateKey: '2026-11-24', calendarOptions: { data } });
    assert.equal(rec.base, 10); // el martes de semana de puente (5) cuenta como 10
    assert.equal(rec.calendar.factor, 1);
    const [same] = buildProductRecommendations(sessions, txs, 'universidad', 2, { targetDateKey: '2026-11-24', calendarOptions: { data: { ...data, rules: [] } } });
    assert.ok(same.base < 10); // sin factores, igual que antes
});
