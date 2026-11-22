import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisExport, analysisToCSV, splitTicketAmount, mondayWeekday, analysisInputFromBackup, CSV_COLUMNS } from '../js/analytics/analysis-export.js';

const branches = [{ id: 'b_uni', name: 'Universidad' }];
const transactions = [
    { id: 't1', type: 'income', amount: 125, branchId: 'b_uni', sessionId: 's1', soldAt: '2026-11-17T13:05:00', paymentMethod: 'card', cardFee: 5.08,
        itemsSoldArray: [{ productId: 'p1', name: 'Hamburguesa con papas', qty: 1, price: 80, modifierText: 'Res' }, { productId: 'p2', name: 'Burrito', qty: 1, price: 45 }] },
    { id: 't2', type: 'income', amount: 45, branchId: 'b_uni', date: '2026-11-17T12:00:00', timeEstimated: true, itemsSoldArray: [{ name: 'Burrito', qty: 1, price: 45 }] },
    { id: 'g1', type: 'expense', amount: 300, desc: 'Gas, tanque', date: '2026-11-17T09:00:00' },
    { id: 'g2', type: 'expense', amount: 50, branchId: 'b_uni', desc: 'Hielo', date: '2026-11-17T10:00:00' }
];
const sessions = [{ id: 's1', branchId: 'b_uni', dateKey: '2026-11-17', status: 'closed', openedAt: '2026-11-17T12:00:00', closedAt: '2026-11-17T16:00:00',
    summary: { durationMinutes: 240, totals: { wasteCost: 30 }, items: [{ name: 'Burrito', unit: 'pza', loaded: 20, sold: 18, leftover: 2, soldOutAt: null, minutesToSellOut: null, wasteCost: 30 }] } }];

test('día de la semana con lunes = 0 y reparto del ticket', () => {
    assert.equal(mondayWeekday('2026-11-16'), 0);
    assert.equal(mondayWeekday('2026-11-22'), 6);
    assert.deepEqual(splitTicketAmount(125, [{ price: 80, qty: 1 }, { price: 45, qty: 1 }]), [80, 45]);
    assert.deepEqual(splitTicketAmount(100, [{ qty: 1 }, { qty: 3 }]), [25, 75]);
});

test('una fila por producto vendido, gastos y días', () => {
    const out = buildAnalysisExport({ transactions, branches, sessions, generatedAt: new Date('2026-11-21T12:00:00') });
    assert.equal(out.formato, 'labarra-analisis');
    assert.equal(out.ventas.length, 3);
    const burger = out.ventas.find(row => row.producto_id === 'p1');
    assert.equal(burger.sucursal, 'Universidad');
    assert.equal(burger.hora, '13:05');
    assert.equal(burger.opciones, 'Res');
    assert.equal(burger.metodo_pago, 'card');
    assert.equal(burger.dia_semana, 1);
    const estimated = out.ventas.find(row => row.ticket_id === 't2');
    assert.equal(estimated.hora, '');
    assert.equal(estimated.hora_estimada, 1);
    const day = out.dias.find(row => row.sucursal === 'Universidad');
    assert.equal(day.ingresos, 170);
    assert.equal(day.tickets, 2);
    assert.equal(day.gastos, 50);
    assert.equal(day.minutos_servicio, 240);
    assert.equal(day.costo_sobrante, 30);
    assert.equal(out.dias.find(row => row.sucursal === 'General').gastos, 300);
    assert.equal(out.inventario[0].sobrante, 2);
});

test('CSV plano con encabezado fijo y comillas', () => {
    const csv = analysisToCSV(buildAnalysisExport({ transactions, branches, sessions }));
    const lines = csv.replace('﻿', '').trim().split('\n');
    assert.equal(lines[0], CSV_COLUMNS.join(','));
    assert.equal(lines.length, 1 + 3 + 2);
    assert.ok(csv.includes('"Gas, tanque"'));
});

test('lee el respaldo de Firebase o, sin conexión, el local', () => {
    const fromFirebase = analysisInputFromBackup({ collections: { transactions: [{ id: 'x', data: { type: 'income' } }] } });
    assert.equal(fromFirebase.transactions[0].id, 'x');
    const local = analysisInputFromBackup({ collections: {}, localStorage: { transactions: [{ id: 'y' }], branches: branches } });
    assert.equal(local.transactions[0].id, 'y');
    assert.equal(local.branches.length, 1);
});
