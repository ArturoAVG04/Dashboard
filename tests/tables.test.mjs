import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTableName, countTodayTables } from '../js/models/Table.js';

const now = new Date(2026, 9, 26, 18, 0);
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).toISOString();
const open = (name, h) => ({ name, status: 'open', branchId: 'presa', createdAt: at(h) });
const paid = (name, h, branchId = 'presa') => ({ source: 'table', tableName: name, branchId, soldAt: at(h), date: at(h) });

test('la numeración continúa aunque las mesas ya se hayan cobrado', () => {
    const txs = [paid('Mesa 1', 13), paid('Mesa 2', 14), paid('Mesa 3', 15)];
    assert.equal(nextTableName([], txs, 'presa', null, now), 'Mesa 4');
    assert.equal(nextTableName([open('Mesa 4', 16)], txs, 'presa', null, now), 'Mesa 5');
    assert.equal(countTodayTables([open('Mesa 4', 16)], txs, 'presa', null, now), 4);
});

test('cada sucursal lleva su propio conteo y días anteriores no cuentan', () => {
    const yesterday = { source: 'table', tableName: 'Mesa 9', branchId: 'presa', date: new Date(2026, 9, 25, 15).toISOString() };
    assert.equal(nextTableName([], [paid('Mesa 7', 13, 'noria'), yesterday], 'presa', null, now), 'Mesa 1');
});

test('después del corte del día la numeración se reinicia', () => {
    const txs = [paid('Mesa 1', 13), paid('Mesa 2', 14)];
    const cutAt = new Date(2026, 9, 26, 15, 0);
    assert.equal(nextTableName([], txs, 'presa', cutAt, now), 'Mesa 1');
    assert.equal(nextTableName([open('Mesa 1', 16)], [...txs, paid('Mesa 2', 17)], 'presa', cutAt, now), 'Mesa 3');
});
