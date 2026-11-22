import { getSaleTimestamp, getLocalDateInputValue } from '../core/date-utils.js';
import { getPaymentMethod, getTransactionCardFee } from '../models/Payment.js';

// Exportación "para análisis": tablas planas listas para Excel, Python o una IA.
// Una fila por producto vendido (ventas), una por gasto y una por día y sucursal (dias).
// La lee second-brain/herramientas/ventas/analizar_ventas.py. No incluye datos de clientes.

export const ANALYSIS_FORMAT = 'labarra-analisis';
export const ANALYSIS_VERSION = 1;
export const CSV_COLUMNS = ['tipo', 'fecha', 'hora', 'hora_estimada', 'dia_semana', 'sucursal', 'sucursal_id', 'ticket_id',
    'jornada_id', 'producto', 'producto_id', 'opciones', 'cantidad', 'precio_unitario', 'importe', 'metodo_pago',
    'comision_tarjeta', 'origen', 'categoria', 'descripcion'];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const pad = (value) => String(value).padStart(2, '0');

// 0 = lunes … 6 = domingo (igual que calendario.csv y pandas)
export function mondayWeekday(dateKey) {
    return (new Date(`${dateKey}T12:00:00`).getDay() + 6) % 7;
}

function branchNamer(branches) {
    const names = new Map((branches || []).map(branch => [branch.id, branch.name]));
    return (tx) => {
        const id = tx.branchId || tx.branch || '';
        return { id: id || '', name: names.get(id) || tx.zone || id || '' };
    };
}

function timeParts(tx) {
    const { date, estimated } = getSaleTimestamp(tx);
    if (!date || isNaN(date.getTime())) return null;
    return { fecha: getLocalDateInputValue(date), hora: estimated ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`, estimada: estimated ? 1 : 0 };
}

// Reparte el cobro del ticket entre sus productos según precio × cantidad (así la suma cuadra con lo cobrado)
export function splitTicketAmount(amount, items) {
    const weights = items.map(item => (Number(item.price) || 0) * (Number(item.qty) || 1) || (Number(item.qty) || 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => round2(total > 0 ? (Number(amount) || 0) * weight / total : 0));
}

export function saleRows(tx, branchOf) {
    const when = timeParts(tx);
    if (!when) return [];
    const branch = branchOf(tx);
    const items = Array.isArray(tx.itemsSoldArray) && tx.itemsSoldArray.length > 0 ? tx.itemsSoldArray : [{ name: tx.desc || 'Venta', qty: 1, price: tx.amount }];
    const amounts = splitTicketAmount(tx.amount, items);
    const fee = getTransactionCardFee(tx);
    return items.map((item, index) => ({
        tipo: 'venta', fecha: when.fecha, hora: when.hora, hora_estimada: when.estimada, dia_semana: mondayWeekday(when.fecha),
        sucursal: branch.name, sucursal_id: branch.id, ticket_id: tx.id || '', jornada_id: tx.sessionId || '',
        producto: item.rawName || item.name || 'Sin nombre', producto_id: item.productId || '', opciones: item.modifierText || '',
        cantidad: Number(item.qty) || 1, precio_unitario: round2(item.price), importe: amounts[index],
        metodo_pago: getPaymentMethod(tx), comision_tarjeta: round2(fee * (amounts[index] / (Number(tx.amount) || 1))),
        origen: tx.source || 'sale'
    }));
}

export function expenseRow(tx, branchOf) {
    const when = timeParts(tx);
    if (!when) return null;
    const branch = branchOf(tx);
    return { tipo: 'gasto', fecha: when.fecha, hora: when.hora, dia_semana: mondayWeekday(when.fecha), sucursal: branch.name,
        sucursal_id: branch.id, importe: round2(tx.amount), categoria: tx.category || '', descripcion: tx.desc || '' };
}

function sessionInfo(sessions, branchOf) {
    const byKey = new Map();
    (sessions || []).forEach(session => {
        const branch = branchOf({ branchId: session.branchId });
        const summary = session.summary || {};
        byKey.set(`${session.dateKey}|${branch.name}`, {
            minutos_servicio: summary.durationMinutes ?? null, hora_apertura: session.openedAt || '', hora_cierre: session.closedAt || '',
            costo_sobrante: summary.totals?.wasteCost ?? null, articulos_agotados: (summary.items || []).filter(item => item.soldOutAt).length
        });
    });
    return byKey;
}

// Una fila por día y sucursal con venta, gasto o jornada
export function buildDayRows(sales, expenses, sessions, branchOf) {
    const days = new Map();
    const get = (fecha, sucursal, sucursal_id) => {
        const key = `${fecha}|${sucursal}`;
        if (!days.has(key)) days.set(key, { fecha, dia_semana: mondayWeekday(fecha), sucursal, sucursal_id, ingresos: 0, tickets: new Set(), unidades: 0, gastos: 0, comision_tarjeta: 0 });
        return days.get(key);
    };
    sales.forEach(row => {
        const day = get(row.fecha, row.sucursal, row.sucursal_id);
        day.ingresos += row.importe;
        day.unidades += row.cantidad;
        day.comision_tarjeta += row.comision_tarjeta;
        day.tickets.add(row.ticket_id);
    });
    expenses.forEach(row => { get(row.fecha, row.sucursal || 'General', row.sucursal_id).gastos += row.importe; });
    const info = sessionInfo(sessions, branchOf);
    info.forEach((value, key) => { const [fecha, sucursal] = key.split('|'); get(fecha, sucursal, ''); });
    return [...days.entries()].map(([key, day]) => ({
        ...day, tickets: day.tickets.size, ingresos: round2(day.ingresos), gastos: round2(day.gastos), comision_tarjeta: round2(day.comision_tarjeta),
        utilidad: round2(day.ingresos - day.gastos - day.comision_tarjeta),
        minutos_servicio: null, hora_apertura: '', hora_cierre: '', costo_sobrante: null, articulos_agotados: null, ...(info.get(key) || {})
    })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sucursal.localeCompare(b.sucursal));
}

export function buildInventoryRows(sessions, branchOf) {
    return (sessions || []).filter(session => session.summary?.items).flatMap(session => session.summary.items.map(item => ({
        fecha: session.dateKey, sucursal: branchOf({ branchId: session.branchId }).name, articulo: item.name, unidad: item.unit || 'pza',
        llevado: item.loaded, vendido: item.sold, sobrante: item.leftover, contado: item.counted ?? null,
        minutos_para_agotarse: item.minutesToSellOut ?? null, costo_sobrante: item.wasteCost ?? null
    })));
}

export function buildAnalysisExport({ transactions = [], branches = [], sessions = [], generatedAt = new Date() } = {}) {
    const branchOf = branchNamer(branches);
    const ventas = transactions.filter(tx => tx.type === 'income').flatMap(tx => saleRows(tx, branchOf));
    const gastos = transactions.filter(tx => tx.type !== 'income').map(tx => expenseRow(tx, branchOf)).filter(Boolean);
    const closed = sessions.filter(session => session.status === 'closed');
    return {
        formato: ANALYSIS_FORMAT, version: ANALYSIS_VERSION, generado: generatedAt.toISOString(), zona_horaria: 'America/Mexico_City',
        notas: 'importe = cobro repartido entre productos; dia_semana 0 = lunes; utilidad = ingresos - gastos de la sucursal - comisión de tarjeta',
        sucursales: branches.map(branch => ({ id: branch.id, nombre: branch.name })),
        ventas: ventas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora)),
        gastos: gastos.sort((a, b) => a.fecha.localeCompare(b.fecha)),
        dias: buildDayRows(ventas, gastos, closed, branchOf),
        inventario: buildInventoryRows(closed, branchOf)
    };
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// CSV plano (ventas + gastos, columna "tipo") para abrir en Excel
export function analysisToCSV(analysis) {
    const rows = [...analysis.ventas, ...analysis.gastos].sort((a, b) => a.fecha.localeCompare(b.fecha));
    return '﻿' + [CSV_COLUMNS.join(','), ...rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(','))].join('\n') + '\n';
}

// Del respaldo completo a listas simples (Firebase o, sin conexión, lo guardado en el dispositivo)
export function analysisInputFromBackup(backup) {
    const fromCollection = (name) => (backup?.collections?.[name] || []).map(entry => ({ id: entry.id, ...(entry.data || {}) }));
    const local = backup?.localStorage || {};
    const pick = (name, localKey) => {
        const list = fromCollection(name);
        return list.length > 0 ? list : (Array.isArray(local[localKey]) ? local[localKey] : []);
    };
    return { transactions: pick('transactions', 'transactions'), branches: pick('dashboard_branches', 'branches'), sessions: pick('daily_sessions', 'sessions') };
}
