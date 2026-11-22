import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultExpenseBranch, expenseGroupNameForTag } from '../js/models/ExpenseDefaults.js';
import { buildAnalysisExport, CSV_COLUMNS } from '../js/analytics/analysis-export.js';

const branches = [{ id: 'u', name: 'Universidad' }, { id: 'p', name: 'La Presa' }];
const open = (branchId, dateKey = '2026-11-22') => ({ branchId, dateKey, status: 'open' });

test('sucursal por defecto: la única jornada abierta hoy', () => {
    assert.equal(pickDefaultExpenseBranch({ sessions: [open('p')], todayKey: '2026-11-22', branches, lastBranchId: 'u' }), 'p');
});

test('sucursal por defecto: sin jornada o con varias usa la última usada', () => {
    const base = { todayKey: '2026-11-22', branches, lastBranchId: 'u' };
    assert.equal(pickDefaultExpenseBranch({ ...base, sessions: [] }), 'u');
    assert.equal(pickDefaultExpenseBranch({ ...base, sessions: [open('u'), open('p')] }), 'u');
    assert.equal(pickDefaultExpenseBranch({ ...base, sessions: [open('p', '2026-11-21')] }), 'u');
    assert.equal(pickDefaultExpenseBranch({ ...base, sessions: [], lastBranchId: 'borrada' }), '');
});

test('grupo del atajo', () => {
    const tags = [{ name: 'Pan', groupId: 'g1' }, { name: 'Otro', groupId: '' }, { name: 'Raro', groupId: 'x' }];
    const groups = [{ id: 'g1', name: 'Insumos' }];
    assert.equal(expenseGroupNameForTag('Pan', tags, groups), 'Insumos');
    assert.equal(expenseGroupNameForTag('Otro', tags, groups), '');
    assert.equal(expenseGroupNameForTag('Raro', tags, groups), '');
    assert.equal(expenseGroupNameForTag('Nada', tags, groups), '');
});

test('categoria_gasto en la exportación', () => {
    const tx = { type: 'expense', amount: 50, desc: 'Pan', date: '2026-11-20T18:00:00Z', expenseGroup: 'Insumos' };
    const out = buildAnalysisExport({ transactions: [tx, { ...tx, expenseGroup: undefined }] });
    assert.deepEqual(out.gastos.map(g => g.categoria_gasto), ['Insumos', '']);
    assert.ok(CSV_COLUMNS.includes('categoria_gasto'));
});
