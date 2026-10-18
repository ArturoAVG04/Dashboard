import { formatMoney, escapeHtml, getLocalDateInputValue, createLocalDateFromInput, getLocalTimeInputValue, combineLocalDateAndTime, getSaleTimestamp } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { getBranchById, getCustomBranches, productAvailableInBranch } from '../services/branches-service.js';
import { getCustomProducts } from '../services/products-service.js';
import { getProductModifierGroups } from '../services/modifier-groups-service.js';
import { describeModifierGroupRule } from '../models/ModifierGroup.js';
import { computeStockConsumption, getProductUsage } from '../models/Inventory.js';
import { ensureSessionForSale, getLiveStock } from '../services/sessions-service.js';
import { getInventoryItems, getBranchInventoryItems } from '../services/inventory-service.js';
import { getSessionLabelForSale } from './sessions-ui.js';
import { getOpenTables, updateTable, createTable, deleteTable } from '../services/tables-service.js';
import { saveTransaction, updateTransactionRecord } from '../services/transactions-service.js';
import { calculateItemsTotal } from '../models/Table.js';
import { sortProductsForBranch } from '../models/Product.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';

let saleDraft = createEmptySaleDraft();
let activeSaleContext = { mode: 'sale', tableId: null };
let currentModProduct = null;
let currentModQty = 1;

// --- Fecha y hora de la venta ---
// La hora se toma en automático (momento de guardar) salvo que el usuario la edite.
// Si la venta es de otro día y no se indica hora, se guarda como hora estimada.
export function resetSaleTimeInput({ time = null } = {}) {
    const saleTimeInput = document.getElementById('sale-time-input');
    if (!saleTimeInput) return;
    saleTimeInput.value = time || getLocalTimeInputValue();
    saleTimeInput.dataset.userEdited = time ? '1' : '';
    updateSaleTimeHint();
}

export function handleSaleTimeInput() {
    const saleTimeInput = document.getElementById('sale-time-input');
    if (saleTimeInput) saleTimeInput.dataset.userEdited = saleTimeInput.value ? '1' : '';
    updateSaleTimeHint();
}

export function handleSaleDateChange() {
    const saleDateInput = document.getElementById('sale-date-input');
    const saleTimeInput = document.getElementById('sale-time-input');
    if (!saleTimeInput || saleTimeInput.dataset.userEdited === '1') {
        updateSaleTimeHint();
        return;
    }
    const isToday = !saleDateInput?.value || saleDateInput.value === getLocalDateInputValue();
    saleTimeInput.value = isToday ? getLocalTimeInputValue() : '';
    updateSaleTimeHint();
}

function updateSaleTimeHint() {
    const saleDateInput = document.getElementById('sale-date-input');
    const saleTimeInput = document.getElementById('sale-time-input');
    const saleTimeHint = document.getElementById('sale-time-hint');
    if (!saleTimeHint) return;
    const isToday = !saleDateInput?.value || saleDateInput.value === getLocalDateInputValue();
    saleTimeHint.style.display = !isToday && !saleTimeInput?.value ? 'block' : 'none';
}

export function resolveSaleDateTime() {
    const saleDateInput = document.getElementById('sale-date-input');
    const saleTimeInput = document.getElementById('sale-time-input');
    const dateValue = saleDateInput?.value || getLocalDateInputValue();
    const userTime = saleTimeInput?.dataset.userEdited === '1' ? saleTimeInput.value : '';

    const combined = combineLocalDateAndTime(dateValue, userTime);
    if (combined) return { date: combined, soldAt: combined.toISOString() };

    if (dateValue === getLocalDateInputValue()) {
        const now = new Date();
        return { date: now, soldAt: now.toISOString() };
    }

    return { date: createLocalDateFromInput(dateValue), soldAt: null };
}

export function createEmptySaleDraft(overrides = {}) {
    return {
        branchId: '',
        items: [],
        total: 0,
        ...overrides
    };
}

export function getSaleDraft() {
    return saleDraft;
}

export function setSaleDraft(draft) {
    saleDraft = draft;
}

export function getActiveSaleContext() {
    return activeSaleContext;
}

export function setActiveSaleContext(ctx) {
    activeSaleContext = ctx;
}

export function isStackedSaleLayout() {
    return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
}

export function scrollSaleModalToTop(behavior = 'smooth') {
    const saleModal = document.getElementById('sale-modal');
    if (saleModal) {
        saleModal.scrollTo({ top: 0, behavior });
    }
}

export function setSaleMobilePanel(panel = 'menu') {
    const saleLayout = document.querySelector('.sale-layout');
    const saleMobileSwitch = document.getElementById('sale-mobile-switch');
    const mobileSaleSummary = document.getElementById('mobile-sale-summary');

    if (!saleLayout || !saleMobileSwitch) return;

    saleLayout.classList.remove('show-menu', 'show-order');
    saleLayout.classList.add(panel === 'order' ? 'show-order' : 'show-menu');

    saleMobileSwitch.querySelectorAll('[data-sale-panel]').forEach(button => {
        button.classList.toggle('active', button.dataset.salePanel === panel);
    });

    if (mobileSaleSummary) {
        mobileSaleSummary.style.display = (panel === 'menu' && saleDraft.items.length > 0) ? 'flex' : 'none';
    }
}

export function renderSaleBranchOptions() {
    const select = document.getElementById('sale-branch-select');
    if (!select) return;

    const customBranches = getCustomBranches();
    const currentVal = select.value;
    select.innerHTML = customBranches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

    if (currentVal && customBranches.some(b => b.id === currentVal)) {
        select.value = currentVal;
    } else if (saleDraft.branchId && customBranches.some(b => b.id === saleDraft.branchId)) {
        select.value = saleDraft.branchId;
    } else if (customBranches[0]) {
        select.value = customBranches[0].id;
    }
}

export function getProductsForBranch(branchId) {
    const customProducts = getCustomProducts();
    return sortProductsForBranch(customProducts.filter(product => productAvailableInBranch(product, branchId)), getBranchById(branchId));
}

export function renderSaleProducts() {
    const saleProductsGrid = document.getElementById('sale-products-grid');
    const saleBranchSelect = document.getElementById('sale-branch-select');
    if (!saleProductsGrid) return;

    const customBranches = getCustomBranches();
    const branchId = saleBranchSelect?.value || saleDraft.branchId || customBranches[0]?.id || '';
    saleDraft.branchId = branchId;
    const products = getProductsForBranch(branchId);

    if (products.length === 0) {
        saleProductsGrid.innerHTML = `<div class="empty-state"><i class="ph ph-hamburger"></i><p>No hay productos disponibles para esta sucursal.</p></div>`;
        return;
    }

    const liveStock = getSaleLiveStock();
    const available = liveStock ? getAvailableAfterDraft(liveStock) : null;

    // Toda la tarjeta agrega el producto (objetivo táctil grande); los botones internos ajustan cantidades.
    saleProductsGrid.innerHTML = products.map(product => {
        const availability = available ? getProductAvailability(product, available) : null;
        const stockBadge = availability === null ? ''
            : availability <= 0 ? '<span class="stock-badge is-out">Agotado</span>'
            : `<span class="stock-badge${availability <= 3 ? ' is-low' : ''}">Quedan ${availability}</span>`;
        const modifierGroups = getProductModifierGroups(product);
        const hasModifiers = modifierGroups.length > 0;
        const matchingItems = saleDraft.items.filter(item => item.productId === product.id);
        const totalQty = matchingItems.reduce((sum, item) => sum + item.qty, 0);
        const name = escapeHtml(product.name);

        let action;
        if (hasModifiers) {
            action = `<button type="button" class="btn btn-secondary btn-sm btn-block" data-product-id="${product.id}" data-action="customize">
                    <i class="ph ph-sliders"></i> ${totalQty > 0 ? 'Agregar otra' : 'Elegir opciones'}
                </button>`;
        } else if (totalQty > 0) {
            action = `<div class="stepper stepper-block">
                    <button type="button" class="stepper-btn" data-product-id="${product.id}" data-action="decrease" aria-label="Quitar ${name}"><i class="ph ph-minus"></i></button>
                    <span class="stepper-value">${totalQty}</span>
                    <button type="button" class="stepper-btn" data-product-id="${product.id}" data-action="increase" aria-label="Agregar ${name}"><i class="ph ph-plus"></i></button>
                </div>`;
        } else {
            action = `<button type="button" class="btn btn-primary btn-sm btn-block" data-product-id="${product.id}" data-action="add">
                    <i class="ph ph-plus"></i> Agregar
                </button>`;
        }

        return `
            <article class="sale-product-card${totalQty > 0 ? ' in-order' : ''}${availability === 0 ? ' is-sold-out' : ''}" data-product-id="${product.id}">
                <div class="sale-product-top">
                    <span class="category">${escapeHtml(product.category)}</span>
                    ${totalQty > 0 ? `<span class="qty-badge" aria-label="${totalQty} en el pedido">${totalQty}</span>` : ''}
                </div>
                <h4>${name}</h4>
                <div class="price">${formatMoney(product.price)}</div>
                ${stockBadge}
                ${hasModifiers ? `<span class="product-mod-badge"><i class="ph ph-sliders"></i> ${modifierGroups.map(group => escapeHtml(group.name)).join(' · ')}</span>` : ''}
                <div class="sale-product-action">${action}</div>
            </article>
        `;
    }).join('');
}

export function updateMobileSaleSummary() {
    const mobileSaleSummary = document.getElementById('mobile-sale-summary');
    const saleLayout = document.querySelector('.sale-layout');
    if (!mobileSaleSummary || !saleLayout) return;

    if (saleDraft.items.length === 0) {
        mobileSaleSummary.style.display = 'none';
        return;
    }

    const totalItems = saleDraft.items.reduce((sum, item) => sum + item.qty, 0);
    const isMenuPanel = !saleLayout.classList.contains('show-order');

    if (isMenuPanel) {
        mobileSaleSummary.style.display = 'flex';
        mobileSaleSummary.innerHTML = `
            <div class="mobile-summary-info">
                <span class="mobile-summary-total">${formatMoney(saleDraft.total)}</span>
                <span class="mobile-summary-count">${totalItems} producto${totalItems === 1 ? '' : 's'} en el pedido</span>
            </div>
            <button type="button" class="btn btn-success mobile-summary-btn">
                Ver pedido <i class="ph ph-arrow-right"></i>
            </button>
        `;
    } else {
        mobileSaleSummary.style.display = 'none';
    }
}

function updateSaleSessionBanner() {
    const banner = document.getElementById('sale-session-banner');
    if (!banner) return;
    const label = activeSaleContext.mode === 'edit-transaction' ? null : getSessionLabelForSale(saleDraft.branchId);
    banner.style.display = label ? 'flex' : 'none';
    banner.className = `sale-session-banner${label?.tone === 'warning' ? ' is-warning' : ''}`;
    banner.innerHTML = label ? `<i class="ph ${label.tone === 'warning' ? 'ph-warning' : 'ph-broadcast'}"></i> <span>${escapeHtml(label.text)}</span>` : '';
}

export function updateSaleModalMeta() {
    updateSaleSessionBanner();
    const branch = getBranchById(saleDraft.branchId);
    const isTableMode = activeSaleContext.mode === 'table';
    const isEditMode = activeSaleContext.mode === 'edit-transaction';

    const saleModalTitle = document.getElementById('sale-modal-title');
    const saleModalSubtitle = document.getElementById('sale-modal-subtitle');
    const salePrimaryAction = document.getElementById('sale-primary-action');
    const saleCloseTableBtn = document.getElementById('sale-close-table-btn');
    const saleTableBanner = document.getElementById('sale-table-banner');

    if (isTableMode) {
        if (saleModalTitle) saleModalTitle.textContent = 'Editar mesa';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Agrega productos, ajusta cantidades y cobra cuando la mesa esté lista.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = '<i class="ph ph-floppy-disk"></i> Guardar mesa';
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'flex';
        const openTables = getOpenTables();
        const table = openTables.find(item => item.id === activeSaleContext.tableId);
        if (saleTableBanner) {
            saleTableBanner.style.display = 'block';
            saleTableBanner.innerHTML = `<i class="ph ph-table"></i> <span><strong>${escapeHtml(table?.name || 'Mesa abierta')}</strong> · ${escapeHtml(branch?.name || 'Sucursal')} · ${saleDraft.items.reduce((sum, item) => sum + item.qty, 0)} productos</span>`;
        }
    } else if (isEditMode) {
        if (saleModalTitle) saleModalTitle.textContent = 'Editar venta';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Modifica los productos, cantidades o sucursal de esta venta.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = '<i class="ph ph-check-circle"></i> Actualizar venta';
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'none';
        if (saleTableBanner) saleTableBanner.style.display = 'none';
    } else {
        if (saleModalTitle) saleModalTitle.textContent = 'Registrar venta';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Selecciona sucursal y arma el pedido.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = `<i class="ph ${branch?.useTables ? 'ph-table' : 'ph-check-circle'}"></i> ${branch?.useTables ? 'Crear mesa' : 'Guardar venta'}`;
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'none';
        if (saleTableBanner) {
            saleTableBanner.style.display = branch?.useTables ? 'block' : 'none';
            saleTableBanner.innerHTML = branch?.useTables
                ? '<i class="ph ph-info"></i> <span>Esta sucursal usa mesas: al continuar se abre una mesa nueva para cobrar después.</span>'
                : '';
        }
    }
}

export function renderSaleSummary() {
    const saleOrderItems = document.getElementById('sale-order-items');
    const saleItemsCount = document.getElementById('sale-items-count');
    const saleTotalDisplay = document.getElementById('sale-total-display');
    const saleTotalInput = document.getElementById('sale-total-input');

    if (!saleOrderItems) return;

    const totalItems = saleDraft.items.reduce((sum, item) => sum + item.qty, 0);
    if (saleItemsCount) saleItemsCount.textContent = `${totalItems} producto${totalItems === 1 ? '' : 's'}`;
    if (saleTotalDisplay) saleTotalDisplay.textContent = formatMoney(saleDraft.total);
    if (saleTotalInput) saleTotalInput.value = saleDraft.total > 0 ? String(saleDraft.total) : '';

    if (saleDraft.items.length === 0) {
        saleOrderItems.innerHTML = `<div class="empty-state empty-state-compact"><i class="ph ph-shopping-bag"></i><p>Todavía no agregas productos.</p><small>Toca un producto del menú para agregarlo.</small></div>`;
        updateSaleModalMeta();
        updateMobileSaleSummary();
        return;
    }

    saleOrderItems.innerHTML = saleDraft.items.map(item => {
        const itemId = item.id || item.productId;
        const name = escapeHtml(item.name);
        return `
        <div class="sale-order-row">
            <div class="sale-order-info">
                <h4>${name}</h4>
                ${item.modifierText ? `<div class="sale-order-modifiers"><i class="ph ph-sliders"></i> ${escapeHtml(item.modifierText)}</div>` : ''}
                <div class="sale-order-meta">${formatMoney(item.price)} c/u</div>
            </div>
            <div class="sale-order-side">
                <strong class="sale-order-line-total">${formatMoney(item.price * item.qty)}</strong>
                <div class="sale-order-controls">
                    <div class="stepper stepper-sm">
                        <button type="button" class="stepper-btn" data-sale-action="decrease" data-id="${itemId}" aria-label="Quitar uno de ${name}"><i class="ph ph-minus"></i></button>
                        <span class="stepper-value">${item.qty}</span>
                        <button type="button" class="stepper-btn" data-sale-action="increase" data-id="${itemId}" aria-label="Agregar uno de ${name}"><i class="ph ph-plus"></i></button>
                    </div>
                    <button type="button" class="btn-icon btn-icon-danger" data-sale-action="remove" data-id="${itemId}" aria-label="Eliminar ${name}"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        </div>
    `;
    }).join('');

    updateSaleModalMeta();
    updateMobileSaleSummary();
}

export function syncSaleDraftTotal() {
    saleDraft.total = calculateItemsTotal(saleDraft.items);
}

export function persistActiveSaleDraft() {
    if (activeSaleContext.mode !== 'table' || !activeSaleContext.tableId) return;
    updateTable(activeSaleContext.tableId, {
        branchId: saleDraft.branchId,
        items: saleDraft.items,
        total: saleDraft.total
    });
}

export function openModifiersModal(productId) {
    const customProducts = getCustomProducts();
    const product = customProducts.find(p => p.id === productId);
    if (!product) return;

    currentModProduct = product;
    currentModQty = 1;

    const modModalProdName = document.getElementById('mod-modal-prod-name');
    const modModalProdPrice = document.getElementById('mod-modal-prod-price');
    const modQtyVal = document.getElementById('mod-qty-val');
    const modModalBody = document.getElementById('modifiers-modal-body');
    const modifiersModal = document.getElementById('modifiers-modal');

    if (modModalProdName) modModalProdName.textContent = `Personalizar ${product.name}`;
    if (modModalProdPrice) modModalProdPrice.textContent = formatMoney(product.price);
    if (modQtyVal) modQtyVal.textContent = '1';

    if (!modModalBody) return;
    modModalBody.innerHTML = '';

    const groups = getProductModifierGroups(product);
    if (groups.length === 0) {
        addItemToCurrentSale(productId);
        return;
    }

    groups.forEach((group, gIdx) => {
        const groupSec = document.createElement('div');
        groupSec.className = 'mod-group-section';
        groupSec.dataset.groupId = group.id || gIdx;
        groupSec.dataset.maxSelect = group.maxSelect || '';
        const isSingle = group.type === 'single';

        groupSec.innerHTML = `
            <div class="mod-group-header">
                <span class="mod-group-title">${escapeHtml(group.name)}</span>
                <span class="mod-group-tag">${escapeHtml(describeModifierGroupRule(group))}</span>
            </div>
            <div class="mod-options-container">
                ${group.options.map((opt, oIdx) => `
                    <label class="mod-option-row">
                        <input type="${isSingle ? 'radio' : 'checkbox'}" 
                               name="mod_group_${group.id || gIdx}" 
                               value="${opt.id || oIdx}" 
                               data-group-id="${group.id || gIdx}"
                               data-group-name="${escapeHtml(group.name)}"
                               data-opt-id="${opt.id || oIdx}"
                               data-opt-name="${escapeHtml(opt.name)}"
                               data-opt-price="${opt.price || 0}"
                               ${isSingle && oIdx === 0 ? 'checked' : ''}>
                        <div class="mod-option-info">
                            <span class="mod-opt-name">${escapeHtml(opt.name)}</span>
                            ${opt.price > 0 ? `<span class="mod-opt-extra">+${formatMoney(opt.price)}</span>` : ''}
                        </div>
                    </label>
                `).join('')}
            </div>
        `;
        modModalBody.appendChild(groupSec);
    });

    updateModifiersModalTotal();
    if (modifiersModal) modifiersModal.classList.add('open');
}

// Respeta el máximo de opciones de un grupo al marcar casillas
export function enforceModifierMaxSelect(input) {
    if (!input || input.type !== 'checkbox' || !input.checked) return;
    const section = input.closest('.mod-group-section');
    const max = Number(section?.dataset.maxSelect) || 0;
    if (!max) return;
    const checked = section.querySelectorAll('input[type="checkbox"]:checked');
    if (checked.length > max) {
        input.checked = false;
        showToast(`Máximo ${max} opción${max === 1 ? '' : 'es'} en este grupo`);
    }
}

export function closeModifiersModal() {
    const modifiersModal = document.getElementById('modifiers-modal');
    if (modifiersModal) modifiersModal.classList.remove('open');
    currentModProduct = null;
    currentModQty = 1;
}

export function updateModifiersModalTotal() {
    const modModalBody = document.getElementById('modifiers-modal-body');
    const modModalTotal = document.getElementById('mod-modal-total');
    if (!currentModProduct || !modModalBody || !modModalTotal) return;

    let extraSum = 0;
    const checkedInputs = modModalBody.querySelectorAll('input:checked');
    checkedInputs.forEach(input => {
        extraSum += (Number(input.dataset.optPrice) || 0);
    });

    const unitPrice = (Number(currentModProduct.price) || 0) + extraSum;
    const total = unitPrice * currentModQty;
    modModalTotal.textContent = formatMoney(total);
}

export function confirmAddProductWithModifiers() {
    const modModalBody = document.getElementById('modifiers-modal-body');
    if (!currentModProduct || !modModalBody) return;

    const groups = getProductModifierGroups(currentModProduct);
    const selectedModifiers = [];

    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const group = groups[gIdx];
        const isSingle = group.type === 'single';
        const checked = modModalBody.querySelectorAll(`input[name="mod_group_${group.id || gIdx}"]:checked`);
        
        if ((isSingle || group.required) && checked.length === 0 && group.options.length > 0) {
            showToast(`Selecciona una opción para "${group.name}"`);
            return;
        }
        if (group.maxSelect && checked.length > group.maxSelect) {
            showToast(`En "${group.name}" puedes elegir máximo ${group.maxSelect}`);
            return;
        }

        checked.forEach(input => {
            selectedModifiers.push({
                groupId: input.dataset.groupId,
                groupName: input.dataset.groupName,
                optionId: input.dataset.optId,
                optionName: input.dataset.optName,
                price: Number(input.dataset.optPrice) || 0
            });
        });
    }

    const modifierText = selectedModifiers.map(m => m.optionName).join(', ');

    addItemToCurrentSale(currentModProduct.id, {
        qty: currentModQty,
        selectedModifiers,
        modifierText
    });

    closeModifiersModal();
}

// ---------- Existencias en vivo (sucursales con inventario y jornada abierta) ----------
function getSaleLiveStock() {
    if (activeSaleContext.mode === 'edit-transaction') return null; // la venta ya está contada
    return getLiveStock(saleDraft.branchId);
}

// Piezas disponibles por artículo descontando lo que ya va en este pedido
function getAvailableAfterDraft(liveStock) {
    const draftUse = new Map(computeStockConsumption(saleDraft.items, getBranchInventoryItems(saleDraft.branchId)).map(entry => [entry.itemId, entry.qty]));
    const available = new Map();
    liveStock.forEach((entry, itemId) => {
        if (entry.loaded > 0) available.set(itemId, entry.remaining - (draftUse.get(itemId) || 0));
    });
    return available;
}

// Cuántos más se pueden vender de un producto (null si no descuenta artículos cargados hoy)
function getProductAvailability(product, available) {
    const usage = getProductUsage(product.id, getBranchInventoryItems(saleDraft.branchId)).filter(entry => available.has(entry.itemId));
    if (usage.length === 0) return null;
    return Math.max(0, Math.min(...usage.map(entry => Math.floor((available.get(entry.itemId) + 1e-9) / entry.qty))));
}

function confirmIfSoldOut(product, qty) {
    const liveStock = getSaleLiveStock();
    if (!liveStock) return true;
    const available = getAvailableAfterDraft(liveStock);
    const shortItems = getProductUsage(product.id, getBranchInventoryItems(saleDraft.branchId))
        .filter(entry => available.has(entry.itemId) && available.get(entry.itemId) - entry.qty * qty < 0)
        .map(entry => getInventoryItems().find(item => item.id === entry.itemId)?.name || 'un artículo');
    if (shortItems.length === 0) return true;
    return confirm(`Según el inventario cargado ya no queda ${shortItems.join(' ni ')}. ¿Agregar de todos modos?`);
}

export function addItemToCurrentSale(productId, options = {}) {
    const customProducts = getCustomProducts();
    const product = customProducts.find(item => item.id === productId);
    if (!product) return;

    const qty = Number(options.qty) || 1;
    if (!confirmIfSoldOut(product, qty)) return;
    const selectedModifiers = Array.isArray(options.selectedModifiers) ? options.selectedModifiers : [];
    const modifierText = options.modifierText || '';
    const modSignature = options.modSignature || selectedModifiers.map(m => `${m.groupName}:${m.optionName}`).sort().join('|');
    const extraPrice = selectedModifiers.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
    const unitPrice = (Number(product.price) || 0) + extraPrice;

    const existing = saleDraft.items.find(item => 
        item.productId === productId && 
        ((item.modSignature && item.modSignature === modSignature) || 
         (!item.modSignature && !modSignature && (item.modifierText || '') === modifierText))
    );

    if (existing) {
        existing.qty += qty;
    } else {
        saleDraft.items.push({
            id: `item_${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            productId: product.id,
            name: product.name,
            basePrice: product.price,
            price: unitPrice,
            qty,
            selectedModifiers,
            modifierText,
            modSignature,
            ...(activeSaleContext.mode !== 'edit-transaction' ? { addedAt: new Date().toISOString() } : {})
        });
    }

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
    renderSaleProducts();
    showToast(`+${qty} ${product.name}${modifierText ? ` (${modifierText})` : ''}`);
}

export function updateCurrentSaleItemQty(itemIdOrProductId, delta) {
    let targetIndex = saleDraft.items.findIndex(item => item.id === itemIdOrProductId);
    
    if (targetIndex === -1) {
        if (delta < 0) {
            for (let i = saleDraft.items.length - 1; i >= 0; i--) {
                if (saleDraft.items[i].productId === itemIdOrProductId) {
                    targetIndex = i;
                    break;
                }
            }
        } else {
            targetIndex = saleDraft.items.findIndex(item => item.productId === itemIdOrProductId);
        }
    }

    if (targetIndex === -1) return;

    saleDraft.items[targetIndex].qty += delta;
    if (saleDraft.items[targetIndex].qty <= 0) {
        saleDraft.items.splice(targetIndex, 1);
    }

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
    renderSaleProducts();
}

export function removeItemFromCurrentSale(itemIdOrProductId) {
    let targetIndex = saleDraft.items.findIndex(item => item.id === itemIdOrProductId);
    if (targetIndex === -1) {
        targetIndex = saleDraft.items.findIndex(item => item.productId === itemIdOrProductId);
    }

    if (targetIndex !== -1) {
        saleDraft.items.splice(targetIndex, 1);
    } else {
        saleDraft.items = saleDraft.items.filter(item => item.productId !== itemIdOrProductId);
    }

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
    renderSaleProducts();
}

export function handleSaleTotalInput() {
    const saleTotalInput = document.getElementById('sale-total-input');
    if (!saleTotalInput) return;
    const manualTotal = parseFloat(saleTotalInput.value);
    saleDraft.total = !isNaN(manualTotal) && manualTotal >= 0 ? manualTotal : calculateItemsTotal(saleDraft.items);
    persistActiveSaleDraft();
    renderSaleSummary();
}

function stockConsumptionField(items, branchId) {
    const consumption = computeStockConsumption(items, getBranchInventoryItems(branchId));
    return consumption.length > 0 ? { stockConsumption: consumption } : {};
}

export function buildIncomeTransaction({ branchId, items, total, source = 'sale', date = new Date(), soldAt = null, tableName = '', createdAt = null, sessionId = null }) {
    const branch = getBranchById(branchId);
    const customProducts = getCustomProducts();
    const desc = items.length > 0
        ? items.map(item => `${item.qty}x ${item.name}${item.modifierText ? ` (${item.modifierText})` : ''}`).join(', ')
        : 'Venta General';

    return {
        type: 'income',
        amount: Number(total) || 0,
        desc,
        category: 'Venta',
        branch: branchId || '',
        zone: branch?.name || '',
        branchId: branchId || '',
        tableName: tableName || '',
        itemsSoldArray: items.map(item => ({
            productId: item.productId,
            name: item.modifierText ? `${item.name} (${item.modifierText})` : item.name,
            rawName: item.name,
            qty: Number(item.qty) || 0,
            price: Number(item.price) || 0,
            total: (Number(item.price) || 0) * (Number(item.qty) || 0),
            modifiers: item.selectedModifiers || [],
            modifierText: item.modifierText || '',
            category: customProducts.find(product => product.id === item.productId)?.category || '',
            ...(item.addedAt ? { addedAt: item.addedAt } : {})
        })),
        products: items.map(item => ({ ...item })),
        // Snapshot de lo que consumió del inventario (F4); si después cambia la receta, esta venta no cambia
        ...stockConsumptionField(items, branchId),
        // Jornada a la que pertenece la venta (F5)
        ...(sessionId ? { sessionId } : {}),
        source,
        date: date.toISOString(),
        // soldAt: hora real de la venta. Sin ella, la hora se considera estimada (ventas de otro día sin hora).
        ...(soldAt ? { soldAt, timeEstimated: false } : { timeEstimated: true }),
        createdAt: createdAt || new Date().toISOString()
    };
}

export function startNewSale() {
    const customBranches = getCustomBranches();
    if (customBranches.length === 0) {
        showToast("Crea al menos una sucursal antes de registrar ventas");
        return;
    }
    activeSaleContext = { mode: 'sale', tableId: null };
    
    let initialBranchId = customBranches[0]?.id || '';
    const lastBranchId = loadLocalState(STORAGE_KEYS.lastBranch, null);
    if (lastBranchId && customBranches.some(b => b.id === lastBranchId)) {
        initialBranchId = lastBranchId;
    }

    saleDraft = createEmptySaleDraft({ branchId: initialBranchId });
    const saleDateInput = document.getElementById('sale-date-input');
    const saleModal = document.getElementById('sale-modal');

    if (saleDateInput) saleDateInput.value = getLocalDateInputValue();
    resetSaleTimeInput();
    renderSaleBranchOptions();
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
}

export function closeSaleModal() {
    const saleModal = document.getElementById('sale-modal');
    if (saleModal) saleModal.classList.remove('open');
    activeSaleContext = { mode: 'sale', tableId: null };
    saleDraft = createEmptySaleDraft();
    setSaleMobilePanel('menu');
}

export function openSaleEditor(transaction) {
    if (!transaction) return;

    const customBranches = getCustomBranches();
    const customProducts = getCustomProducts();
    let branchId = transaction.branchId || transaction.branch || '';
    if (!customBranches.some(b => b.id === branchId)) {
        const matchingByName = customBranches.find(b => b.name === transaction.zone || b.name === transaction.branch);
        if (matchingByName) {
            branchId = matchingByName.id;
        } else {
            branchId = customBranches[0]?.id || '';
        }
    }

    let items = [];
    if (Array.isArray(transaction.itemsSoldArray) && transaction.itemsSoldArray.length > 0) {
        items = transaction.itemsSoldArray.map((item, idx) => {
            const product = customProducts.find(p => p.id === item.productId || p.name === (item.rawName || item.name));
            const prodId = item.productId || product?.id || `p_${idx}`;
            const prodName = item.rawName || product?.name || item.name;
            const selectedModifiers = Array.isArray(item.modifiers) 
                ? item.modifiers 
                : (Array.isArray(item.selectedModifiers) ? item.selectedModifiers : []);
            const modifierText = item.modifierText || '';
            const modSignature = selectedModifiers.map(m => `${m.groupName}:${m.optionName}`).sort().join('|');
            const qty = Number(item.qty) || 1;
            const price = Number(item.price) || (Number(item.total) / qty) || (product?.price || 0);

            return {
                id: `item_${prodId}_${Date.now()}_${idx}`,
                productId: prodId,
                name: prodName,
                basePrice: product?.price || price,
                price,
                qty,
                selectedModifiers,
                modifierText,
                modSignature,
                ...(item.addedAt ? { addedAt: item.addedAt } : {})
            };
        });
    }

    activeSaleContext = {
        mode: 'edit-transaction',
        transactionId: transaction.id,
        originalTransaction: transaction
    };

    saleDraft = createEmptySaleDraft({
        branchId,
        items,
        total: typeof transaction.amount === 'number' ? transaction.amount : calculateItemsTotal(items)
    });

    const saleDateInput = document.getElementById('sale-date-input');
    const saleBranchSelect = document.getElementById('sale-branch-select');
    const saleModal = document.getElementById('sale-modal');

    if (saleDateInput) {
        saleDateInput.value = transaction.date ? getLocalDateInputValue(new Date(transaction.date)) : getLocalDateInputValue();
    }
    const saleTimestamp = getSaleTimestamp(transaction);
    if (saleTimestamp.date && !saleTimestamp.estimated) {
        resetSaleTimeInput({ time: getLocalTimeInputValue(saleTimestamp.date) });
    } else {
        resetSaleTimeInput();
        const saleTimeInput = document.getElementById('sale-time-input');
        if (saleTimeInput) saleTimeInput.value = '';
        updateSaleTimeHint();
    }

    renderSaleBranchOptions();
    if (saleBranchSelect) saleBranchSelect.value = branchId;
    saleDraft.branchId = branchId;
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
}

export function openTableEditor(tableId) {
    const openTables = getOpenTables();
    const table = openTables.find(item => item.id === tableId);
    if (!table) return;

    activeSaleContext = { mode: 'table', tableId };
    saleDraft = createEmptySaleDraft({
        branchId: table.branchId,
        items: table.items.map(item => ({ ...item })),
        total: Number(table.total) || calculateItemsTotal(table.items)
    });

    const saleDateInput = document.getElementById('sale-date-input');
    const saleBranchSelect = document.getElementById('sale-branch-select');
    const saleModal = document.getElementById('sale-modal');

    if (saleDateInput) saleDateInput.value = getLocalDateInputValue();
    resetSaleTimeInput();
    renderSaleBranchOptions();
    if (saleBranchSelect) saleBranchSelect.value = table.branchId;
    saleDraft.branchId = table.branchId;
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
}

export function handleSaleBranchChange() {
    const saleBranchSelect = document.getElementById('sale-branch-select');
    const customBranches = getCustomBranches();
    saleDraft.branchId = saleBranchSelect?.value || customBranches[0]?.id || '';
    saveLocalState(STORAGE_KEYS.lastBranch, saleDraft.branchId);
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
}

export async function handleSalePrimaryAction({ onUpdate, switchView } = {}) {
    const saleBranchSelect = document.getElementById('sale-branch-select');
    const saleDateInput = document.getElementById('sale-date-input');
    const customBranches = getCustomBranches();
    const branchId = saleBranchSelect?.value || saleDraft.branchId || customBranches[0]?.id || '';
    const branch = getBranchById(branchId);

    if (!branch) {
        showToast("Selecciona una sucursal");
        return;
    }

    saleDraft.branchId = branchId;

    if (activeSaleContext.mode === 'edit-transaction' && activeSaleContext.transactionId) {
        const transactionId = activeSaleContext.transactionId;
        const orig = activeSaleContext.originalTransaction || {};

        if (saleDraft.total <= 0) {
            showToast("Agrega productos o un total válido");
            return;
        }

        const saleDateTime = resolveEditedSaleDateTime(orig, saleDateInput?.value);
        const updatedTx = buildIncomeTransaction({
            branchId,
            items: saleDraft.items,
            total: saleDraft.total,
            source: orig.source || 'sale',
            date: saleDateTime.date,
            soldAt: saleDateTime.soldAt,
            tableName: orig.tableName || '',
            sessionId: orig.sessionId || null,
            createdAt: orig.createdAt || null
        });

        await updateTransactionRecord(transactionId, updatedTx);
        showToast("Venta actualizada con éxito");
        closeSaleModal();
        if (typeof onUpdate === 'function') onUpdate();
        return;
    }

    if (branch.useTables && activeSaleContext.mode !== 'table') {
        const table = createTable(branchId, saleDraft.items, saleDraft.total);
        showToast(`${table.name} creada`);
        closeSaleModal();
        if (typeof onUpdate === 'function') onUpdate();
        if (typeof switchView === 'function') switchView('tables');
        return;
    }

    if (saleDraft.total <= 0) {
        showToast("Agrega productos o un total válido");
        return;
    }

    if (activeSaleContext.mode === 'table' && activeSaleContext.tableId) {
        updateTable(activeSaleContext.tableId, {
            branchId,
            items: saleDraft.items,
            total: saleDraft.total
        });
        showToast("Mesa actualizada");
        closeSaleModal();
        if (typeof onUpdate === 'function') onUpdate();
        if (typeof switchView === 'function') switchView('tables');
        return;
    }

    const saleDateTime = resolveSaleDateTime();
    const session = await ensureSessionForSale(branchId, saleDateTime.date);
    const newTx = buildIncomeTransaction({
        branchId,
        items: saleDraft.items,
        total: saleDraft.total,
        source: 'sale',
        ...saleDateTime,
        sessionId: session?.id || null
    });

    await saveTransaction(newTx);
    showToast("Venta guardada con éxito");
    closeSaleModal();
    if (typeof onUpdate === 'function') onUpdate();
}

export async function handleCloseActiveTable({ onUpdate } = {}) {
    if (activeSaleContext.mode !== 'table' || !activeSaleContext.tableId) return;
    const tableId = activeSaleContext.tableId;
    const openTables = getOpenTables();
    const table = openTables.find(item => item.id === tableId);
    if (!table) return;

    if ((Number(table.total) || 0) <= 0) {
        showToast("La mesa no tiene total para cobrar");
        return;
    }

    const saleDateTime = resolveSaleDateTime();
    const session = await ensureSessionForSale(table.branchId, saleDateTime.date);
    const transaction = buildIncomeTransaction({
        branchId: table.branchId,
        items: table.items,
        total: table.total,
        source: 'table',
        ...saleDateTime,
        tableName: table.name || '',
        sessionId: session?.id || null
    });

    await saveTransaction(transaction);
    deleteTable(tableId);
    showToast(`${table.name} cobrada con éxito`);
    closeSaleModal();
    if (typeof onUpdate === 'function') onUpdate();
}

// Al editar una venta: si no se indica hora y la fecha no cambió, se conserva la fecha/hora original.
function resolveEditedSaleDateTime(originalTransaction, dateValue) {
    const saleTimeInput = document.getElementById('sale-time-input');
    const userTime = saleTimeInput?.dataset.userEdited === '1' ? saleTimeInput.value : '';
    const combined = combineLocalDateAndTime(dateValue || getLocalDateInputValue(), userTime);
    if (combined) return { date: combined, soldAt: combined.toISOString() };

    const originalDate = originalTransaction?.date ? new Date(originalTransaction.date) : null;
    if (originalDate && !isNaN(originalDate.getTime()) && getLocalDateInputValue(originalDate) === dateValue) {
        return { date: originalDate, soldAt: originalTransaction.soldAt || null };
    }

    return { date: createLocalDateFromInput(dateValue), soldAt: null };
}
