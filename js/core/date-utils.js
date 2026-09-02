export function getLocalDateInputValue(date = new Date()) {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function isSameLocalDate(dateA, dateB = new Date()) {
    if (!dateA) return false;
    try {
        const dA = typeof dateA === 'string' || typeof dateA === 'number' ? new Date(dateA) : dateA;
        const dB = typeof dateB === 'string' || typeof dateB === 'number' ? new Date(dateB) : dateB;
        if (isNaN(dA.getTime()) || isNaN(dB.getTime())) return false;
        return getLocalDateInputValue(dA) === getLocalDateInputValue(dB);
    } catch (e) {
        return false;
    }
}

export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function createLocalDateFromInput(dateValue) {
    const nowLocal = new Date();
    if (!dateValue) return nowLocal;

    const [yy, mm, dd] = dateValue.split('-').map(Number);
    if (!yy || !mm || !dd) return nowLocal;

    nowLocal.setFullYear(yy, mm - 1, dd);
    return nowLocal;
}

export function formatMoney(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount || 0);
}

export function formatDateDisplay(date = new Date()) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('es-ES', options);
}

export function normalizeText(value) {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function toTitleCase(value) {
    return (value || '')
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
