import { getSessionSales, computeSessionSummary } from './session-metrics.js';

// Métricas semanales y recomendaciones (F6). Todo con reglas y estadística simple, sin IA.

const MAX_DEMAND_MULTIPLIER = 2;   // una estimación nunca supera el doble de lo vendido
const MIN_CURVE_SHARE = 0.25;      // evita dividir entre fracciones muy pequeñas
const SAFETY_K = 0.5;              // margen de seguridad (desviaciones estándar)
const HIGH_WASTE_RATE = 0.3;       // si sobra > 30% en promedio, se quita el margen
const WEEKDAY_MIN_SAMPLES = 3;     // con menos días iguales se usan todos los días

export const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// ---------- Fechas (claves YYYY-MM-DD locales) ----------
export function toDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateFromKey(dateKey) {
    return new Date(`${dateKey}T12:00:00`);
}

export function weekdayOf(dateKey) {
    return dateFromKey(dateKey).getDay();
}

export function addDaysToKey(dateKey, days) {
    const date = dateFromKey(dateKey);
    date.setDate(date.getDate() + days);
    return toDateKey(date);
}

// Semana de lunes a domingo
export function startOfWeekKey(date = new Date()) {
    const day = date.getDay() || 7;
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 1, 12);
    return toDateKey(monday);
}

export function getWeekKeys(weekStartKey) {
    return Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStartKey, index));
}

// ---------- Estadística ----------
// Promedio ponderado: el más reciente pesa más (lista ordenada del más reciente al más viejo)
export function weightedAverage(values) {
    if (!values.length) return 0;
    let total = 0;
    let weights = 0;
    values.forEach((value, index) => {
        const weight = values.length - index;
        total += value * weight;
        weights += weight;
    });
    return total / weights;
}

export function stdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

// ---------- Curva de ventas a lo largo de la jornada ----------
// curve[i] = fracción de la venta del día que normalmente ya ocurrió al i/buckets del tiempo en servicio
export function buildSalesCurve(sessions, transactions, buckets = 10) {
    const curves = [];
    (sessions || []).forEach(session => {
        const openedAt = new Date(session.openedAt).getTime();
        const closedAt = new Date(session.closedAt).getTime();
        const duration = closedAt - openedAt;
        if (!(duration > 0)) return;
        const sales = getSessionSales(session, transactions);
        const total = sales.reduce((sum, { tx }) => sum + (Number(tx.amount) || 0), 0);
        if (total <= 0) return;
        const points = Array.from({ length: buckets + 1 }, (_, bucket) => {
            const limit = bucket / buckets;
            const before = sales
                .filter(({ at }) => clamp01((at.getTime() - openedAt) / duration) <= limit + 1e-9)
                .reduce((sum, { tx }) => sum + (Number(tx.amount) || 0), 0);
            return before / total;
        });
        curves.push(points);
    });
    if (curves.length === 0) return null;
    return Array.from({ length: buckets + 1 }, (_, index) => curves.reduce((sum, curve) => sum + curve[index], 0) / curves.length);
}

export function curveShareAt(curve, fraction) {
    const f = clamp01(fraction);
    if (!curve) return f; // sin historial: ventas parejas durante la jornada
    const position = f * (curve.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(curve.length - 1, lower + 1);
    return curve[lower] + (curve[upper] - curve[lower]) * (position - lower);
}

// Demanda estimada de un artículo en una jornada: si se agotó antes del cierre, lo vendido
// se divide entre la parte de la venta del día que normalmente ocurre hasta esa hora.
export function estimateItemDemand(item, durationMinutes, curve) {
    const sold = Number(item?.sold) || 0;
    if (!item?.soldOutAt || !(item.loaded > 0) || !(durationMinutes > 0) || item.minutesToSellOut === null || item.minutesToSellOut === undefined) {
        return sold;
    }
    const share = curveShareAt(curve, item.minutesToSellOut / durationMinutes);
    if (share >= 0.98) return sold;
    return round1(Math.min(sold / Math.max(share, MIN_CURVE_SHARE), sold * MAX_DEMAND_MULTIPLIER));
}

// ---------- Recomendación de cantidad ----------
// samples: del más reciente al más viejo: [{ demand, loaded, leftover }]
export function recommendQuantity(samples, { k = SAFETY_K } = {}) {
    if (!samples || samples.length === 0) return null;
    const demands = samples.map(sample => Number(sample.demand) || 0);
    const base = weightedAverage(demands);
    const deviation = stdDev(demands);
    const withLoad = samples.filter(sample => sample.loaded > 0);
    const wasteRate = withLoad.length > 0
        ? withLoad.reduce((sum, sample) => sum + clamp01((Number(sample.leftover) || 0) / sample.loaded), 0) / withLoad.length
        : 0;
    const highWaste = withLoad.length >= 2 && wasteRate > HIGH_WASTE_RATE;
    return {
        qty: Math.max(0, Math.ceil(base + (highWaste ? 0 : k * deviation) - 1e-9)),
        base: round1(base),
        deviation: round1(deviation),
        samples: samples.length,
        wasteRate: round2(wasteRate),
        highWaste
    };
}

export function confidenceLevel(samples, basis) {
    if (basis !== 'weekday') return 'baja';
    if (samples >= 4) return 'alta';
    if (samples >= 2) return 'media';
    return 'baja';
}

export function getBranchClosedSessions(sessions, branchId, { beforeDateKey = null } = {}) {
    return (sessions || [])
        .filter(session => session.branchId === branchId && session.status === 'closed' && session.summary
            && (!beforeDateKey || session.dateKey < beforeDateKey))
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

// Recomendación por artículo para un día de la semana
export function buildItemRecommendations(sessions, transactions, branchId, inventoryItems, weekday, { beforeDateKey = null, limit = 8 } = {}) {
    const closed = getBranchClosedSessions(sessions, branchId, { beforeDateKey }).slice(0, 40);
    const curve = buildSalesCurve(closed.slice(0, 12), transactions);

    return (inventoryItems || []).map(item => {
        const rows = closed
            .map(session => {
                const entry = session.summary.items?.find(summaryItem => summaryItem.itemId === item.id && summaryItem.loaded > 0);
                return entry ? {
                    dateKey: session.dateKey,
                    demand: estimateItemDemand(entry, session.summary.durationMinutes, curve),
                    sold: entry.sold,
                    loaded: entry.loaded,
                    leftover: entry.leftover ?? Math.max(0, entry.loaded - entry.sold),
                    soldOut: Boolean(entry.soldOutAt)
                } : null;
            })
            .filter(Boolean);
        const sameDay = rows.filter(row => weekdayOf(row.dateKey) === weekday).slice(0, limit);
        const basis = sameDay.length >= WEEKDAY_MIN_SAMPLES ? 'weekday' : 'all';
        const used = basis === 'weekday' ? sameDay : (sameDay.length > 0 ? [...sameDay, ...rows.filter(row => weekdayOf(row.dateKey) !== weekday)] : rows).slice(0, limit);
        const recommendation = recommendQuantity(used);
        if (!recommendation) return null;
        return {
            itemId: item.id,
            name: item.name,
            unit: item.unit || 'pza',
            ...recommendation,
            basis,
            weekdaySamples: sameDay.length,
            confidence: confidenceLevel(sameDay.length, basis)
        };
    }).filter(Boolean);
}

// ---------- Productos (todas las sucursales con jornadas) ----------
export function productTotalsForSessions(sessionList, transactions) {
    const totals = new Map();
    sessionList.forEach(session => {
        const seen = new Set();
        getSessionSales(session, transactions).forEach(({ tx }) => {
            (tx.itemsSoldArray || []).forEach(line => {
                const key = line.productId || line.rawName || line.name;
                if (!key) return;
                const entry = totals.get(key) || { productId: line.productId || null, name: line.rawName || line.name, qty: 0, revenue: 0, sessions: 0 };
                entry.qty += Number(line.qty) || 0;
                entry.revenue += Number(line.total) || (Number(line.price) || 0) * (Number(line.qty) || 0);
                if (!seen.has(key)) {
                    entry.sessions += 1;
                    seen.add(key);
                }
                totals.set(key, entry);
            });
        });
    });
    return totals;
}

// Recomendación por producto (sucursales sin inventario: cuánto preparar)
export function buildProductRecommendations(sessions, transactions, branchId, weekday, { beforeDateKey = null, limit = 8, top = 12 } = {}) {
    const closed = getBranchClosedSessions(sessions, branchId, { beforeDateKey }).slice(0, 40);
    const perSession = closed.map(session => ({ session, totals: productTotalsForSessions([session], transactions) }));
    const allProducts = new Map();
    perSession.forEach(({ totals }) => totals.forEach((entry, key) => {
        const current = allProducts.get(key) || { name: entry.name, qty: 0 };
        current.qty += entry.qty;
        allProducts.set(key, current);
    }));

    return [...allProducts.entries()]
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, top)
        .map(([key, info]) => {
            const rows = perSession.map(({ session, totals }) => ({ dateKey: session.dateKey, demand: totals.get(key)?.qty || 0, loaded: 0, leftover: 0 }));
            const sameDay = rows.filter(row => weekdayOf(row.dateKey) === weekday).slice(0, limit);
            const basis = sameDay.length >= WEEKDAY_MIN_SAMPLES ? 'weekday' : 'all';
            const recommendation = recommendQuantity(basis === 'weekday' ? sameDay : rows.slice(0, limit));
            return recommendation ? { key, name: info.name, ...recommendation, basis, confidence: confidenceLevel(sameDay.length, basis) } : null;
        })
        .filter(Boolean);
}

// ---------- Clasificación ----------
export function classifyItem({ avgSellThrough, soldOutRate, avgSoldOutFraction, lowDays, mermaRate, daysTracked }) {
    if (daysTracked === 0 || avgSellThrough === null) return { key: 'none', label: 'Sin datos' };
    if (mermaRate > 0.1) return { key: 'shrink', label: 'Faltan piezas', hint: 'Lo contado no cuadra con lo vendido en más del 10%.' };
    if (soldOutRate >= 0.5 && avgSoldOutFraction !== null && avgSoldOutFraction < 0.6) return { key: 'short', label: 'Se queda corto', hint: 'Se agota temprano: conviene llevar más.' };
    if (avgSellThrough >= 0.9 && soldOutRate >= 0.5) return { key: 'star', label: 'Estrella', hint: 'Se vende casi todo y se agota seguido.' };
    if (avgSellThrough < 0.6 && lowDays >= Math.min(3, daysTracked)) return { key: 'slow', label: 'Le cuesta salir', hint: 'Sobra seguido: conviene llevar menos.' };
    if (avgSellThrough >= 0.7) return { key: 'stable', label: 'Estable', hint: 'La cantidad que llevas está bien.' };
    return { key: 'regular', label: 'Regular', hint: 'Sobra algo; ajusta poco a poco.' };
}

function sessionSummaryFor(session, transactions, inventoryItems, now) {
    return session.summary || computeSessionSummary(session, transactions, inventoryItems, { now });
}

// ---------- Reporte semanal de una sucursal ----------
export function computeWeeklyReport({ sessions, transactions, inventoryItems, products = [], branchId, weekStartKey, now = new Date() }) {
    const weekKeys = getWeekKeys(weekStartKey);
    // En la semana en curso se compara contra los mismos días de la semana anterior
    const todayIndex = weekKeys.indexOf(toDateKey(now));
    const previousKeys = getWeekKeys(addDaysToKey(weekStartKey, -7)).slice(0, todayIndex >= 0 ? todayIndex + 1 : 7);
    const branchSessions = (sessions || []).filter(session => session.branchId === branchId);
    const inWeek = branchSessions.filter(session => weekKeys.includes(session.dateKey)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const inPrevious = branchSessions.filter(session => previousKeys.includes(session.dateKey));
    const summaries = new Map(inWeek.map(session => [session.id, sessionSummaryFor(session, transactions, inventoryItems, now)]));

    const salesOf = (list, summaryMap) => list.reduce((sum, session) => sum + (Number((summaryMap?.get(session.id) || sessionSummaryFor(session, transactions, inventoryItems, now)).salesTotal) || 0), 0);
    const totals = {
        sales: round2(salesOf(inWeek, summaries)),
        tickets: inWeek.reduce((sum, session) => sum + (summaries.get(session.id).ticketCount || 0), 0),
        minutes: inWeek.reduce((sum, session) => sum + (summaries.get(session.id).durationMinutes || 0), 0),
        sessions: inWeek.length,
        wasteCost: round2(inWeek.reduce((sum, session) => sum + (summaries.get(session.id).totals?.wasteCost || 0), 0)),
        leftover: round1(inWeek.reduce((sum, session) => sum + (summaries.get(session.id).totals?.leftover || 0), 0))
    };
    totals.avgTicket = totals.tickets > 0 ? round2(totals.sales / totals.tickets) : 0;
    const previousSales = round2(salesOf(inPrevious));
    totals.previousSales = inPrevious.length > 0 ? previousSales : null;
    totals.changeVsPrevious = inPrevious.length > 0 && previousSales > 0 ? round2((totals.sales - previousSales) / previousSales) : null;
    totals.partialWeek = todayIndex >= 0 && todayIndex < 6;

    // Artículos por día
    const itemMap = new Map();
    inWeek.forEach(session => {
        const summary = summaries.get(session.id);
        (summary.items || []).forEach(item => {
            if (!(item.loaded > 0)) return;
            const entry = itemMap.get(item.itemId) || { itemId: item.itemId, name: item.name, unit: item.unit, days: {}, loaded: 0, sold: 0, leftover: 0, wasteCost: 0, positiveDifference: 0, soldOutDays: 0, soldOutMinutes: [], soldOutFractions: [], lowDays: 0, serviceMinutes: 0 };
            entry.days[session.dateKey] = item;
            entry.loaded += item.loaded;
            entry.sold += item.sold;
            entry.leftover += item.leftover ?? 0;
            entry.wasteCost += item.wasteCost || 0;
            entry.positiveDifference += Math.max(0, item.difference || 0);
            entry.serviceMinutes += summary.durationMinutes || 0;
            if (item.soldOutAt) {
                entry.soldOutDays += 1;
                if (item.minutesToSellOut !== null && item.minutesToSellOut !== undefined) {
                    entry.soldOutMinutes.push(item.minutesToSellOut);
                    if (summary.durationMinutes > 0) entry.soldOutFractions.push(item.minutesToSellOut / summary.durationMinutes);
                }
            }
            if ((item.sellThrough ?? 1) < 0.6) entry.lowDays += 1;
            itemMap.set(item.itemId, entry);
        });
    });
    const items = [...itemMap.values()].map(entry => {
        const daysTracked = Object.keys(entry.days).length;
        const stats = {
            daysTracked,
            avgSellThrough: entry.loaded > 0 ? round2(Math.min(entry.sold / entry.loaded, 1)) : null,
            soldOutRate: daysTracked > 0 ? entry.soldOutDays / daysTracked : 0,
            avgSoldOutFraction: entry.soldOutFractions.length > 0 ? entry.soldOutFractions.reduce((a, b) => a + b, 0) / entry.soldOutFractions.length : null,
            lowDays: entry.lowDays,
            mermaRate: entry.loaded > 0 ? entry.positiveDifference / entry.loaded : 0
        };
        return {
            ...entry,
            loaded: round1(entry.loaded),
            sold: round1(entry.sold),
            leftover: round1(entry.leftover),
            wasteCost: round2(entry.wasteCost),
            ...stats,
            avgMinutesToSellOut: entry.soldOutMinutes.length > 0 ? Math.round(entry.soldOutMinutes.reduce((a, b) => a + b, 0) / entry.soldOutMinutes.length) : null,
            perHour: entry.serviceMinutes > 0 ? round1(entry.sold / (entry.serviceMinutes / 60)) : null,
            label: classifyItem(stats)
        };
    }).sort((a, b) => b.sold - a.sold);

    // Productos más y menos vendidos
    const productTotals = productTotalsForSessions(inWeek, transactions);
    const totalUnits = [...productTotals.values()].reduce((sum, entry) => sum + entry.qty, 0);
    const productList = [...productTotals.values()]
        .map(entry => ({ ...entry, revenue: round2(entry.revenue), share: totalUnits > 0 ? entry.qty / totalUnits : 0 }))
        .sort((a, b) => b.qty - a.qty);
    const soldIds = new Set(productList.map(entry => entry.productId).filter(Boolean));
    const unsold = inWeek.length >= 2 ? (products || []).filter(product => !soldIds.has(product.id)).map(product => product.name) : [];
    const slowProducts = inWeek.length >= 2
        ? productList.filter(entry => entry.share < 0.03 && entry.sessions < Math.max(2, inWeek.length / 2)).map(entry => entry.name)
        : [];

    // Ventas por hora y día
    const hourly = {};
    let maxHourly = 0;
    inWeek.forEach(session => {
        const weekday = weekdayOf(session.dateKey);
        getSessionSales(session, transactions).forEach(({ tx, at }) => {
            const hour = at.getHours();
            hourly[hour] = hourly[hour] || {};
            hourly[hour][weekday] = round2((hourly[hour][weekday] || 0) + (Number(tx.amount) || 0));
            maxHourly = Math.max(maxHourly, hourly[hour][weekday]);
        });
    });
    const hourTotals = Object.entries(hourly).map(([hour, days]) => ({ hour: Number(hour), total: Object.values(days).reduce((a, b) => a + b, 0) })).sort((a, b) => a.hour - b.hour);
    let peakWindow = null;
    hourTotals.forEach((entry, index) => {
        const next = hourTotals[index + 1];
        const total = entry.total + (next && next.hour === entry.hour + 1 ? next.total : 0);
        if (!peakWindow || total > peakWindow.total) peakWindow = { from: entry.hour, to: next && next.hour === entry.hour + 1 ? entry.hour + 2 : entry.hour + 1, total };
    });
    if (peakWindow) peakWindow.share = totals.sales > 0 ? round2(peakWindow.total / totals.sales) : 0;

    const salesByDay = weekKeys.map(dateKey => {
        const session = inWeek.find(entry => entry.dateKey === dateKey);
        return { dateKey, weekday: weekdayOf(dateKey), sales: session ? summaries.get(session.id).salesTotal : null };
    });

    return { weekKeys, totals, items, products: productList, slowProducts, unsold, hourly, maxHourly, peakWindow, salesByDay, sessions: inWeek };
}

// ---------- Textos de recomendación ----------
function formatDurationShort(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours} h${mins ? ` ${mins} min` : ''}` : `${mins} min`;
}

export function generateInsights(report, recommendationsByWeekday = {}, { branchName = 'la sucursal', money = (value) => `$${value}` } = {}) {
    const insights = [];
    const { totals } = report;

    if (totals.sessions === 0) return insights;

    if (totals.changeVsPrevious !== null) {
        const pct = Math.round(Math.abs(totals.changeVsPrevious) * 100);
        if (pct >= 5) insights.push({ tone: totals.changeVsPrevious > 0 ? 'good' : 'warn', text: `Vendiste ${pct}% ${totals.changeVsPrevious > 0 ? 'más' : 'menos'} que ${totals.partialWeek ? 'los mismos días de la semana anterior' : 'la semana anterior'} en ${branchName}.` });
    }

    const nextRecommendation = (itemId) => {
        const entries = Object.entries(recommendationsByWeekday)
            .map(([weekday, list]) => ({ weekday: Number(weekday), rec: list.find(entry => entry.itemId === itemId) }))
            .filter(entry => entry.rec);
        return entries[0] || null;
    };

    report.items.forEach(item => {
        const next = nextRecommendation(item.itemId);
        const advice = next ? ` Para el ${WEEKDAY_LABELS[next.weekday].toLowerCase()} lleva ${next.rec.qty}.` : '';
        if (item.label.key === 'short' || (item.label.key === 'star' && item.soldOutDays > 0)) {
            insights.push({ tone: 'warn', text: `${item.name} se agotó ${item.soldOutDays} de ${item.daysTracked} jornada${item.daysTracked === 1 ? '' : 's'}${item.avgMinutesToSellOut !== null ? `, en promedio a las ${formatDurationShort(item.avgMinutesToSellOut)} de abrir` : ''}.${advice}` });
        } else if (item.label.key === 'slow') {
            insights.push({ tone: 'warn', text: `${item.name}: se vendió ${Math.round((item.avgSellThrough || 0) * 100)}% de lo que llevaste${item.wasteCost > 0 ? ` (merma ${money(item.wasteCost)})` : ''}. Conviene llevar menos.${advice}` });
        } else if (item.label.key === 'shrink') {
            insights.push({ tone: 'warn', text: `${item.name}: al contar faltaron piezas que no se registraron como venta. Revisa si se vendieron sin registrar.` });
        }
    });

    const daysWithSales = report.salesByDay.filter(day => day.sales !== null && day.sales > 0);
    if (daysWithSales.length >= 2) {
        const average = daysWithSales.reduce((sum, day) => sum + day.sales, 0) / daysWithSales.length;
        const best = daysWithSales.reduce((top, day) => (day.sales > top.sales ? day : top), daysWithSales[0]);
        const lift = Math.round(((best.sales - average) / average) * 100);
        if (lift >= 15) insights.push({ tone: 'info', text: `El ${WEEKDAY_LABELS[best.weekday].toLowerCase()} fue tu mejor día: ${lift}% arriba del promedio de la semana.` });
    }

    if (report.peakWindow && report.peakWindow.share >= 0.3 && totals.sales > 0) {
        insights.push({ tone: 'info', text: `Entre ${String(report.peakWindow.from).padStart(2, '0')}:00 y ${String(report.peakWindow.to).padStart(2, '0')}:00 se vendió el ${Math.round(report.peakWindow.share * 100)}% de la semana.` });
    }

    if (report.slowProducts.length > 0) {
        insights.push({ tone: 'warn', text: `Les cuesta salir: ${report.slowProducts.join(', ')}. Considera sacarlos del menú o promocionarlos.` });
    }

    if (totals.wasteCost > 0 && totals.sales > 0) {
        const pct = Math.round((totals.wasteCost / totals.sales) * 100);
        if (pct >= 5) insights.push({ tone: 'warn', text: `La merma de la semana fue ${money(totals.wasteCost)} (${pct}% de lo vendido).` });
    }

    return insights;
}
