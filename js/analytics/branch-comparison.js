// Comparativa de sucursales (F8). Funciones puras: sin Firebase ni DOM.

const round2 = (value) => Math.round(value * 100) / 100;

// Rango del periodo elegido en Principal y el periodo anterior de la misma duración
export function getPeriodRange(filter, now = new Date(), customStart = null, customEnd = null) {
    const day = (y, m, d) => new Date(y, m, d, 0, 0, 0, 0);
    const endOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    if (filter === 'all') return { start: null, end: null, previous: null };
    if (filter === 'day') {
        return { start: day(y, m, d), end: endOf(now), previous: { start: day(y, m, d - 1), end: endOf(day(y, m, d - 1)) } };
    }
    if (filter === 'week') {
        const offset = (now.getDay() || 7) - 1;
        const start = day(y, m, d - offset);
        return {
            start,
            end: endOf(day(y, m, d - offset + 6)),
            previous: { start: day(y, m, d - offset - 7), end: endOf(day(y, m, d - offset - 1)) }
        };
    }
    if (filter === 'month') {
        return { start: day(y, m, 1), end: endOf(day(y, m + 1, 0)), previous: { start: day(y, m - 1, 1), end: endOf(day(y, m, 0)) } };
    }
    if (filter === 'year') {
        return { start: day(y, 0, 1), end: endOf(day(y, 11, 31)), previous: { start: day(y - 1, 0, 1), end: endOf(day(y - 1, 11, 31)) } };
    }
    if (filter === 'custom' && customStart && customEnd) {
        const start = day(customStart.getFullYear(), customStart.getMonth(), customStart.getDate());
        const end = endOf(customEnd);
        const days = Math.round((day(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate()) - start) / 86400000) + 1;
        const previousEnd = endOf(day(start.getFullYear(), start.getMonth(), start.getDate() - 1));
        const previousStart = day(start.getFullYear(), start.getMonth(), start.getDate() - days);
        return { start, end, previous: { start: previousStart, end: previousEnd } };
    }
    return { start: null, end: null, previous: null };
}

export function isInRange(transaction, range) {
    if (!range || (!range.start && !range.end)) return true;
    const date = new Date(transaction?.date || transaction?.createdAt || 0);
    if (isNaN(date.getTime())) return false;
    return (!range.start || date >= range.start) && (!range.end || date <= range.end);
}

export function transactionBranchId(transaction, branches) {
    if (transaction?.branchId && branches.some(branch => branch.id === transaction.branchId)) return transaction.branchId;
    if (transaction?.branch && branches.some(branch => branch.id === transaction.branch)) return transaction.branch;
    if (transaction?.zone) return branches.find(branch => branch.name === transaction.zone)?.id || null;
    return null;
}

function localDateKey(value) {
    const date = new Date(value || 0);
    if (isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Días del horario de la sucursal dentro del rango (sin pasar de hoy)
function countScheduledDays(schedule, range, now) {
    if (!schedule || !range?.start || Object.keys(schedule).length === 0) return null;
    const end = range.end && range.end < now ? range.end : now;
    let count = 0;
    for (let day = new Date(range.start); day <= end; day.setDate(day.getDate() + 1)) {
        if (schedule[String(day.getDay())]) count += 1;
    }
    return count;
}

// Franjas del día para analizar a qué hora rinde cada sucursal
export const DAYPARTS = [
    { key: 'morning', label: 'Mañana', from: 0, to: 12 },
    { key: 'lunch', label: 'Comida', from: 12, to: 16 },
    { key: 'afternoon', label: 'Tarde', from: 16, to: 19 },
    { key: 'night', label: 'Noche', from: 19, to: 24 }
];

const MIN_SESSION_MINUTES = 30;
const MIN_COMPLETE_SESSIONS = 3;

export function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Jornada con horas confiables: cerrada con corte u horario, no abierta sola por la primera venta
// y de al menos 30 minutos. Solo esas cuentan para "pedidos por hora".
export function isCompleteSession(summary) {
    return summary.status === 'closed'
        && summary.openSource !== 'auto-first-sale'
        && summary.closeSource !== 'estimated'
        && (Number(summary.durationMinutes) || 0) >= MIN_SESSION_MINUTES;
}

function saleHour(transaction) {
    if (transaction.timeEstimated) return null;
    const date = new Date(transaction.soldAt || transaction.date || transaction.createdAt || 0);
    return isNaN(date.getTime()) ? null : date.getHours();
}

// Comparativa por sucursal (F8/F8b/F8c).
// - Día trabajado = día con al menos una venta o con jornada registrada (aunque no vendiera).
// - Día típico = mediana de la venta por día trabajado (no la distorsionan días excepcionales).
// - Pedidos por hora: solo con jornadas completas (ver isCompleteSession).
// - Cambio vs periodo anterior: venta por día trabajado, comparando solo los mismos días de la semana.
// - Ganancia = ventas − gastos asignados a la sucursal (los gastos generales aún no se reparten).
// - Sucursales de eventos (branch.isEvent): se miden por evento.
// sessionSummaries: [{ branchId, dateKey, status, openSource, closeSource, durationMinutes, ticketCount, wasteCost }]
export function computeBranchComparison({ branches = [], transactions = [], previousTransactions = null, sessionSummaries = [], range = null, now = new Date(), sortBy = 'perDay' }) {
    const rows = new Map(branches.map(branch => [branch.id, {
        branchId: branch.id,
        name: branch.name,
        isEvent: Boolean(branch.isEvent),
        schedule: branch.sessionsEnabled && !branch.isEvent ? (branch.schedule || null) : null,
        sales: 0,
        tickets: 0,
        ownExpenses: 0,
        wasteCost: 0,
        sessions: 0,
        completeSessions: 0,
        completeMinutes: 0,
        completeTickets: 0,
        incompleteSessions: 0,
        estimatedTimeSales: 0,
        salesByDay: new Map(),
        sessionDays: new Set(),
        dayparts: Object.fromEntries(DAYPARTS.map(part => [part.key, { sales: 0, tickets: 0 }])),
        previousByDay: new Map()
    }]));

    let generalExpenses = 0;
    transactions.forEach(transaction => {
        const amount = Number(transaction.amount) || 0;
        const row = rows.get(transactionBranchId(transaction, branches));
        if (transaction.type === 'income') {
            if (!row) return;
            row.sales += amount;
            row.tickets += 1;
            const key = localDateKey(transaction.date || transaction.createdAt);
            if (key) row.salesByDay.set(key, (row.salesByDay.get(key) || 0) + amount);
            const hour = saleHour(transaction);
            if (hour === null) row.estimatedTimeSales += 1;
            else {
                const part = DAYPARTS.find(entry => hour >= entry.from && hour < entry.to);
                row.dayparts[part.key].sales += amount;
                row.dayparts[part.key].tickets += 1;
            }
        } else if (transaction.type === 'expense') {
            if (row) row.ownExpenses += amount;
            else generalExpenses += amount;
        }
    });

    (previousTransactions || []).forEach(transaction => {
        if (transaction.type !== 'income') return;
        const row = rows.get(transactionBranchId(transaction, branches));
        const key = localDateKey(transaction.date || transaction.createdAt);
        if (row && key) row.previousByDay.set(key, (row.previousByDay.get(key) || 0) + (Number(transaction.amount) || 0));
    });

    sessionSummaries.forEach(summary => {
        const row = rows.get(summary.branchId);
        if (!row) return;
        row.wasteCost += Number(summary.wasteCost) || 0;
        row.sessions += 1;
        if (summary.dateKey) row.sessionDays.add(summary.dateKey);
        if (isCompleteSession(summary)) {
            row.completeSessions += 1;
            row.completeMinutes += Number(summary.durationMinutes) || 0;
            row.completeTickets += Number(summary.ticketCount) || 0;
        } else if (summary.status === 'closed' || summary.openSource === 'auto-first-sale') {
            row.incompleteSessions += 1;
        }
    });

    const weekdayOfKey = (key) => new Date(`${key}T12:00:00`).getDay();
    const totalSales = [...rows.values()].reduce((sum, row) => sum + row.sales, 0);

    const result = [...rows.values()].map(row => {
        const workedKeys = new Set([...row.salesByDay.keys(), ...row.sessionDays]);
        const workedDays = workedKeys.size;
        const dailySales = [...workedKeys].map(key => row.salesByDay.get(key) || 0);
        const daysWithoutSales = [...row.sessionDays].filter(key => !row.salesByDay.has(key)).length;
        const profit = row.sales - row.ownExpenses;

        // Mismos días de la semana en el periodo anterior
        const weekdays = new Set([...workedKeys].map(weekdayOfKey));
        const previousMatching = [...row.previousByDay.entries()].filter(([key]) => weekdays.has(weekdayOfKey(key)));
        const previousPerDay = previousMatching.length > 0 ? previousMatching.reduce((sum, [, value]) => sum + value, 0) / previousMatching.length : null;
        const salesPerDay = workedDays > 0 ? row.sales / workedDays : 0;

        const bestPart = DAYPARTS.reduce((best, part) => (row.dayparts[part.key].sales > (best ? row.dayparts[best.key].sales : 0) ? part : best), null);
        const timedSales = DAYPARTS.reduce((sum, part) => sum + row.dayparts[part.key].sales, 0);

        const { salesByDay, sessionDays, previousByDay, schedule, completeMinutes, completeTickets, ...rest } = row;
        return {
            ...rest,
            sales: round2(row.sales),
            ownExpenses: round2(row.ownExpenses),
            profit: round2(profit),
            salesShare: totalSales > 0 ? round2(row.sales / totalSales) : 0,
            avgTicket: row.tickets > 0 ? round2(row.sales / row.tickets) : 0,
            workedDays,
            daysWithoutSales,
            scheduledDays: countScheduledDays(schedule, range, now),
            salesPerDay: round2(salesPerDay),
            profitPerDay: workedDays > 0 ? round2(profit / workedDays) : 0,
            ticketsPerDay: workedDays > 0 ? Math.round((row.tickets / workedDays) * 10) / 10 : 0,
            typicalDay: dailySales.length > 0 ? round2(median(dailySales)) : null,
            bestDay: dailySales.length > 0 ? round2(Math.max(...dailySales)) : null,
            worstDay: dailySales.length > 0 ? round2(Math.min(...dailySales)) : null,
            ordersPerHour: row.completeSessions >= MIN_COMPLETE_SESSIONS && completeMinutes > 0 ? Math.round((completeTickets / (completeMinutes / 60)) * 10) / 10 : null,
            dayparts: DAYPARTS.map(part => ({
                key: part.key,
                label: part.label,
                sales: round2(row.dayparts[part.key].sales),
                tickets: row.dayparts[part.key].tickets,
                share: timedSales > 0 ? round2(row.dayparts[part.key].sales / timedSales) : 0
            })),
            bestDaypart: bestPart && timedSales > 0 ? { label: bestPart.label, share: round2(row.dayparts[bestPart.key].sales / timedSales) } : null,
            wasteCost: round2(row.wasteCost),
            previousPerDay: previousPerDay !== null ? round2(previousPerDay) : null,
            change: previousPerDay ? round2((salesPerDay - previousPerDay) / previousPerDay) : null
        };
    })
        .filter(row => row.sales > 0 || row.ownExpenses > 0 || row.workedDays > 0)
        .sort((a, b) => (sortBy === 'total' ? (b.profit - a.profit) : (b.profitPerDay - a.profitPerDay)) || b.sales - a.sales)
        .map((row, index) => ({ ...row, rank: index + 1 }));

    return { rows: result, totalSales: round2(totalSales), generalExpenses: round2(generalExpenses), sortBy };
}

export function generateBranchInsights(comparison, { money = (value) => `$${value}` } = {}) {
    const insights = [];
    const rows = comparison.rows.filter(row => row.workedDays > 0);
    if (rows.length === 0) return insights;
    const unit = (row, n) => row.isEvent ? `${n} evento${n === 1 ? '' : 's'}` : `${n} día${n === 1 ? '' : 's'} trabajado${n === 1 ? '' : 's'}`;

    const regular = rows.filter(row => !row.isEvent);
    if (regular.length >= 2) {
        const best = [...regular].sort((a, b) => (b.typicalDay || 0) - (a.typicalDay || 0))[0];
        insights.push({ tone: 'good', text: `${best.name} tiene el mejor día típico: ${money(best.typicalDay)} (${unit(best, best.workedDays)}).` });
        const busiest = [...regular].sort((a, b) => b.workedDays - a.workedDays)[0];
        if (busiest !== best && best.workedDays < busiest.workedDays) {
            insights.push({ tone: 'info', text: `${best.name} trabajó ${best.workedDays} días y ${busiest.name} ${busiest.workedDays}, pero un día típico de ${best.name} vende ${money(best.typicalDay)} contra ${money(busiest.typicalDay)}.` });
        }
    }

    rows.filter(row => row.isEvent).forEach(row => {
        insights.push({ tone: 'info', text: `${row.name}: ${unit(row, row.workedDays)} en el periodo, ${money(row.salesPerDay)} en promedio por evento (ticket ${money(row.avgTicket)}).` });
    });

    // Gente vs gasto: qué explica la diferencia entre sucursales
    if (regular.length >= 2) {
        const moreOrders = [...regular].sort((a, b) => b.ticketsPerDay - a.ticketsPerDay)[0];
        const higherTicket = [...regular].sort((a, b) => b.avgTicket - a.avgTicket)[0];
        if (moreOrders !== higherTicket) {
            insights.push({ tone: 'info', text: `${moreOrders.name} atiende más pedidos por día (${moreOrders.ticketsPerDay}), pero en ${higherTicket.name} cada cliente gasta más (${money(higherTicket.avgTicket)}).` });
        }
    }

    rows.filter(row => row.bestDaypart && row.bestDaypart.share >= 0.4).forEach(row => {
        insights.push({ tone: 'info', text: `En ${row.name} el ${Math.round(row.bestDaypart.share * 100)}% de la venta es en la franja de ${row.bestDaypart.label.toLowerCase()}.` });
    });

    rows.filter(row => row.daysWithoutSales > 0).forEach(row => {
        insights.push({ tone: 'warn', text: `${row.name} abrió ${row.daysWithoutSales} día${row.daysWithoutSales === 1 ? '' : 's'} sin ninguna venta.` });
    });

    rows.filter(row => row.scheduledDays !== null && row.scheduledDays > row.workedDays).forEach(row => {
        insights.push({ tone: 'info', text: `${row.name} trabajó ${row.workedDays} de ${row.scheduledDays} días de su horario.` });
    });

    rows.filter(row => row.change !== null && Math.abs(row.change) >= 0.15).forEach(row => {
        insights.push({ tone: row.change > 0 ? 'good' : 'warn', text: `${row.name} vende ${Math.round(Math.abs(row.change) * 100)}% ${row.change > 0 ? 'más' : 'menos'} por día que en los mismos días del periodo anterior.` });
    });

    rows.filter(row => row.sales > 0 && row.wasteCost / row.sales >= 0.1).forEach(row => {
        insights.push({ tone: 'warn', text: `En ${row.name} la merma fue ${money(row.wasteCost)} (${Math.round((row.wasteCost / row.sales) * 100)}% de lo vendido).` });
    });

    const incomplete = rows.filter(row => row.incompleteSessions > 0 || row.estimatedTimeSales > 0);
    if (incomplete.length > 0) {
        insights.push({ tone: 'warn', text: `Datos incompletos en ${incomplete.map(row => row.name).join(', ')}: hay jornadas abiertas solas o con cierre estimado, o ventas sin hora. Los pedidos por hora y las franjas no las toman en cuenta.` });
    }
    return insights;
}
