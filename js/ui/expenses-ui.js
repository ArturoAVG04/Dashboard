import { escapeHtml, formatMoney, getLocalDateInputValue, createLocalDateFromInput, normalizeText } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { getCustomExpenseTags, upsertExpenseTag, removeExpenseTag } from '../services/products-service.js';
import { getExpenseGroups, upsertExpenseGroup, removeExpenseGroup, getNextExpenseGroupColor } from '../services/expense-groups-service.js';
import { hasDuplicateName, getCustomBranches, getBranchById } from '../services/branches-service.js';
import { getTransactions, saveTransaction, updateTransactionRecord } from '../services/transactions-service.js';
import {
    UNGROUPED_ID,
    groupExpenseTags,
    filterExpenseTags,
    getFrequentExpenseTags,
    getLastExpenseAmounts,
    getLastExpenseAmount
} from '../models/ExpenseTag.js';

let editingExpenseTagId = null;
let editingExpenseGroupId = null;
let editingTransactionId = null;
let selectedExpenseShortcuts = [];
let expenseSearchTerm = '';
let expandedGroupIds = new Set(loadLocalState(STORAGE_KEYS.expenseGroupsExpanded, []));

function persistExpandedGroups() {
    saveLocalState(STORAGE_KEYS.expenseGroupsExpanded, [...expandedGroupIds]);
}

function formatShortDate(date) {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function renderGroupDot(color) {
    return `<span class="expense-group-dot" style="background:${escapeHtml(color || 'var(--text-muted)')};"></span>`;
}

function renderGroupOptions(selectedId = '') {
    const options = getExpenseGroups()
        .map(group => `<option value="${escapeHtml(group.id)}"${group.id === selectedId ? ' selected' : ''}>${escapeHtml(group.name)}</option>`)
        .join('');
    return `<option value=""${selectedId ? '' : ' selected'}>Sin grupo</option>${options}`;
}

export function renderExpenseGroupSelects() {
    ['new-exp-group', 'manage-exp-group'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        select.innerHTML = renderGroupOptions(current);
    });
}

// ---------- Modal: navegador de atajos ----------

function renderChip(tag) {
    const isActive = selectedExpenseShortcuts.includes(tag.name);
    return `<button type="button" class="expense-tag${isActive ? ' active' : ''}" data-expense-tag="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</button>`;
}

export function renderExpenseTags() {
    const container = document.getElementById('expense-tags-container');
    if (!container) return;

    const tags = getCustomExpenseTags();
    const groups = getExpenseGroups();

    if (tags.length === 0) {
        container.innerHTML = `<div class="expense-browser-empty">Aún no hay atajos. Usa <strong>+ Nuevo</strong> para crear uno.</div>`;
        return;
    }

    if (expenseSearchTerm) {
        const matches = filterExpenseTags(tags, expenseSearchTerm);
        container.innerHTML = matches.length > 0
            ? `<div class="expense-browser-label">Resultados (${matches.length})</div><div class="expense-chip-row">${matches.map(renderChip).join('')}</div>`
            : `<div class="expense-browser-empty">Sin coincidencias.
                   <button type="button" class="btn-text" data-create-tag="${escapeHtml(expenseSearchTerm)}"><i class="ph ph-plus"></i> Crear "${escapeHtml(expenseSearchTerm)}"</button>
               </div>`;
        return;
    }

    const frequent = getFrequentExpenseTags(tags, getTransactions());
    const sections = groupExpenseTags(tags, groups).filter(section => section.tags.length > 0);
    const onlyUngrouped = sections.length === 1 && sections[0].group.id === UNGROUPED_ID;

    let html = '';
    if (frequent.length > 0) {
        html += `<div class="expense-browser-label"><i class="ph ph-star"></i> Frecuentes</div><div class="expense-chip-row">${frequent.map(renderChip).join('')}</div>`;
    }

    if (onlyUngrouped) {
        // Sin grupos creados: se ve como antes, todos los atajos juntos.
        if (frequent.length > 0) html += `<div class="expense-browser-label">Todos</div>`;
        html += `<div class="expense-chip-row">${sections[0].tags.map(renderChip).join('')}</div>`;
    } else {
        html += sections.map(({ group, tags: groupTags }) => {
            const key = group.id || '__ungrouped';
            const isOpen = expandedGroupIds.has(key);
            const selectedCount = groupTags.filter(tag => selectedExpenseShortcuts.includes(tag.name)).length;
            return `
                <div class="expense-group${isOpen ? ' open' : ''}">
                    <button type="button" class="expense-group-header" data-toggle-group="${escapeHtml(key)}">
                        ${renderGroupDot(group.color)}
                        <span class="expense-group-name">${escapeHtml(group.name)}</span>
                        <span class="expense-group-count">${groupTags.length}</span>
                        ${selectedCount > 0 ? `<span class="expense-group-selected">${selectedCount} elegido${selectedCount > 1 ? 's' : ''}</span>` : ''}
                        <i class="ph ph-caret-down expense-group-caret"></i>
                    </button>
                    ${isOpen ? `<div class="expense-chip-row expense-group-body">${groupTags.map(renderChip).join('')}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    container.innerHTML = html;
}

export function handleExpenseTagsContainerClick(event) {
    const chip = event.target.closest('[data-expense-tag]');
    if (chip) {
        toggleExpenseShortcut(chip.dataset.expenseTag);
        return;
    }

    const groupHeader = event.target.closest('[data-toggle-group]');
    if (groupHeader) {
        const key = groupHeader.dataset.toggleGroup;
        if (expandedGroupIds.has(key)) expandedGroupIds.delete(key);
        else expandedGroupIds.add(key);
        persistExpandedGroups();
        renderExpenseTags();
        return;
    }

    const createButton = event.target.closest('[data-create-tag]');
    if (createButton) {
        addExpenseTagFromModal(createButton.dataset.createTag, '');
    }
}

export function handleExpenseSearchInput(event) {
    expenseSearchTerm = event.target.value.trim();
    renderExpenseTags();
}

function resetExpenseSearch() {
    expenseSearchTerm = '';
    const searchInput = document.getElementById('expense-tag-search');
    if (searchInput) searchInput.value = '';
}

// Alta rápida desde el modal (o desde "Crear" en la búsqueda). El atajo nuevo queda seleccionado.
export async function addExpenseTagFromModal(rawName = null, rawGroupId = null) {
    const nameInput = document.getElementById('new-exp-name');
    const groupSelect = document.getElementById('new-exp-group');
    const newExpenseForm = document.getElementById('new-expense-form');
    const name = (rawName ?? nameInput?.value ?? '').trim();
    const groupId = rawGroupId ?? groupSelect?.value ?? '';
    if (!name) {
        showToast("Escribe el nombre del atajo");
        return;
    }

    const tags = getCustomExpenseTags();
    const existing = tags.find(tag => normalizeText(tag.name) === normalizeText(name));
    if (existing) {
        showToast("Ese atajo ya existe; lo seleccioné");
    } else {
        await upsertExpenseTag({ id: `exp_${Date.now()}`, name, order: tags.length, groupId });
        showToast("Atajo agregado");
    }

    const finalName = existing?.name || name;
    if (!editingTransactionId && !selectedExpenseShortcuts.includes(finalName)) {
        selectedExpenseShortcuts = [...selectedExpenseShortcuts, finalName];
    }
    if (nameInput) nameInput.value = '';
    if (newExpenseForm) newExpenseForm.style.display = 'none';
    resetExpenseSearch();
    renderExpenseTags();
    renderSelectedExpenses();
    renderManageExpenseTags();
}

export function getSelectedExpenseRows() {
    const selectedExpensesContainer = document.getElementById('selected-expenses-container');
    const inputs = Array.from(selectedExpensesContainer?.querySelectorAll('.selected-expense-amount') || []);
    return selectedExpenseShortcuts.map(name => {
        const input = inputs.find(item => item.dataset.expenseName === name);
        return {
            name,
            amount: parseFloat(input?.value) || 0
        };
    });
}

export function updateSelectedExpensesTotal() {
    const totalSalesAmount = document.getElementById('amount');
    if (!totalSalesAmount) return;

    if (selectedExpenseShortcuts.length === 0) {
        totalSalesAmount.readOnly = false;
        return;
    }

    const total = getSelectedExpenseRows().reduce((sum, item) => sum + item.amount, 0);
    totalSalesAmount.value = total > 0 ? total : '';
    totalSalesAmount.readOnly = true;
}

export function renderSelectedExpenses() {
    const selectedExpensesContainer = document.getElementById('selected-expenses-container');
    if (!selectedExpensesContainer) return;
    const previousRows = getSelectedExpenseRows();
    const previousAmounts = new Map(previousRows.map(item => [item.name, item.amount]));

    if (selectedExpenseShortcuts.length === 0) {
        selectedExpensesContainer.style.display = 'none';
        selectedExpensesContainer.innerHTML = '';
        updateSelectedExpensesTotal();
        return;
    }

    const lastAmounts = getLastExpenseAmounts(getTransactions());
    selectedExpensesContainer.style.display = 'grid';
    selectedExpensesContainer.innerHTML = '';

    selectedExpenseShortcuts.forEach(name => {
        const row = document.createElement('div');
        row.className = 'selected-expense-row';

        const label = document.createElement('div');
        label.className = 'selected-expense-name';
        label.textContent = name;

        const last = getLastExpenseAmount(lastAmounts, name);
        if (last) {
            const lastInfo = document.createElement('small');
            lastInfo.className = 'selected-expense-last';
            lastInfo.textContent = `Último: ${formatMoney(last.amount)} · ${formatShortDate(last.date)}`;
            label.appendChild(lastInfo);
        }

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'selected-expense-amount';
        input.dataset.expenseName = name;
        input.min = '0';
        input.step = '0.5';
        input.placeholder = last ? `Último ${formatMoney(last.amount)}` : 'Costo';
        input.required = true;
        const previousAmount = previousAmounts.get(name);
        if (previousAmount > 0) input.value = String(previousAmount);

        row.append(label, input);
        selectedExpensesContainer.appendChild(row);
    });

    selectedExpensesContainer.querySelectorAll('.selected-expense-amount').forEach(input => {
        input.addEventListener('input', updateSelectedExpensesTotal);
    });
    updateSelectedExpensesTotal();
}

export function toggleExpenseShortcut(name) {
    if (editingTransactionId) {
        showToast("En edición usa la descripción y el monto del registro actual");
        return;
    }

    const exists = selectedExpenseShortcuts.includes(name);
    selectedExpenseShortcuts = exists
        ? selectedExpenseShortcuts.filter(item => item !== name)
        : [...selectedExpenseShortcuts, name];

    renderExpenseTags();
    renderSelectedExpenses();
}

export function resetSelectedExpenses() {
    selectedExpenseShortcuts = [];
    renderExpenseTags();
    renderSelectedExpenses();
    const totalSalesAmount = document.getElementById('amount');
    if (totalSalesAmount) totalSalesAmount.readOnly = false;
}

// Sucursal opcional del gasto: "General" = sin sucursal (se reparte en la comparativa)
function renderExpenseBranchOptions(selectedId = '') {
    const select = document.getElementById('expense-branch');
    if (!select) return;
    select.innerHTML = '<option value="">General (todas las sucursales)</option>' +
        getCustomBranches().map(branch => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join('');
    select.value = getCustomBranches().some(branch => branch.id === selectedId) ? selectedId : '';
}

function readExpenseBranch() {
    const branchId = document.getElementById('expense-branch')?.value || '';
    const branch = branchId ? getBranchById(branchId) : null;
    return branch ? { branchId: branch.id, zone: branch.name } : { branchId: null, zone: '' };
}

export function openExpenseModal(transaction = null) {
    const modal = document.getElementById('transaction-modal');
    const title = document.getElementById('transaction-modal-title');
    const descInput = document.getElementById('description');
    const amountInput = document.getElementById('amount');
    const dateInput = document.getElementById('date');
    const expenseForm = document.getElementById('transaction-form');

    if (!modal) return;
    if (expenseForm) expenseForm.reset();
    resetExpenseSearch();
    renderExpenseGroupSelects();
    resetSelectedExpenses();

    const transactionBranch = transaction
        ? (transaction.branchId || getCustomBranches().find(branch => branch.name === transaction.zone)?.id || '')
        : '';
    renderExpenseBranchOptions(transactionBranch);

    if (transaction) {
        editingTransactionId = transaction.id;
        if (title) title.textContent = "Editar gasto";
        if (descInput) descInput.value = transaction.desc || '';
        if (amountInput) amountInput.value = transaction.amount || '';
        if (dateInput) dateInput.value = transaction.date ? getLocalDateInputValue(new Date(transaction.date)) : getLocalDateInputValue();
    } else {
        editingTransactionId = null;
        if (title) title.textContent = "Registrar gasto";
        if (dateInput) dateInput.value = getLocalDateInputValue();
    }

    modal.classList.add('open');
}

export function closeModal() {
    const modal = document.getElementById('transaction-modal');
    if (modal) modal.classList.remove('open');
    editingTransactionId = null;
    resetExpenseSearch();
    resetSelectedExpenses();
}

export async function handleExpenseFormSubmit(e, { onUpdate } = {}) {
    e.preventDefault();
    const amountInput = document.getElementById('amount');
    const dateInput = document.getElementById('date');
    const descInput = document.getElementById('description');

    const amount = parseFloat(amountInput?.value) || 0;
    const dateVal = dateInput?.value || '';
    const dateObj = createLocalDateFromInput(dateVal);

    const selectedExpenses = getSelectedExpenseRows();
    if (selectedExpenses.length > 0 && !editingTransactionId) {
        const invalidExpense = selectedExpenses.find(item => item.amount <= 0);
        if (invalidExpense) {
            showToast(`Agrega el costo de ${invalidExpense.name}`);
            return;
        }

        for (const item of selectedExpenses) {
            const expenseTx = {
                type: 'expense',
                amount: item.amount,
                desc: item.name,
                category: 'Gastos (General)',
                ...readExpenseBranch(),
                itemsSoldArray: [],
                date: dateObj.toISOString(),
                createdAt: new Date().toISOString()
            };
            await saveTransaction(expenseTx);
        }

        showToast(`${selectedExpenses.length} gastos guardados con éxito`);
        closeModal();
        if (typeof onUpdate === 'function') onUpdate();
        return;
    }

    const desc = descInput?.value.trim() || "Gasto sin descripción";
    if (amount <= 0) {
        showToast("Ingresa un monto válido para el gasto");
        return;
    }

    const expenseTx = {
        type: 'expense',
        amount,
        desc,
        category: 'Gastos (General)',
        ...readExpenseBranch(),
        itemsSoldArray: [],
        date: dateObj.toISOString(),
        createdAt: new Date().toISOString()
    };

    if (editingTransactionId) {
        await updateTransactionRecord(editingTransactionId, expenseTx);
        showToast("Gasto actualizado con éxito");
    } else {
        await saveTransaction(expenseTx);
        showToast("Gasto guardado con éxito");
    }

    closeModal();
    if (typeof onUpdate === 'function') onUpdate();
}

// ---------- Administración: grupos y atajos ----------

export function renderManageExpenseGroups() {
    const list = document.getElementById('manage-expense-groups-list');
    if (!list) return;

    const groups = getExpenseGroups();
    const tags = getCustomExpenseTags();
    if (groups.length === 0) {
        list.innerHTML = `<p class="field-hint">Crea grupos (ej. Carnes, Verdura, Bebidas, Desechables, Servicios) para ordenar tus atajos.</p>`;
        return;
    }

    list.innerHTML = groups.map(group => {
        const count = tags.filter(tag => tag.groupId === group.id).length;
        return `
            <div class="expense-group-pill">
                ${renderGroupDot(group.color)}
                <span>${escapeHtml(group.name)}</span>
                <small>${count}</small>
                <button type="button" class="btn-icon" data-action="expense-group-edit" data-id="${escapeHtml(group.id)}" title="Editar grupo"><i class="ph ph-pencil-simple"></i></button>
                <button type="button" class="btn-icon delete" data-action="expense-group-delete" data-id="${escapeHtml(group.id)}" title="Eliminar grupo"><i class="ph ph-trash"></i></button>
            </div>
        `;
    }).join('');
}

export function renderManageExpenseTags() {
    const list = document.getElementById('manage-expense-tags-list');
    if (!list) return;

    renderManageExpenseGroups();
    renderExpenseGroupSelects();

    const tags = getCustomExpenseTags();
    const groups = getExpenseGroups();
    const sections = groupExpenseTags(tags, groups).filter(section => section.tags.length > 0);

    list.className = 'manage-expense-sections';
    if (sections.length === 0) {
        list.innerHTML = `<div class="empty-state"><i class="ph ph-receipt"></i><p>Sin atajos de gasto.</p></div>`;
        return;
    }

    list.innerHTML = sections.map(({ group, tags: groupTags }) => `
        <div class="manage-expense-section">
            <h4 class="manage-expense-section-title">${renderGroupDot(group.color)} ${escapeHtml(group.name)} <small>${groupTags.length}</small></h4>
            <div class="manage-list">
                ${groupTags.map(tag => `
                    <div class="manage-row">
                        <span class="manage-row-name">${escapeHtml(tag.name)}</span>
                        ${groups.length > 0 ? `<select class="select-compact manage-expense-tag-group" data-tag-id="${escapeHtml(tag.id)}" aria-label="Grupo de ${escapeHtml(tag.name)}">${renderGroupOptions(tag.groupId || '')}</select>` : ''}
                        <div class="manage-card-actions">
                            <button type="button" class="btn-icon" data-action="expense-edit" data-id="${escapeHtml(tag.id)}" aria-label="Editar ${escapeHtml(tag.name)}"><i class="ph ph-pencil-simple"></i></button>
                            <button type="button" class="btn-icon btn-icon-danger" data-action="expense-delete" data-id="${escapeHtml(tag.id)}" aria-label="Eliminar ${escapeHtml(tag.name)}"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

export async function handleManageExpenseTagGroupChange(event) {
    const select = event.target.closest('.manage-expense-tag-group');
    if (!select) return;
    const tag = getCustomExpenseTags().find(item => item.id === select.dataset.tagId);
    if (!tag) return;

    await upsertExpenseTag({ ...tag, groupId: select.value });
    showToast(`${tag.name} → ${select.selectedOptions[0]?.textContent || 'Sin grupo'}`);
    refreshExpenseViews();
}

function refreshExpenseViews() {
    renderManageExpenseTags();
    renderExpenseTags();
}

export function resetManageExpenseForm() {
    editingExpenseTagId = null;
    const nameInput = document.getElementById('manage-exp-name');
    const groupSelect = document.getElementById('manage-exp-group');
    const saveButton = document.getElementById('manage-save-expense');
    if (nameInput) nameInput.value = '';
    if (groupSelect) groupSelect.value = '';
    if (saveButton) saveButton.textContent = 'Guardar';
}

export async function saveManagedExpenseTag() {
    const nameInput = document.getElementById('manage-exp-name');
    const groupSelect = document.getElementById('manage-exp-group');
    const form = document.getElementById('manage-new-expense-form');
    const name = nameInput?.value.trim() || '';
    if (!name) return;

    const tags = getCustomExpenseTags();
    if (hasDuplicateName(tags, name, editingExpenseTagId)) {
        showToast("Ese atajo ya está registrado");
        return;
    }

    const groupId = groupSelect?.value || '';
    if (editingExpenseTagId) {
        const tag = tags.find(item => item.id === editingExpenseTagId);
        await upsertExpenseTag({ ...tag, name, groupId });
        showToast("Acceso actualizado");
    } else {
        await upsertExpenseTag({ id: `exp_${Date.now()}`, name, order: tags.length, groupId });
        showToast("Acceso guardado");
    }

    resetManageExpenseForm();
    if (form) form.style.display = 'none';
    refreshExpenseViews();
}

export function startEditingExpenseTag(id) {
    const tag = getCustomExpenseTags().find(item => item.id === id);
    if (!tag) return;

    editingExpenseTagId = id;
    const nameInput = document.getElementById('manage-exp-name');
    const groupSelect = document.getElementById('manage-exp-group');
    const saveButton = document.getElementById('manage-save-expense');
    const form = document.getElementById('manage-new-expense-form');

    renderExpenseGroupSelects();
    if (nameInput) nameInput.value = tag.name;
    if (groupSelect) groupSelect.value = tag.groupId || '';
    if (saveButton) saveButton.textContent = 'Actualizar';
    if (form) form.style.display = 'block';
    nameInput?.focus();
}

export async function deleteManagedExpenseTag(id) {
    if (!confirm("¿Estás seguro de que quieres eliminar este acceso de gasto?")) return;

    if (editingExpenseTagId === id) {
        resetManageExpenseForm();
        const form = document.getElementById('manage-new-expense-form');
        if (form) form.style.display = 'none';
    }
    await removeExpenseTag(id);
    refreshExpenseViews();
}

export function resetManageExpenseGroupForm() {
    editingExpenseGroupId = null;
    const nameInput = document.getElementById('manage-exp-group-name');
    const colorInput = document.getElementById('manage-exp-group-color');
    const saveButton = document.getElementById('manage-save-expense-group');
    if (nameInput) nameInput.value = '';
    if (colorInput) colorInput.value = getNextExpenseGroupColor();
    if (saveButton) saveButton.textContent = 'Guardar grupo';
}

export async function saveManagedExpenseGroup() {
    const nameInput = document.getElementById('manage-exp-group-name');
    const colorInput = document.getElementById('manage-exp-group-color');
    const form = document.getElementById('manage-new-expense-group-form');
    const name = nameInput?.value.trim() || '';
    if (!name) return;

    const groups = getExpenseGroups();
    if (hasDuplicateName(groups, name, editingExpenseGroupId)) {
        showToast("Ese grupo ya existe");
        return;
    }

    const color = colorInput?.value || getNextExpenseGroupColor();
    if (editingExpenseGroupId) {
        const group = groups.find(item => item.id === editingExpenseGroupId);
        await upsertExpenseGroup({ ...group, name, color });
        showToast("Grupo actualizado");
    } else {
        await upsertExpenseGroup({ name, color });
        showToast("Grupo creado");
    }

    resetManageExpenseGroupForm();
    if (form) form.style.display = 'none';
    refreshExpenseViews();
}

export function startEditingExpenseGroup(id) {
    const group = getExpenseGroups().find(item => item.id === id);
    if (!group) return;

    editingExpenseGroupId = id;
    const nameInput = document.getElementById('manage-exp-group-name');
    const colorInput = document.getElementById('manage-exp-group-color');
    const saveButton = document.getElementById('manage-save-expense-group');
    const form = document.getElementById('manage-new-expense-group-form');

    if (nameInput) nameInput.value = group.name;
    if (colorInput) colorInput.value = group.color || getNextExpenseGroupColor();
    if (saveButton) saveButton.textContent = 'Actualizar grupo';
    if (form) form.style.display = 'block';
    nameInput?.focus();
}

// Al borrar un grupo, sus atajos pasan a "Sin grupo" (no se borra ningún atajo).
export async function deleteManagedExpenseGroup(id) {
    const group = getExpenseGroups().find(item => item.id === id);
    if (!group) return;
    const groupTags = getCustomExpenseTags().filter(tag => tag.groupId === id);
    const message = groupTags.length > 0
        ? `¿Eliminar el grupo "${group.name}"? Sus ${groupTags.length} atajos pasarán a "Sin grupo".`
        : `¿Eliminar el grupo "${group.name}"?`;
    if (!confirm(message)) return;

    for (const tag of groupTags) {
        await upsertExpenseTag({ ...tag, groupId: '' });
    }
    await removeExpenseGroup(id);
    if (editingExpenseGroupId === id) resetManageExpenseGroupForm();
    expandedGroupIds.delete(id);
    persistExpandedGroups();
    showToast("Grupo eliminado");
    refreshExpenseViews();
}
