// Valores por defecto del formulario de gasto: funciones puras (sin DOM ni Firebase).

// Sucursal preseleccionada: la jornada abierta hoy (si hay exactamente una); si no, la última usada.
export function pickDefaultExpenseBranch({ sessions = [], todayKey = '', branches = [], lastBranchId = '' } = {}) {
    const exists = (id) => !!id && branches.some(branch => branch.id === id);
    const openToday = sessions.filter(session => session.status === 'open' && session.dateKey === todayKey && exists(session.branchId));
    const branchIds = [...new Set(openToday.map(session => session.branchId))];
    if (branchIds.length === 1) return branchIds[0];
    return exists(lastBranchId) ? lastBranchId : '';
}

// Nombre del grupo del atajo ('' si el atajo no existe o no tiene grupo). No crea ni cambia grupos.
export function expenseGroupNameForTag(tagName, tags = [], groups = []) {
    const tag = tags.find(item => item.name === tagName);
    if (!tag || !tag.groupId) return '';
    return groups.find(group => group.id === tag.groupId)?.name || '';
}
