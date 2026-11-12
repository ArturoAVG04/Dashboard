// Método de pago de las ventas y comisión de la terminal (funciones puras, sin Firebase).
// La terminal cobra 3.5% + impuestos: en la práctica quita $4.06 por cada $100 (4.06%).

export const CARD_FEE_RATE = 0.0406;
export const PAYMENT_METHODS = ['cash', 'card'];
export const PAYMENT_LABELS = { cash: 'Efectivo', card: 'Tarjeta' };

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

export function normalizePaymentMethod(value) {
    return value === 'card' ? 'card' : 'cash';
}

// Ventas viejas sin el campo se toman como efectivo (no se modifica el dato guardado)
export function getPaymentMethod(tx) {
    return normalizePaymentMethod(tx?.paymentMethod);
}

export function hasPaymentMethod(tx) {
    return tx?.paymentMethod === 'cash' || tx?.paymentMethod === 'card';
}

export function computeCardFee(amount, rate = CARD_FEE_RATE) {
    const value = Number(amount) || 0;
    return value > 0 ? round2(value * rate) : 0;
}

// Comisión de una venta: la guardada en la venta (snapshot) o, si es tarjeta sin dato, la calculada
export function getTransactionCardFee(tx) {
    if (getPaymentMethod(tx) !== 'card') return 0;
    if (typeof tx.cardFee === 'number' && Number.isFinite(tx.cardFee)) return tx.cardFee;
    return computeCardFee(tx.amount);
}

// Campos que se guardan en la venta
export function paymentFields(method, amount) {
    const paymentMethod = normalizePaymentMethod(method);
    return paymentMethod === 'card'
        ? { paymentMethod, cardFee: computeCardFee(amount), cardFeeRate: CARD_FEE_RATE }
        : { paymentMethod, cardFee: 0 };
}

// Totales por método de pago de una lista de ventas (ignora gastos)
export function summarizePayments(transactions) {
    const result = { cash: 0, card: 0, cardFee: 0, cashCount: 0, cardCount: 0 };
    (transactions || []).forEach(tx => {
        if (!tx || tx.type !== 'income') return;
        const amount = Number(tx.amount) || 0;
        if (getPaymentMethod(tx) === 'card') {
            result.card += amount;
            result.cardFee += getTransactionCardFee(tx);
            result.cardCount += 1;
        } else {
            result.cash += amount;
            result.cashCount += 1;
        }
    });
    result.cash = round2(result.cash);
    result.card = round2(result.card);
    result.cardFee = round2(result.cardFee);
    result.cardNet = round2(result.card - result.cardFee);
    return result;
}

// Efectivo que debe haber en caja al corte: cambio que se dejó + ventas en efectivo
export function computeExpectedCash(cashFloat, cashSales) {
    return round2((Number(cashFloat) || 0) + (Number(cashSales) || 0));
}
