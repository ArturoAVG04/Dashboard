import { escapeHtml, formatMoney } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { getCustomProducts, commitProducts, getCustomCategories } from '../services/products-service.js';
import { getModifierGroups, upsertModifierGroup, addModifierGroups, removeModifierGroup } from '../services/modifier-groups-service.js';
import {
    normalizeModifierGroup,
    usesSharedModifiers,
    hasLegacyModifiers,
    planLegacyModifierMigration,
    describeModifierGroupRule
} from '../models/ModifierGroup.js';

let editingModifierId = null;

function getGroupProductIds(groupId) {
    return getCustomProducts().filter(product => usesSharedModifiers(product) && product.modifierGroupIds.includes(groupId)).map(product => product.id);
}

// ---------- Aviso de conversión del sistema anterior ----------
export function renderModifiersMigrationBanner() {
    const banner = document.getElementById('modifiers-migration-banner');
    if (!banner) return;
    const legacyProducts = getCustomProducts().filter(hasLegacyModifiers);
    if (legacyProducts.length === 0) {
        banner.innerHTML = '';
        return;
    }
    const plan = planLegacyModifierMigration(legacyProducts, getModifierGroups());
    banner.innerHTML = `
        <div class="notice notice-warning notice-action">
            <i class="ph ph-arrows-merge"></i>
            <div>
                <strong>${legacyProducts.length} producto${legacyProducts.length === 1 ? '' : 's'} usa${legacyProducts.length === 1 ? '' : 'n'} modificadores del sistema anterior</strong>
                <p>${legacyProducts.map(p => escapeHtml(p.name)).join(', ')}. Al convertirlos se crean ${plan.newGroups.length} modificador${plan.newGroups.length === 1 ? '' : 'es'} compartido${plan.newGroups.length === 1 ? '' : 's'} (los iguales se juntan) y se asignan a esos productos. No se borra nada; las ventas siguen igual.</p>
            </div>
            <button type="button" class="btn btn-warning btn-sm" id="btn-migrate-modifiers"><i class="ph ph-arrows-merge"></i> Convertir</button>
        </div>
    `;
}

export async function migrateLegacyModifiers() {
    const products = getCustomProducts();
    const plan = planLegacyModifierMigration(products, getModifierGroups());
    if (plan.productUpdates.length === 0) return;
    if (!confirm(`Se crearán ${plan.newGroups.length} modificador(es) compartido(s) y se asignarán a ${plan.productUpdates.length} producto(s). ¿Continuar?`)) return;

    if (plan.newGroups.length > 0) await addModifierGroups(plan.newGroups);
    const updates = new Map(plan.productUpdates.map(update => [update.id, update.modifierGroupIds]));
    commitProducts(products.map(product => updates.has(product.id) ? { ...product, modifierGroupIds: updates.get(product.id) } : product));
    showToast(`Modificadores convertidos: ${plan.newGroups.length} creados`);
    renderManageModifiers();
}

// ---------- Lista ----------
export function renderManageModifiers() {
    renderModifiersMigrationBanner();
    const list = document.getElementById('manage-modifiers-list');
    if (!list) return;

    const groups = getModifierGroups();
    list.className = 'manage-grid manage-grid-wide';
    if (groups.length === 0) {
        list.innerHTML = `<div class="empty-state"><i class="ph ph-sliders"></i><p>Aún no hay modificadores compartidos.</p><small>Crea uno (ej. "Salsas") y asígnalo a todos los productos que lo usen.</small></div>`;
        return;
    }

    list.innerHTML = groups.map(group => {
        const productCount = getGroupProductIds(group.id).length;
        return `
            <div class="product-manage-card modifier-card">
                <div class="manage-card-main">
                    <div class="manage-card-title">${escapeHtml(group.name)} <span class="tag">${escapeHtml(describeModifierGroupRule(group))}</span></div>
                    <div class="option-chips">
                        ${group.options.map(opt => `<span class="option-chip">${escapeHtml(opt.name)}${opt.price > 0 ? ` <b>+${formatMoney(opt.price)}</b>` : ''}</span>`).join('')}
                    </div>
                    <div class="manage-card-meta">${productCount > 0 ? `Usado en ${productCount} producto${productCount === 1 ? '' : 's'}` : 'Sin productos asignados'}</div>
                </div>
                <div class="manage-card-actions">
                    <button type="button" class="btn-icon" data-action="modifier-edit" data-id="${escapeHtml(group.id)}" aria-label="Editar ${escapeHtml(group.name)}"><i class="ph ph-pencil-simple"></i></button>
                    <button type="button" class="btn-icon btn-icon-danger" data-action="modifier-delete" data-id="${escapeHtml(group.id)}" aria-label="Eliminar ${escapeHtml(group.name)}"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

// ---------- Editor ----------
function createOptionRowHtml(option = { id: '', name: '', price: 0 }) {
    return `
        <div class="mod-option-editor-row" data-opt-id="${escapeHtml(option.id || `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)}">
            <input type="text" class="mod-opt-name" placeholder="Opción (ej. BBQ)" value="${escapeHtml(option.name || '')}" aria-label="Nombre de la opción">
            <div class="input-prefix mod-opt-price-field"><span>+$</span><input type="number" class="mod-opt-price" min="0" step="0.5" value="${Number(option.price) || 0}" aria-label="Precio extra" inputmode="decimal"></div>
            <button type="button" class="btn-icon btn-icon-danger" data-mod-action="remove-option" aria-label="Quitar opción"><i class="ph ph-trash"></i></button>
        </div>
    `;
}

export function addModifierOptionRow(option) {
    const container = document.getElementById('manage-mod-options');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', createOptionRowHtml(option));
    container.lastElementChild?.querySelector('.mod-opt-name')?.focus();
}

function renderProductsPicker(selectedIds = []) {
    const container = document.getElementById('manage-mod-products');
    if (!container) return;
    const selected = new Set(selectedIds);
    const products = getCustomProducts();
    const categoryOrder = getCustomCategories().map(category => category.name);
    const byCategory = new Map();
    products.forEach(product => {
        const category = product.category || 'Sin categoría';
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category).push(product);
    });
    const categories = [...byCategory.keys()].sort((a, b) => {
        const ia = categoryOrder.indexOf(a);
        const ib = categoryOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    if (products.length === 0) {
        container.innerHTML = '<p class="field-hint">Aún no hay productos.</p>';
        return;
    }

    container.innerHTML = categories.map(category => `
        <div class="mod-products-category">
            <button type="button" class="mod-products-category-toggle" data-mod-action="toggle-category" data-category="${escapeHtml(category)}">
                <i class="ph ph-check-square"></i> ${escapeHtml(category)}
            </button>
            <div class="mini-check-grid">
                ${byCategory.get(category).map(product => `
                    <label class="check-chip">
                        <input type="checkbox" name="mod_product" value="${escapeHtml(product.id)}" data-category="${escapeHtml(category)}" ${selected.has(product.id) ? 'checked' : ''}>
                        <span>${escapeHtml(product.name)}${hasLegacyModifiers(product) ? ' <small class="muted-text">(sistema anterior)</small>' : ''}</span>
                    </label>
                `).join('')}
            </div>
        </div>
    `).join('');
}

export function handleModifierTypeChange() {
    const type = document.getElementById('manage-mod-type')?.value;
    const maxGroup = document.getElementById('manage-mod-max-group');
    const requiredRow = document.getElementById('manage-mod-required-row');
    const isMultiple = type === 'multiple';
    if (maxGroup) maxGroup.style.display = isMultiple ? '' : 'none';
    if (requiredRow) requiredRow.style.display = isMultiple ? '' : 'none';
}

export function openModifierForm(group = null) {
    const form = document.getElementById('manage-modifier-form');
    if (!form) return;
    editingModifierId = group?.id || null;

    document.getElementById('manage-mod-name').value = group?.name || '';
    document.getElementById('manage-mod-type').value = group?.type || 'single';
    document.getElementById('manage-mod-max').value = group?.maxSelect || '';
    document.getElementById('manage-mod-required').checked = Boolean(group?.type === 'multiple' && group.required);
    document.getElementById('manage-save-modifier').textContent = group ? 'Actualizar' : 'Guardar';

    const optionsContainer = document.getElementById('manage-mod-options');
    optionsContainer.innerHTML = '';
    (group?.options?.length ? group.options : [{}, {}]).forEach(option => optionsContainer.insertAdjacentHTML('beforeend', createOptionRowHtml(option)));

    renderProductsPicker(group ? getGroupProductIds(group.id) : []);
    handleModifierTypeChange();
    form.style.display = 'block';
    document.getElementById('manage-mod-name').focus();
}

export function closeModifierForm() {
    const form = document.getElementById('manage-modifier-form');
    if (form) form.style.display = 'none';
    editingModifierId = null;
}

export function toggleModifierForm() {
    const form = document.getElementById('manage-modifier-form');
    if (form && form.style.display !== 'none' && !editingModifierId) closeModifierForm();
    else openModifierForm();
}

export function handleModifierFormClick(event) {
    const button = event.target.closest('[data-mod-action]');
    if (!button) return;
    const action = button.dataset.modAction;

    if (action === 'remove-option') {
        button.closest('.mod-option-editor-row')?.remove();
    }
    if (action === 'toggle-category') {
        const inputs = [...document.querySelectorAll(`#manage-mod-products input[data-category="${CSS.escape(button.dataset.category)}"]`)];
        const allChecked = inputs.every(input => input.checked);
        inputs.forEach(input => { input.checked = !allChecked; });
    }
}

// El consumo de inventario de las opciones se configura en cada artículo (pestaña Inventario);
// aquí se conserva lo que la opción ya tuviera de la versión anterior.
function readOptionRows(existingGroup = null) {
    const previousOptions = new Map((existingGroup?.options || []).map(option => [option.id, option]));
    return [...document.querySelectorAll('#manage-mod-options .mod-option-editor-row')].map(row => ({
        ...(previousOptions.get(row.dataset.optId) || {}),
        id: row.dataset.optId,
        name: row.querySelector('.mod-opt-name')?.value.trim() || '',
        price: Math.max(0, parseFloat(row.querySelector('.mod-opt-price')?.value) || 0)
    })).filter(option => option.name);
}

export async function saveManagedModifier({ onProductsChanged } = {}) {
    const name = document.getElementById('manage-mod-name')?.value.trim() || '';
    const type = document.getElementById('manage-mod-type')?.value === 'multiple' ? 'multiple' : 'single';
    const existing = getModifierGroups().find(group => group.id === editingModifierId);
    const options = readOptionRows(existing);
    if (!name) {
        showToast("Escribe el nombre del modificador");
        return;
    }
    if (options.length === 0) {
        showToast("Agrega al menos una opción");
        return;
    }

    const group = normalizeModifierGroup({
        ...(existing || {}),
        id: editingModifierId || `modg_${Date.now()}`,
        name,
        type,
        required: document.getElementById('manage-mod-required')?.checked,
        maxSelect: document.getElementById('manage-mod-max')?.value,
        options,
        order: existing?.order ?? getModifierGroups().length
    });
    await upsertModifierGroup(group);

    // Asignación a productos. Si un producto aún usa el sistema anterior, primero se convierten sus
    // modificadores para no perderlos al pasar al sistema nuevo.
    const selectedIds = new Set([...document.querySelectorAll('#manage-mod-products input[name="mod_product"]:checked')].map(input => input.value));
    let products = getCustomProducts();
    const legacySelected = products.filter(product => selectedIds.has(product.id) && hasLegacyModifiers(product));
    const legacyIds = new Map();
    if (legacySelected.length > 0) {
        const plan = planLegacyModifierMigration(legacySelected, getModifierGroups());
        if (plan.newGroups.length > 0) await addModifierGroups(plan.newGroups);
        plan.productUpdates.forEach(update => legacyIds.set(update.id, update.modifierGroupIds));
    }

    products = products.map(product => {
        const current = usesSharedModifiers(product) ? product.modifierGroupIds : legacyIds.get(product.id);
        const hasGroup = Boolean(current?.includes(group.id));
        const wantsGroup = selectedIds.has(product.id);
        if (wantsGroup && !hasGroup) return { ...product, modifierGroupIds: [...(current || []), group.id] };
        if (!wantsGroup && hasGroup) return { ...product, modifierGroupIds: current.filter(id => id !== group.id) };
        return product;
    });
    commitProducts(products);

    showToast(existing ? "Modificador actualizado" : "Modificador guardado");
    closeModifierForm();
    renderManageModifiers();
    if (typeof onProductsChanged === 'function') onProductsChanged();
}

export function startEditingModifier(id) {
    const group = getModifierGroups().find(entry => entry.id === id);
    if (group) openModifierForm(group);
}

export async function deleteManagedModifier(id, { onProductsChanged } = {}) {
    const group = getModifierGroups().find(entry => entry.id === id);
    if (!group) return;
    const productIds = getGroupProductIds(id);
    const message = productIds.length > 0
        ? `¿Eliminar "${group.name}"? Se quitará de ${productIds.length} producto(s). Las ventas ya registradas no cambian.`
        : `¿Eliminar "${group.name}"?`;
    if (!confirm(message)) return;

    if (productIds.length > 0) {
        commitProducts(getCustomProducts().map(product => productIds.includes(product.id)
            ? { ...product, modifierGroupIds: product.modifierGroupIds.filter(groupId => groupId !== id) }
            : product));
    }
    await removeModifierGroup(id);
    if (editingModifierId === id) closeModifierForm();
    showToast("Modificador eliminado");
    renderManageModifiers();
    if (typeof onProductsChanged === 'function') onProductsChanged();
}
