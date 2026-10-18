import test from 'node:test';
import assert from 'node:assert/strict';
import {
    UNGROUPED_ID,
    normalizeExpenseGroups,
    groupExpenseTags,
    filterExpenseTags,
    getFrequentExpenseTags,
    getLastExpenseAmounts,
    getLastExpenseAmount,
    getExpenseStatsByGroup
} from '../js/models/ExpenseTag.js';

const groups = normalizeExpenseGroups([
    { id: 'g_bebidas', name: 'Bebidas', order: 1 },
    { id: 'g_carnes', name: 'Carnes', order: 0 }
]);
const tags = [
    { id: 't1', name: 'Refresco', groupId: 'g_bebidas' },
    { id: 't2', name: 'Carne molida', groupId: 'g_carnes' },
    { id: 't3', name: 'Agua', groupId: 'g_bebidas' },
    { id: 't4', name: 'Gas', groupId: '' },
    { id: 't5', name: 'Pan', groupId: 'g_borrado' }
];
const now = new Date(2026, 9, 16, 12);
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const expense = (desc, amount, days) => ({ type: 'expense', desc, amount, date: daysAgo(days) });

test('grupos se ordenan por order', () => {
    assert.deepEqual(groups.map(g => g.name), ['Carnes', 'Bebidas']);
});

test('groupExpenseTags respeta el orden de grupos, ordena alfabético dentro y deja Sin grupo al final', () => {
    const sections = groupExpenseTags(tags, groups);
    assert.deepEqual(sections.map(s => s.group.name), ['Carnes', 'Bebidas', 'Sin grupo']);
    assert.deepEqual(sections[1].tags.map(t => t.name), ['Agua', 'Refresco']);
    // grupo inexistente cae en Sin grupo
    assert.deepEqual(sections[2].tags.map(t => t.name), ['Gas', 'Pan']);
    assert.equal(sections[2].group.id, UNGROUPED_ID);
});

test('sin grupos todo queda en Sin grupo', () => {
    const sections = groupExpenseTags(tags, []);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].tags.length, 5);
});

test('filterExpenseTags ignora acentos y mayúsculas', () => {
    const result = filterExpenseTags([{ name: 'Plátano' }, { name: 'Pan' }], 'PLATA');
    assert.deepEqual(result.map(t => t.name), ['Plátano']);
});

test('frecuentes: cuenta solo últimos 30 días y gastos', () => {
    const transactions = [
        expense('Refresco', 100, 1), expense('refresco', 120, 2), expense('Refresco', 90, 3),
        expense('Gas', 400, 5),
        expense('Carne molida', 300, 40), expense('Carne molida', 300, 41), expense('Carne molida', 300, 42),
        { type: 'income', desc: 'Agua', amount: 20, date: daysAgo(1) }
    ];
    const result = getFrequentExpenseTags(tags, transactions, { now });
    assert.deepEqual(result.map(t => t.name), ['Refresco', 'Gas']);
});

test('frecuentes respeta el límite', () => {
    const transactions = tags.map((t, i) => expense(t.name, 10, i));
    assert.equal(getFrequentExpenseTags(tags, transactions, { now, limit: 2 }).length, 2);
});

test('último monto pagado es el más reciente', () => {
    const last = getLastExpenseAmounts([expense('Gas', 400, 10), expense('gas', 450, 2), expense('Gas', 380, 5), expense('Gas', 0, 1)]);
    assert.equal(getLastExpenseAmount(last, 'GAS').amount, 450);
    assert.equal(getLastExpenseAmount(last, 'Pan'), null);
});

test('estadísticas por grupo suman bien y agrupan conceptos', () => {
    const transactions = [expense('Refresco', 100, 1), expense('Agua', 50, 1), expense('Refresco', 70, 2), expense('Carne molida', 500, 1), expense('Taxi', 80, 1)];
    const sections = getExpenseStatsByGroup(transactions, tags, groups);
    const byName = Object.fromEntries(sections.map(s => [s.group.name, s]));
    assert.equal(byName.Bebidas.total, 220);
    assert.equal(byName.Bebidas.count, 3);
    assert.deepEqual(byName.Bebidas.concepts.map(c => [c.label, c.total]), [['Refresco', 170], ['Agua', 50]]);
    assert.equal(byName.Carnes.total, 500);
    assert.equal(byName['Sin grupo'].total, 80);
    assert.equal(sections[0].group.name, 'Carnes');
});
