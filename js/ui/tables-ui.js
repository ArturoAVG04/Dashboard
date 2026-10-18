import { formatMoney, escapeHtml, formatTimeDisplay } from '../core/date-utils.js';
import { getOpenTables, getTodayTablesCount, deleteTable } from '../services/tables-service.js';
import { getCustomBranches, getBranchNameById } from '../services/branches-service.js';

export function renderTablesBranchFilter() {
    const filterSelect = document.getElementById('tables-branch-filter');
    if (!filterSelect) return;

    const customBranches = getCustomBranches();
    const currentValue = filterSelect.value;
    filterSelect.innerHTML = '<option value="">Todas las sucursales</option>';

    customBranches.forEach(branch => {
        const opt = document.createElement('option');
        opt.value = branch.id;
        opt.textContent = branch.name;
        filterSelect.appendChild(opt);
    });

    if (currentValue && customBranches.some(b => b.id === currentValue)) {
        filterSelect.value = currentValue;
    }
}

export function renderTablesView(transactions = []) {
    const tablesGrid = document.getElementById('tables-grid');
    const filterSelect = document.getElementById('tables-branch-filter');
    const branchId = filterSelect?.value || '';

    const summaryBadge = document.getElementById('tables-today-summary-badge');
    if (summaryBadge) {
        const count = getTodayTablesCount(branchId, transactions);
        summaryBadge.innerHTML = `<i class="ph ph-table"></i> Mesas hoy: ${count}`;
    }

    if (!tablesGrid) return;
    const allTables = getOpenTables();
    const filteredTables = branchId ? allTables.filter(t => t.branchId === branchId) : allTables;

    if (filteredTables.length === 0) {
        tablesGrid.innerHTML = `<div class="empty-state"><i class="ph ph-table"></i><p>No hay mesas abiertas${branchId ? ' en esta sucursal' : ''}.</p><small>Las mesas se crean al registrar una venta en una sucursal con mesas.</small></div>`;
        return;
    }

    tablesGrid.innerHTML = filteredTables.map(table => {
        const itemCount = table.items.reduce((sum, item) => sum + item.qty, 0);
        const hiddenCount = Math.max(0, table.items.length - 4);
        const openedAt = new Date(table.createdAt);
        const openedText = isNaN(openedAt.getTime()) ? '' : ` · desde ${formatTimeDisplay(openedAt)}`;
        return `
        <article class="table-card">
            <div class="table-card-top">
                <div>
                    <div class="table-card-title">${escapeHtml(table.name)}</div>
                    <div class="table-card-subtitle">${escapeHtml(getBranchNameById(table.branchId))} · ${itemCount} producto${itemCount === 1 ? '' : 's'}${openedText}</div>
                </div>
                <div class="table-card-total">${formatMoney(table.total)}</div>
            </div>
            <div class="table-card-preview">
                ${table.items.length > 0
                    ? table.items
                        .slice(0, 4)
                        .map(item => `<span class="table-card-chip" title="${escapeHtml(item.modifierText ? `${item.name} (${item.modifierText})` : item.name)}"><strong>${item.qty}×</strong> ${escapeHtml(item.name)}${item.modifierText ? ` <small>(${escapeHtml(item.modifierText)})</small>` : ''}</span>`)
                        .join('') + (hiddenCount > 0 ? `<span class="table-card-chip empty">+${hiddenCount} más</span>` : '')
                    : '<span class="table-card-chip empty">Sin productos</span>'}
            </div>
            <div class="table-card-actions">
                <button type="button" class="btn btn-success" data-table-action="charge" data-id="${table.id}"><i class="ph ph-currency-circle-dollar"></i> Cobrar</button>
                <button type="button" class="btn btn-secondary" data-table-action="edit" data-id="${table.id}"><i class="ph ph-pencil-simple"></i> Editar</button>
                <button type="button" class="btn-icon btn-icon-danger" data-table-action="delete" data-id="${table.id}" aria-label="Eliminar ${escapeHtml(table.name)}" title="Eliminar mesa"><i class="ph ph-trash"></i></button>
            </div>
        </article>
    `;
    }).join('');
}
