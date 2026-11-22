import { CALENDAR_RANGE, CALENDAR_FLAGS, BRANCH_RULES } from './sales-calendar-data.js';

// Calendario de ventas: clases UG, puentes, quincena y eventos (datos generados por
// second-brain/herramientas/ventas/analizar_ventas.py). Funciones puras, sin red.
// Los factores por sucursal solo vienen llenos si la validación con datos pasados mostró que mejoran.

export const DEFAULT_CALENDAR_DATA = { range: CALENDAR_RANGE, flags: CALENDAR_FLAGS, rules: BRANCH_RULES };

const FLAG_LETTERS = { classes: 'c', holiday: 'p', afterHoliday: 'd', payday: 'q', event: 'e' };
const NOTE_LABELS = { noClasses: 'Sin clases', holiday: 'Puente', afterHoliday: 'Semana de puente', payday: 'Quincena', event: 'Evento' };
const MIN_FACTOR = 0.4;
const MAX_FACTOR = 1.6;

function weekdayOfKey(dateKey) {
    return new Date(`${dateKey}T12:00:00`).getDay();
}

function slug(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
}

// Banderas del día o null si la fecha queda fuera del calendario conocido
export function getDayFlags(dateKey, data = DEFAULT_CALENDAR_DATA) {
    if (!dateKey || !data?.range || dateKey < data.range.from || dateKey > data.range.to) return null;
    const letters = data.flags?.[dateKey] || '';
    const flags = Object.fromEntries(Object.entries(FLAG_LETTERS).map(([name, letter]) => [name, letters.includes(letter)]));
    const weekday = weekdayOfKey(dateKey);
    flags.noClasses = !flags.classes && weekday >= 1 && weekday <= 5; // solo cuenta entre semana
    return flags;
}

export function findBranchRule(branchId, { branchName = '', data = DEFAULT_CALENDAR_DATA } = {}) {
    const id = slug(branchId);
    const name = slug(branchName);
    return (data?.rules || []).find(rule => rule.match && (id.includes(rule.match) || name === rule.match)) || null;
}

// Multiplicador del día para la sucursal (1 = día normal)
export function calendarFactor(branchId, dateKey, { branchName = '', data = DEFAULT_CALENDAR_DATA } = {}) {
    const flags = getDayFlags(dateKey, data);
    const rule = findBranchRule(branchId, { branchName, data });
    if (!flags || !rule) return 1;
    const factor = Object.entries(rule.factors || {}).reduce((value, [name, mult]) => (flags[name] ? value * mult : value), 1);
    return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
}

// Resumen del día para mostrar: factor, notas cortas y si la sucursal casi nunca vende ese día
export function describeSalesDay(branchId, dateKey, options = {}) {
    const flags = getDayFlags(dateKey, options.data);
    const rule = findBranchRule(branchId, options);
    if (!flags) return { dateKey, factor: 1, notes: [], likelyClosed: false };
    return {
        dateKey,
        factor: calendarFactor(branchId, dateKey, options),
        notes: Object.entries(NOTE_LABELS).filter(([name]) => flags[name]).map(([, label]) => label),
        likelyClosed: Boolean(rule?.closedWithoutClasses && flags.noClasses)
    };
}

// Próxima fecha (desde fromKey, incluida) que cae en ese día de la semana (0 = domingo)
export function nextDateForWeekday(fromKey, weekday) {
    const date = new Date(`${fromKey}T12:00:00`);
    date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Quita el efecto del calendario de cada día pasado y aplica el del día objetivo
export function adjustSamplesForCalendar(rows, branchId, targetKey, options = {}) {
    const target = calendarFactor(branchId, targetKey, options);
    return rows.map(row => {
        const own = row.dateKey ? calendarFactor(branchId, row.dateKey, options) : 1;
        return own === target ? row : { ...row, demand: Math.round((Number(row.demand) || 0) * (target / own) * 10) / 10 };
    });
}
