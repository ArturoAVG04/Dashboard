// Configuración de jornadas por sucursal (F5).
// branch.sessionsEnabled   → registra jornadas (apertura/cierre) y métricas
// branch.inventoryEnabled  → además lleva inventario (carga al abrir, conteo al corte)
// branch.openMode          → 'manual' (botón "En servicio") | 'schedule' (horario fijo)
// branch.schedule          → { '0'..'6': { open: 'HH:MM', close: 'HH:MM' } } (0 = domingo)

export const WEEK_DAYS = [
    { key: '1', label: 'Lunes', short: 'Lun' },
    { key: '2', label: 'Martes', short: 'Mar' },
    { key: '3', label: 'Miércoles', short: 'Mié' },
    { key: '4', label: 'Jueves', short: 'Jue' },
    { key: '5', label: 'Viernes', short: 'Vie' },
    { key: '6', label: 'Sábado', short: 'Sáb' },
    { key: '0', label: 'Domingo', short: 'Dom' }
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeSchedule(schedule) {
    const result = {};
    if (!schedule || typeof schedule !== 'object') return result;
    WEEK_DAYS.forEach(({ key }) => {
        const day = schedule[key];
        if (day && TIME_PATTERN.test(day.open || '') && TIME_PATTERN.test(day.close || '')) {
            result[key] = { open: day.open, close: day.close };
        }
    });
    return result;
}

export function getBranchSessionConfig(branch) {
    const sessionsEnabled = Boolean(branch?.sessionsEnabled);
    return {
        sessionsEnabled,
        inventoryEnabled: sessionsEnabled && Boolean(branch?.inventoryEnabled),
        openMode: branch?.openMode === 'schedule' ? 'schedule' : 'manual',
        schedule: normalizeSchedule(branch?.schedule)
    };
}

function atTime(date, hhmm) {
    const [hours, minutes] = hhmm.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

// Horario del día de `date`. Si cierra después de medianoche, el cierre es al día siguiente.
export function getScheduleForDate(branch, date = new Date()) {
    const day = getBranchSessionConfig(branch).schedule[String(date.getDay())];
    if (!day) return null;
    const openAt = atTime(date, day.open);
    const closeAt = atTime(date, day.close);
    if (closeAt <= openAt) closeAt.setDate(closeAt.getDate() + 1);
    return { open: day.open, close: day.close, openAt, closeAt };
}

export function describeSchedule(schedule) {
    const normalized = normalizeSchedule(schedule);
    const parts = WEEK_DAYS.filter(({ key }) => normalized[key]).map(({ key, short }) => `${short} ${normalized[key].open}–${normalized[key].close}`);
    return parts.join(' · ');
}
