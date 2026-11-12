import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCardFee, paymentFields, summarizePayments, getPaymentMethod, computeExpectedCash, getTransactionCardFee } from '../js/models/Payment.js';
import { computeSessionSummary } from '../js/analytics/session-metrics.js';

test('comisión de tarjeta: $4.06 por cada $100', () => {
    assert.equal(computeCardFee(100), 4.06);
    assert.equal(computeCardFee(80), 3.25);
    assert.equal(computeCardFee(0), 0);
});

test('campos de pago que se guardan en la venta', () => {
    assert.deepEqual(paymentFields('cash', 100), { paymentMethod: 'cash', cardFee: 0 });
    assert.equal(paymentFields('card', 250).cardFee, 10.15);
    assert.equal(paymentFields('loquesea', 100).paymentMethod, 'cash');
});

test('ventas viejas sin método se toman como efectivo', () => {
    assert.equal(getPaymentMethod({ type: 'income', amount: 50 }), 'cash');
    assert.equal(getTransactionCardFee({ type: 'income', amount: 100, paymentMethod: 'card' }), 4.06);
});

test('resumen por método de pago ignora gastos', () => {
    const r = summarizePayments([
        { type: 'income', amount: 100, paymentMethod: 'card', cardFee: 4.06 },
        { type: 'income', amount: 50 },
        { type: 'income', amount: 30, paymentMethod: 'cash' },
        { type: 'expense', amount: 999 }
    ]);
    assert.equal(r.cash, 80);
    assert.equal(r.card, 100);
    assert.equal(r.cardFee, 4.06);
    assert.equal(r.cardNet, 95.94);
    assert.equal(computeExpectedCash(500, r.cash), 580);
});

test('el corte calcula el efectivo que debe haber con el cambio', () => {
    const session = { id: 's1', branchId: 'b', openedAt: '2026-11-12T15:00:00.000Z', loads: [], cashFloat: 200 };
    const txs = [
        { type: 'income', amount: 100, sessionId: 's1', soldAt: '2026-11-12T16:00:00.000Z', date: '2026-11-12T16:00:00.000Z', paymentMethod: 'cash' },
        { type: 'income', amount: 100, sessionId: 's1', soldAt: '2026-11-12T16:10:00.000Z', date: '2026-11-12T16:10:00.000Z', paymentMethod: 'card', cardFee: 4.06 }
    ];
    const summary = computeSessionSummary(session, txs, [], { closedAt: '2026-11-12T18:00:00.000Z', cashCount: 290 });
    assert.equal(summary.cash.float, 200);
    assert.equal(summary.cash.expectedCash, 300);
    assert.equal(summary.cash.difference, -10);
    assert.equal(summary.cash.cardFee, 4.06);
});
