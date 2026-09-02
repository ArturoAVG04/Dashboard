import { formatMoney } from '../core/date-utils.js';
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
        tablesGrid.innerHTML = `<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted);">No hay mesas abiertas${branchId ? ' en esta sucursal' : ''}.</div>`;
        return;
    }

    tablesGrid.innerHTML = filteredTables.map(table => `
        <article class="table-card">
            <div class="table-card-top">
                <div>
                    <div class="table-card-title">${table.name}</div>
                    <div class="table-card-subtitle">${getBranchNameById(table.branchId)} · ${table.items.reduce((sum, item) => sum + item.qty, 0)} productos</div>
                </div>
                <div class="table-card-total">${formatMoney(table.total)}</div>
            </div>
            <div class="table-card-preview">
                ${table.items.length > 0
                    ? table.items
                        .slice(0, 4)
                        .map(item => `<span class="table-card-chip" title="${item.modifierText ? `${item.name} (${item.modifierText})` : item.name}">${item.qty}x ${item.name}${item.modifierText ? ` <small style="color:var(--primary); font-size:0.75rem;">(${item.modifierText})</small>` : ''}</span>`)
                        .join('')
                    : '<span class="table-card-chip empty">Sin productos</span>'}
            </div>
            <div class="table-card-actions">
                <button type="button" class="submit-btn" data-table-action="edit" data-id="${table.id}"><i class="ph ph-pencil-simple"></i> Editar</button>
                <button type="button" class="submit-btn" style="background: var(--success);" data-table-action="charge" data-id="${table.id}"><i class="ph ph-currency-circle-dollar"></i> Cobrar</button>
                <button type="button" class="submit-btn" style="background: var(--danger);" data-table-action="delete" data-id="${table.id}"><i class="ph ph-trash"></i> Eliminar</button>
            </div>
        </article>
    `).join('');
}
