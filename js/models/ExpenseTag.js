import { normalizeText } from '../core/date-utils.js';

export const UNGROUPED_ID = '';
export const UNGROUPED_LABEL = 'Sin grupo';

const DAY_MS = 24 * 60 * 60 * 1000;

function compareByName(a, b) {
    return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
}

export function normalizeExpenseGroups(groups) {
    return (groups || [])
        .map((group, index) => ({
            id: group.id || `expg_${index}_${normalizeText(group.name).replace(/\s+/g, '_')}`,
            name: String(group.name || '').trim(),
            color: group.color || '',
            order: typeof group.order === 'number' ? group.order : index
        }))
        .filter(group => group.name)
        .sort((a, b) => (a.order - b.order) || compareByName(a, b));
}

// Agrupa atajos por grupo (en el orden de los grupos) y deja "Sin grupo" al final.
// Atajos con un groupId que ya no existe caen en "Sin grupo".
export function groupExpenseTags(tags, groups) {
    const knownIds = new Set((groups || []).map(group => group.id));
    const buckets = new Map((groups || []).map(group => [group.id, []]));
    const ungrouped = [];

    (tags || []).forEach(tag => {
        const groupId = tag.groupId || UNGROUPED_ID;
        if (groupId && knownIds.has(groupId)) buckets.get(groupId).push(tag);
        else ungrouped.push(tag);
    });

    const sections = (groups || []).map(group => ({
        group,
        tags: [...buckets.get(group.id)].sort(compareByName)
    }));

    if (ungrouped.length > 0) {
        sections.push({
            group: { id: UNGROUPED_ID, name: UNGROUPED_LABEL, color: '', order: Number.MAX_SAFE_INTEGER },
            tags: ungrouped.sort(compareByName)
        });
    }

    return sections;
}

export function filterExpenseTags(tags, searchTerm) {
    const term = normalizeText(searchTerm);
    if (!term) return [...(tags || [])];
    return (tags || []).filter(tag => normalizeText(tag.name).includes(term)).sort(compareByName);
}

function getExpenseKey(transaction) {
    return normalizeText(transaction?.desc);
}

function getTransactionTime(transaction) {
    const time = new Date(transaction?.date || transaction?.createdAt || 0).getTime();
    return Number.isFinite(time) ? time : 0;
}

// Atajos más registrados en los últimos `days` días (empate: el más reciente primero).
export function getFrequentExpenseTags(tags, transactions, { days = 30, limit = 8, now = new Date() } = {}) {
    const since = now.getTime() - days * DAY_MS;
    const stats = new Map();

    (transactions || []).forEach(transaction => {
        if (transaction.type !== 'expense') return;
        const time = getTransactionTime(transaction);
        if (time < since) return;

        const key = getExpenseKey(transaction);
        if (!key) return;
        const current = stats.get(key) || { count: 0, lastTime: 0 };
        current.count += 1;
        current.lastTime = Math.max(current.lastTime, time);
        stats.set(key, current);
    });

    return (tags || [])
        .map(tag => ({ tag, stat: stats.get(normalizeText(tag.name)) }))
        .filter(entry => entry.stat)
        .sort((a, b) => (b.stat.count - a.stat.count) || (b.stat.lastTime - a.stat.lastTime))
        .slice(0, limit)
        .map(entry => entry.tag);
}

// Último monto pagado por concepto: Map(nombreNormalizado -> { amount, date }).
export function getLastExpenseAmounts(transactions) {
    const latest = new Map();

    (transactions || []).forEach(transaction => {
        if (transaction.type !== 'expense') return;
        const key = getExpenseKey(transaction);
        const amount = Number(transaction.amount) || 0;
        if (!key || amount <= 0) return;

        const time = getTransactionTime(transaction);
        const current = latest.get(key);
        if (!current || time > current.time) {
            latest.set(key, { amount, date: new Date(time), time });
        }
    });

    return latest;
}

export function getLastExpenseAmount(lastAmounts, name) {
    return lastAmounts?.get(normalizeText(name)) || null;
}

// Totales de gastos por grupo, con el detalle por concepto dentro de cada grupo.
// Un gasto pertenece a un grupo si su descripción coincide con un atajo de ese grupo.
export function getExpenseStatsByGroup(transactions, tags, groups) {
    const groupByTagName = new Map((tags || []).map(tag => [normalizeText(tag.name), tag.groupId || UNGROUPED_ID]));
    const knownIds = new Set((groups || []).map(group => group.id));
    const sections = new Map();

    const ensureSection = (groupId) => {
        if (!sections.has(groupId)) {
            const group = (groups || []).find(item => item.id === groupId)
                || { id: UNGROUPED_ID, name: UNGROUPED_LABEL, color: '', order: Number.MAX_SAFE_INTEGER };
            sections.set(groupId, { group, count: 0, total: 0, concepts: new Map() });
        }
        return sections.get(groupId);
    };

    (transactions || []).forEach(transaction => {
        if (transaction.type !== 'expense') return;
        const label = (transaction.desc || transaction.category || 'Gasto sin descripción').trim();
        const key = normalizeText(label) || 'gasto-sin-descripcion';
        const rawGroupId = groupByTagName.get(key) || UNGROUPED_ID;
        const groupId = knownIds.has(rawGroupId) ? rawGroupId : UNGROUPED_ID;
        const amount = Number(transaction.amount) || 0;

        const section = ensureSection(groupId);
        section.count += 1;
        section.total += amount;

        const concept = section.concepts.get(key) || { label, count: 0, total: 0 };
        concept.count += 1;
        concept.total += amount;
        section.concepts.set(key, concept);
    });

    return [...sections.values()]
        .map(section => ({
            ...section,
            concepts: [...section.concepts.values()].sort((a, b) => (b.total - a.total) || (b.count - a.count))
        }))
        .sort((a, b) => b.total - a.total);
}
