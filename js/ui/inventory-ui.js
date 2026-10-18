import { escapeHtml, formatMoney, normalizeText } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import {
    getInventoryItems,
    getBranchInventoryItems,
    getLegacyInventoryItems,
    upsertInventoryItem,
    upsertInventoryItems,
    removeInventoryItem
} from '../services/inventory-service.js';
import { getCustomProducts, getCustomCategories } from '../services/products-service.js';
import { getCustomBranches, getBranchById, productAvailableInBranch } from '../services/branches-service.js';
import { getModifierGroups } from '../services/modifier-groups-service.js';
import { getTransactions } from '../services/transactions-service.js';
import { getBranchSessionConfig } from '../models/BranchConfig.js';
import {
    INVENTORY_UNITS,
    normalizeConsumers,
    normalizeInventoryItems,
    getProductUsage,
    computeItemUnitPrice,
    planLegacyInventoryMigration
} from '../models/Inventory.js';

const HISTORY_DAYS = 60;
let editingInventoryId = null;
let selectedBranchId = loadLocalState(STORAGE_KEYS.inventoryBranch, '');

function getInventoryBranches() {
    return getCustomBranches().filter(branch => getBranchSessionConfig(branch).inventoryEnabled);
}

export function getSelectedInventoryBranchId() {
    const branches = getInventoryBranches();
    if (!branches.some(branch => branch.id === selectedBranchId)) selectedBranchId = branches[0]?.id || '';
    return selectedBranchId;
}

function setSelectedBranch(branchId) {
    selectedBranchId = branchId;
    saveLocalState(STORAGE_KEYS.inventoryBranch, branchId);
    closeInventoryForm();
    renderManageInventory();
}

function unitLabel(unit) {
    return INVENTORY_UNITS.find(entry => entry.value === unit)?.value || unit || 'pza';
}

function historySince() {
    return new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
}

// Precio medio por unidad de un artículo de la sucursal (ponderado por ventas reales si hay)
export function getItemUnitPrice(item, branchId) {
    return computeItemUnitPrice(item, getCustomProducts(), getBranchInventoryItems(branchId), {
        transactions: getTransactions(),
        branchId,
        since: historySince()
    });
}

export function renderInventoryUnitOptions() {
    const select = document.getElementById('manage-inv-unit');
    if (!select) return;
    select.innerHTML = INVENTORY_UNITS.map(unit => `<option value="${unit.value}">${unit.label} (${unit.value})</option>`).join('');
}

// ---------- Pestaña Inventario ----------
export function renderManageInventory() {
    const picker = document.getElementById('inventory-branch-picker');
    const notices = document.getElementById('inventory-notices');
    const list = document.getElementById('manage-inventory-list');
    const addButton = document.getElementById('btn-add-inventory-manage');
    if (!list) return;

    const branches = getInventoryBranches();
    const branchId = getSelectedInventoryBranchId();

    if (picker) {
        picker.innerHTML = branches.length > 0
            ? `<div class="segmented" role="tablist" aria-label="Sucursal">${branches.map(branch => `
                <button type="button" class="segmented-btn${branch.id === branchId ? ' active' : ''}" data-inventory-action="select-branch" data-branch-id="${escapeHtml(branch.id)}" role="tab" aria-selected="${branch.id === branchId}">
                    <i class="ph ph-storefront"></i> ${escapeHtml(branch.name)}
                </button>`).join('')}</div>`
            : '';
    }
    if (addButton) addButton.style.display = branches.length > 0 ? '' : 'none';

    if (branches.length === 0) {
        if (notices) notices.innerHTML = '';
        list.className = '';
        list.innerHTML = `<div class="empty-state"><i class="ph ph-cube"></i><p>Ninguna sucursal lleva inventario.</p><small>Actívalo en Sucursales → editar → "Registrar jornadas" y "Llevar inventario".</small></div>`;
        return;
    }

    const branchName = escapeHtml(getBranchById(branchId)?.name || '');
    const items = getBranchInventoryItems(branchId);
    const legacy = getLegacyInventoryItems();
    const otherBranchesWithItems = branches.filter(branch => branch.id !== branchId && getBranchInventoryItems(branch.id).length > 0);

    const noticeParts = [];
    if (legacy.length > 0) {
        noticeParts.push(`
            <div class="notice notice-warning notice-action">
                <i class="ph ph-arrows-merge"></i>
                <div>
                    <strong>${legacy.length} artículo${legacy.length === 1 ? '' : 's'} de la versión anterior sin sucursal</strong>
                    <p>${legacy.map(item => escapeHtml(item.name)).join(', ')}. Asígnalos a ${branchName}; lo que habías configurado en los productos se pasa a cada artículo.</p>
                </div>
                <button type="button" class="btn btn-warning btn-sm" data-inventory-action="migrate-legacy"><i class="ph ph-arrows-merge"></i> Asignar a ${branchName}</button>
            </div>`);
    }
    if (items.length === 0 && otherBranchesWithItems.length > 0) {
        noticeParts.push(`
            <div class="notice notice-action">
                <i class="ph ph-copy"></i>
                <div><strong>${branchName} aún no tiene artículos</strong><p>Puedes copiar los de otra sucursal y ajustarlos.</p></div>
                ${otherBranchesWithItems.map(branch => `<button type="button" class="btn btn-secondary btn-sm" data-inventory-action="copy-from" data-branch-id="${escapeHtml(branch.id)}"><i class="ph ph-copy"></i> Copiar de ${escapeHtml(branch.name)}</button>`).join('')}
            </div>`);
    }
    const branchProducts = getCustomProducts().filter(product => productAvailableInBranch(product, branchId));
    const untracked = branchProducts.filter(product => getProductUsage(product.id, items).length === 0);
    if (items.length > 0 && untracked.length > 0) {
        noticeParts.push(`<div class="notice"><i class="ph ph-info"></i><span><strong>No descuentan inventario en ${branchName}:</strong> ${untracked.map(p => escapeHtml(p.name)).join(', ')}.</span></div>`);
    }
    if (notices) notices.innerHTML = noticeParts.join('');

    list.className = 'manage-grid manage-grid-wide';
    if (items.length === 0) {
        list.innerHTML = `<div class="empty-state"><i class="ph ph-cube"></i><p>${branchName} no tiene artículos de inventario.</p><small>Crea uno (ej. "Burrito Base") y marca qué productos lo descuentan.</small></div>`;
        return;
    }

    const productsById = new Map(getCustomProducts().map(product => [product.id, product]));
    const optionsByKey = new Map();
    getModifierGroups().forEach(group => group.options.forEach(option => optionsByKey.set(`${group.id}:${option.id}`, `${group.name}: ${option.name}`)));

    list.innerHTML = items.map(item => {
        const consumerChips = item.consumers.map(consumer => {
            const label = consumer.type === 'option'
                ? optionsByKey.get(`${consumer.groupId}:${consumer.optionId}`)
                : productsById.get(consumer.productId)?.name;
            return label ? `<span class="option-chip">${escapeHtml(label)} <b>−${consumer.qty}</b></span>` : '';
        }).join('');
        const price = getItemUnitPrice(item, branchId);
        return `
            <div class="product-manage-card modifier-card">
                <span class="item-icon"><i class="ph ph-cube"></i></span>
                <div class="manage-card-main">
                    <div class="manage-card-title">${escapeHtml(item.name)} <span class="tag">${escapeHtml(unitLabel(item.unit))}</span></div>
                    <div class="option-chips">${consumerChips || '<span class="muted-text">Ningún producto lo descuenta todavía</span>'}</div>
                    <div class="manage-card-meta">
                        <span>${typeof item.unitCost === 'number' ? `Costo ${formatMoney(item.unitCost)}` : 'Sin costo'}</span>
                        ${price ? `<span>Precio medio ${formatMoney(price.unitPrice)} por ${escapeHtml(unitLabel(item.unit))}${price.basis === 'history' ? ' (según ventas)' : ''}</span>` : ''}
                        ${price && typeof item.unitCost === 'number' && price.unitPrice > 0 ? `<span>Margen ${Math.round(((price.unitPrice - item.unitCost) / price.unitPrice) * 100)}%</span>` : ''}
                    </div>
                </div>
                <div class="manage-card-actions">
                    <button type="button" class="btn-icon" data-inventory-action="edit" data-id="${escapeHtml(item.id)}" aria-label="Editar ${escapeHtml(item.name)}"><i class="ph ph-pencil-simple"></i></button>
                    <button type="button" class="btn-icon btn-icon-danger" data-inventory-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.name)}"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

// ---------- Formulario del artículo ----------
function renderConsumerRows(item = null) {
    const branchId = getSelectedInventoryBranchId();
    const container = document.getElementById('manage-inv-consumers');
    const optionsContainer = document.getElementById('manage-inv-option-consumers');
    if (!container) return;

    const qtyByProduct = new Map((item?.consumers || []).filter(c => c.type === 'product').map(c => [c.productId, c.qty]));
    const qtyByOption = new Map((item?.consumers || []).filter(c => c.type === 'option').map(c => [`${c.groupId}:${c.optionId}`, c.qty]));
    const categoryOrder = getCustomCategories().map(category => category.name);
    const products = getCustomProducts()
        .filter(product => productAvailableInBranch(product, branchId) || qtyByProduct.has(product.id))
        .sort((a, b) => {
            const ca = categoryOrder.indexOf(a.category);
            const cb = categoryOrder.indexOf(b.category);
            return ((ca === -1 ? 999 : ca) - (cb === -1 ? 999 : cb)) || (a.order || 0) - (b.order || 0);
        });

    let lastCategory = null;
    container.innerHTML = products.length > 0 ? products.map(product => {
        const header = product.category !== lastCategory ? `<div class="consumers-category">${escapeHtml(product.category || 'Sin categoría')}</div>` : '';
        lastCategory = product.category;
        const qty = qtyByProduct.get(product.id);
        return `${header}
            <div class="consumer-row${qty ? ' is-active' : ''}">
                <div class="consumer-info">
                    <strong>${escapeHtml(product.name)}</strong>
                    <small>${formatMoney(product.price)}</small>
                </div>
                <span class="consumer-unit-price" data-price="${Number(product.price) || 0}"></span>
                <input type="number" class="consumer-qty" data-product-id="${escapeHtml(product.id)}" min="0" step="any" inputmode="decimal" value="${qty ?? ''}" placeholder="—" aria-label="Unidades que descuenta ${escapeHtml(product.name)}">
            </div>`;
    }).join('') : '<p class="field-hint">No hay productos disponibles en esta sucursal.</p>';

    if (optionsContainer) {
        const groups = getModifierGroups();
        optionsContainer.innerHTML = groups.length > 0 ? groups.map(group => `
            <div class="consumers-category">${escapeHtml(group.name)}</div>
            ${group.options.map(option => {
                const qty = qtyByOption.get(`${group.id}:${option.id}`);
                return `
                    <div class="consumer-row${qty ? ' is-active' : ''}">
                        <div class="consumer-info">
                            <strong>${escapeHtml(option.name)}</strong>
                            <small>${option.price > 0 ? `+${formatMoney(option.price)}` : 'Sin costo extra'}</small>
                        </div>
                        <span></span>
                        <input type="number" class="consumer-qty" data-group-id="${escapeHtml(group.id)}" data-option-id="${escapeHtml(option.id)}" min="0" step="any" inputmode="decimal" value="${qty ?? ''}" placeholder="—" aria-label="Unidades que descuenta ${escapeHtml(option.name)}">
                    </div>`;
            }).join('')}
        `).join('') : '<p class="field-hint">No hay modificadores compartidos.</p>';
        const details = optionsContainer.closest('details');
        if (details) details.open = qtyByOption.size > 0;
    }
    updateConsumerHints();
}

function readConsumers() {
    return normalizeConsumers([...document.querySelectorAll('#manage-inventory-form .consumer-qty')].map(input => (
        input.dataset.productId
            ? { type: 'product', productId: input.dataset.productId, qty: parseFloat(input.value) }
            : { type: 'option', groupId: input.dataset.groupId, optionId: input.dataset.optionId, qty: parseFloat(input.value) }
    )));
}

// Precio por unidad de cada producto, margen y precio medio mientras se edita
export function updateConsumerHints() {
    const cost = parseFloat(document.getElementById('manage-inv-cost')?.value);
    const unitPrices = [];
    document.querySelectorAll('#manage-inv-consumers .consumer-row').forEach(row => {
        const input = row.querySelector('.consumer-qty');
        const hint = row.querySelector('.consumer-unit-price');
        const qty = parseFloat(input?.value);
        row.classList.toggle('is-active', qty > 0);
        if (!hint) return;
        if (!(qty > 0)) {
            hint.textContent = '';
            return;
        }
        const unitPrice = (Number(hint.dataset.price) || 0) / qty;
        unitPrices.push(unitPrice);
        const margin = Number.isFinite(cost) && unitPrice > 0 ? ` · margen ${Math.round(((unitPrice - cost) / unitPrice) * 100)}%` : '';
        hint.textContent = `${formatMoney(unitPrice)} c/u${margin}`;
    });
    document.querySelectorAll('#manage-inv-option-consumers .consumer-row').forEach(row => {
        row.classList.toggle('is-active', parseFloat(row.querySelector('.consumer-qty')?.value) > 0);
    });

    const summary = document.getElementById('manage-inv-price-summary');
    if (!summary) return;
    if (unitPrices.length === 0) {
        summary.textContent = '';
        return;
    }
    const mean = unitPrices.reduce((sum, price) => sum + price, 0) / unitPrices.length;
    summary.textContent = `Precio medio por unidad (según el menú): ${formatMoney(mean)}. Con ventas registradas se ajusta a lo que realmente se vende.`;
}

export function openInventoryForm(item = null) {
    const form = document.getElementById('manage-inventory-form');
    if (!form || !getSelectedInventoryBranchId()) return;
    editingInventoryId = item?.id || null;
    renderInventoryUnitOptions();
    document.getElementById('manage-inv-name').value = item?.name || '';
    document.getElementById('manage-inv-unit').value = item?.unit || 'pza';
    document.getElementById('manage-inv-cost').value = typeof item?.unitCost === 'number' ? item.unitCost : '';
    document.getElementById('manage-save-inventory').textContent = item ? 'Actualizar' : 'Guardar';
    renderConsumerRows(item);
    form.style.display = 'block';
    document.getElementById('manage-inv-name').focus();
}

export function closeInventoryForm() {
    const form = document.getElementById('manage-inventory-form');
    if (form) form.style.display = 'none';
    editingInventoryId = null;
}

export function toggleInventoryForm() {
    const form = document.getElementById('manage-inventory-form');
    if (form && form.style.display !== 'none' && !editingInventoryId) closeInventoryForm();
    else openInventoryForm();
}

export async function saveManagedInventoryItem() {
    const branchId = getSelectedInventoryBranchId();
    const name = document.getElementById('manage-inv-name')?.value.trim() || '';
    const unit = document.getElementById('manage-inv-unit')?.value || 'pza';
    const costValue = document.getElementById('manage-inv-cost')?.value;
    if (!branchId) return;
    if (!name) {
        showToast("Escribe el nombre del artículo");
        return;
    }
    const duplicate = getBranchInventoryItems(branchId).find(item => normalizeText(item.name) === normalizeText(name) && item.id !== editingInventoryId);
    if (duplicate) {
        showToast("Ese artículo ya existe en esta sucursal");
        return;
    }

    const existing = getInventoryItems().find(item => item.id === editingInventoryId);
    await upsertInventoryItem({
        ...(existing || {}),
        id: editingInventoryId || `inv_${Date.now()}`,
        branchId,
        name,
        unit,
        unitCost: costValue === '' ? null : parseFloat(costValue),
        consumers: readConsumers()
    });
    showToast(existing ? "Artículo actualizado" : "Artículo guardado");
    closeInventoryForm();
    renderManageInventory();
}

async function deleteManagedInventoryItem(id) {
    const item = getInventoryItems().find(entry => entry.id === id);
    if (!item) return;
    if (!confirm(`¿Eliminar "${item.name}"? Las ventas y cortes ya registrados no cambian.`)) return;
    await removeInventoryItem(id);
    if (editingInventoryId === id) closeInventoryForm();
    showToast("Artículo eliminado");
    renderManageInventory();
}

async function migrateLegacyItems() {
    const branchId = getSelectedInventoryBranchId();
    const legacy = getLegacyInventoryItems();
    if (!branchId || legacy.length === 0) return;
    const branchName = getBranchById(branchId)?.name || 'la sucursal';
    if (!confirm(`¿Asignar ${legacy.length} artículo(s) a ${branchName}?`)) return;
    await upsertInventoryItems(planLegacyInventoryMigration(legacy, getCustomProducts(), getModifierGroups(), branchId));
    showToast(`Artículos asignados a ${branchName}`, 'success');
    renderManageInventory();
}

async function copyItemsFrom(fromBranchId) {
    const branchId = getSelectedInventoryBranchId();
    const source = getBranchInventoryItems(fromBranchId);
    if (!branchId || source.length === 0) return;
    const stamp = Date.now();
    const copies = normalizeInventoryItems(source.map((item, index) => ({
        ...item,
        id: `inv_${stamp}_${index}`,
        branchId
    })));
    await upsertInventoryItems(copies);
    showToast(`${copies.length} artículo(s) copiados`, 'success');
    renderManageInventory();
}

export async function handleInventoryPanelClick(event) {
    const button = event.target.closest('[data-inventory-action]');
    if (!button) return;
    const { inventoryAction, branchId, id } = button.dataset;
    if (inventoryAction === 'select-branch') setSelectedBranch(branchId);
    if (inventoryAction === 'edit') openInventoryForm(getInventoryItems().find(item => item.id === id));
    if (inventoryAction === 'delete') await deleteManagedInventoryItem(id);
    if (inventoryAction === 'migrate-legacy') await migrateLegacyItems();
    if (inventoryAction === 'copy-from') await copyItemsFrom(branchId);
}
