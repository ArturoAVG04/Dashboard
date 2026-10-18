import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getLocalTimeInputValue,
    combineLocalDateAndTime,
    getSaleTimestamp,
    formatTimeDisplay
} from '../js/core/date-utils.js';

test('combineLocalDateAndTime arma fecha y hora local', () => {
    const date = combineLocalDateAndTime('2026-10-14', '13:45');
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9);
    assert.equal(date.getDate(), 14);
    assert.equal(date.getHours(), 13);
    assert.equal(date.getMinutes(), 45);
    assert.equal(date.getSeconds(), 0);
});

test('combineLocalDateAndTime sin hora devuelve null', () => {
    assert.equal(combineLocalDateAndTime('2026-10-14', ''), null);
    assert.equal(combineLocalDateAndTime('2026-10-14', 'xx'), null);
});

test('getLocalTimeInputValue usa formato HH:MM', () => {
    assert.equal(getLocalTimeInputValue(new Date(2026, 9, 14, 7, 5)), '07:05');
});

test('getSaleTimestamp prioriza soldAt', () => {
    const soldAt = new Date(2026, 9, 14, 12, 30).toISOString();
    const result = getSaleTimestamp({ soldAt, date: new Date(2026, 9, 14, 18).toISOString(), createdAt: new Date(2026, 9, 15).toISOString() });
    assert.equal(result.estimated, false);
    assert.equal(result.date.toISOString(), soldAt);
});

test('venta vieja del mismo día usa createdAt como hora real', () => {
    const createdAt = new Date(2026, 9, 14, 15, 10).toISOString();
    const result = getSaleTimestamp({ date: new Date(2026, 9, 14, 15, 10, 2).toISOString(), createdAt });
    assert.equal(result.estimated, false);
    assert.equal(result.date.toISOString(), createdAt);
});

test('venta vieja registrada otro día queda como hora estimada', () => {
    const result = getSaleTimestamp({ date: new Date(2026, 9, 10, 20).toISOString(), createdAt: new Date(2026, 9, 14, 9).toISOString() });
    assert.equal(result.estimated, true);
    assert.equal(result.date.getDate(), 10);
});

test('timeEstimated explícito se respeta', () => {
    const result = getSaleTimestamp({ timeEstimated: true, date: new Date(2026, 9, 10, 20).toISOString(), createdAt: new Date(2026, 9, 10, 20).toISOString() });
    assert.equal(result.estimated, true);
});

test('sin fechas no truena', () => {
    const result = getSaleTimestamp({});
    assert.equal(result.date, null);
    assert.equal(formatTimeDisplay(result.date), '');
});

test('formatTimeDisplay en 24 horas', () => {
    assert.equal(formatTimeDisplay(new Date(2026, 9, 14, 16, 5)), '16:05');
});
