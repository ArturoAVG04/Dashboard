import { formatMoney, escapeHtml, getLocalDateInputValue, createLocalDateFromInput } from '../core/date-utils.js';
import { showToast, scrollToTop } from '../core/ui-feedback.js';
import { getBranchById, getCustomBranches, productAvailableInBranch } from '../services/branches-service.js';
import { getCustomProducts } from '../services/products-service.js';
import { getOpenTables, updateTable, createTable, deleteTable } from '../services/tables-service.js';
import { saveTransaction, updateTransactionRecord } from '../services/transactions-service.js';
import { calculateItemsTotal } from '../models/Table.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';

let saleDraft = createEmptySaleDraft();
let activeSaleContext = { mode: 'sale', tableId: null };
let currentModProduct = null;
let currentModQty = 1;

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
    return customProducts.filter(product => productAvailableInBranch(product, branchId));
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
        saleProductsGrid.innerHTML = `<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted);">No hay productos disponibles para esta sucursal.</div>`;
        return;
    }

    saleProductsGrid.innerHTML = products.map(product => {
        const hasModifiers = Array.isArray(product.modifiers) && product.modifiers.length > 0;
        const matchingItems = saleDraft.items.filter(item => item.productId === product.id);
        const totalQty = matchingItems.reduce((sum, item) => sum + item.qty, 0);

        return `
            <article class="sale-product-card">
                <div class="category">${product.category}</div>
                <h4>${product.name}</h4>
                <div class="price">${formatMoney(product.price)}</div>
                ${hasModifiers ? `<span class="product-mod-badge"><i class="ph ph-sliders"></i> Opciones (${product.modifiers.length})</span>` : ''}
                
                ${hasModifiers ? `
                    ${totalQty > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-top: auto;">
                            <span style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">${totalQty} en pedido</span>
                            <button type="button" class="submit-btn" data-product-id="${product.id}" data-action="customize" style="margin-top: 0; padding: 0.6rem 0.75rem; font-size: 0.85rem;">
                                <i class="ph ph-plus"></i> Agregar otra
                            </button>
                        </div>
                    ` : `
                        <button type="button" class="submit-btn" data-product-id="${product.id}" data-action="customize" style="margin-top: auto;">
                            <i class="ph ph-sliders"></i> Opciones
                        </button>
                    `}
                ` : `
                    ${totalQty > 0 ? `
                        <div class="sale-product-controls" style="margin-top: auto;">
                            <button type="button" class="qty-btn" data-product-id="${product.id}" data-action="decrease">-</button>
                            <span class="qty-num">${totalQty}</span>
                            <button type="button" class="qty-btn" data-product-id="${product.id}" data-action="increase">+</button>
                        </div>
                    ` : `
                        <button type="button" class="submit-btn" data-product-id="${product.id}" data-action="add" style="margin-top: auto;">
                            <i class="ph ph-plus"></i> Agregar
                        </button>
                    `}
                `}
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
                <span class="mobile-summary-count">${totalItems} items en pedido</span>
            </div>
            <button type="button" class="mobile-summary-btn">
                Ver Pedido <i class="ph ph-arrow-right"></i>
            </button>
        `;
    } else {
        mobileSaleSummary.style.display = 'none';
    }
}

export function updateSaleModalMeta() {
    const branch = getBranchById(saleDraft.branchId);
    const isTableMode = activeSaleContext.mode === 'table';
    const isEditMode = activeSaleContext.mode === 'edit-transaction';

    const saleModalTitle = document.getElementById('sale-modal-title');
    const saleModalSubtitle = document.getElementById('sale-modal-subtitle');
    const salePrimaryAction = document.getElementById('sale-primary-action');
    const saleCloseTableBtn = document.getElementById('sale-close-table-btn');
    const saleTableBanner = document.getElementById('sale-table-banner');

    if (isTableMode) {
        if (saleModalTitle) saleModalTitle.textContent = 'Editar Mesa';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Agrega productos, ajusta cantidades y cobra cuando la mesa esté lista.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = '<i class="ph ph-floppy-disk"></i> Guardar Mesa';
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'flex';
        const openTables = getOpenTables();
        const table = openTables.find(item => item.id === activeSaleContext.tableId);
        if (saleTableBanner) {
            saleTableBanner.style.display = 'block';
            saleTableBanner.innerHTML = `<strong>${table?.name || 'Mesa abierta'}</strong> · ${branch?.name || 'Sucursal'} · ${saleDraft.items.reduce((sum, item) => sum + item.qty, 0)} productos`;
        }
    } else if (isEditMode) {
        if (saleModalTitle) saleModalTitle.textContent = 'Editar Venta';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Modifica los productos, cantidades o sucursal de esta venta.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = '<i class="ph ph-check-circle"></i> Actualizar Venta';
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'none';
        if (saleTableBanner) saleTableBanner.style.display = 'none';
    } else {
        if (saleModalTitle) saleModalTitle.textContent = 'Registrar Venta';
        if (saleModalSubtitle) saleModalSubtitle.textContent = 'Selecciona sucursal y arma el pedido.';
        if (salePrimaryAction) salePrimaryAction.innerHTML = `<i class="ph ${branch?.useTables ? 'ph-table' : 'ph-check-circle'}"></i> ${branch?.useTables ? 'Crear Mesa' : 'Guardar Venta'}`;
        if (saleCloseTableBtn) saleCloseTableBtn.style.display = 'none';
        if (saleTableBanner) {
            saleTableBanner.style.display = branch?.useTables ? 'block' : 'none';
            saleTableBanner.textContent = branch?.useTables
                ? 'Esta sucursal usa mesas. Al continuar se abrirá una nueva mesa para editar y cobrar después.'
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
        saleOrderItems.innerHTML = `<div class="card" style="padding: 1rem; text-align:center; color:var(--text-muted);">Todavía no agregas productos.</div>`;
        updateSaleModalMeta();
        updateMobileSaleSummary();
        return;
    }

    saleOrderItems.innerHTML = saleDraft.items.map(item => `
        <div class="sale-order-row">
            <div>
                <h4>${item.name}</h4>
                ${item.modifierText ? `<div class="sale-order-modifiers"><i class="ph ph-sliders"></i> ${escapeHtml(item.modifierText)}</div>` : ''}
                <div class="sale-order-meta">${formatMoney(item.price)} c/u · ${formatMoney(item.price * item.qty)}</div>
            </div>
            <div class="sale-order-controls">
                <button type="button" data-sale-action="decrease" data-id="${item.id || item.productId}">-</button>
                <span>${item.qty}</span>
                <button type="button" data-sale-action="increase" data-id="${item.id || item.productId}">+</button>
                <button type="button" class="delete" data-sale-action="remove" data-id="${item.id || item.productId}"><i class="ph ph-trash"></i></button>
            </div>
        </div>
    `).join('');

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

    const groups = Array.isArray(product.modifiers) ? product.modifiers : [];
    if (groups.length === 0) {
        addItemToCurrentSale(productId);
        return;
    }

    groups.forEach((group, gIdx) => {
        const groupSec = document.createElement('div');
        groupSec.className = 'mod-group-section';
        const isSingle = group.type === 'single';

        groupSec.innerHTML = `
            <div class="mod-group-header">
                <span class="mod-group-title">${escapeHtml(group.name)}</span>
                <span class="mod-group-tag">${isSingle ? 'Elige 1 opción' : 'Elige una o más opciones'}</span>
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

    const groups = Array.isArray(currentModProduct.modifiers) ? currentModProduct.modifiers : [];
    const selectedModifiers = [];

    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const group = groups[gIdx];
        const isSingle = group.type === 'single';
        const checked = modModalBody.querySelectorAll(`input[name="mod_group_${group.id || gIdx}"]:checked`);
        
        if (isSingle && checked.length === 0 && group.options.length > 0) {
            showToast(`Selecciona una opción para "${group.name}"`);
            return;
        }

        checked.forEach(input => {
            selectedModifiers.push({
                groupName: input.dataset.groupName,
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

export function addItemToCurrentSale(productId, options = {}) {
    const customProducts = getCustomProducts();
    const product = customProducts.find(item => item.id === productId);
    if (!product) return;

    const qty = Number(options.qty) || 1;
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
            modSignature
        });
    }

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
    renderSaleProducts();
    if (isStackedSaleLayout()) scrollSaleModalToTop();
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
    if (isStackedSaleLayout()) scrollSaleModalToTop();
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
    if (isStackedSaleLayout()) scrollSaleModalToTop();
}

export function handleSaleTotalInput() {
    const saleTotalInput = document.getElementById('sale-total-input');
    if (!saleTotalInput) return;
    const manualTotal = parseFloat(saleTotalInput.value);
    saleDraft.total = !isNaN(manualTotal) && manualTotal >= 0 ? manualTotal : calculateItemsTotal(saleDraft.items);
    persistActiveSaleDraft();
    renderSaleSummary();
    if (isStackedSaleLayout()) scrollSaleModalToTop('auto');
}

export function buildIncomeTransaction({ branchId, items, total, source = 'sale', date = new Date(), tableName = '' }) {
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
            category: customProducts.find(product => product.id === item.productId)?.category || ''
        })),
        products: items.map(item => ({ ...item })),
        source,
        date: date.toISOString(),
        createdAt: new Date().toISOString()
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
    renderSaleBranchOptions();
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
    scrollToTop();
}

export function closeSaleModal() {
    const saleModal = document.getElementById('sale-modal');
    if (saleModal) saleModal.classList.remove('open');
    activeSaleContext = { mode: 'sale', tableId: null };
    saleDraft = createEmptySaleDraft();
    setSaleMobilePanel('menu');
    scrollToTop();
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
                modSignature
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

    renderSaleBranchOptions();
    if (saleBranchSelect) saleBranchSelect.value = branchId;
    saleDraft.branchId = branchId;
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
    scrollToTop();
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
    renderSaleBranchOptions();
    if (saleBranchSelect) saleBranchSelect.value = table.branchId;
    saleDraft.branchId = table.branchId;
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    if (saleModal) saleModal.classList.add('open');
    scrollToTop();
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

        const updatedTx = buildIncomeTransaction({
            branchId,
            items: saleDraft.items,
            total: saleDraft.total,
            source: orig.source || 'sale',
            date: createLocalDateFromInput(saleDateInput?.value),
            tableName: orig.tableName || ''
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

    const newTx = buildIncomeTransaction({
        branchId,
        items: saleDraft.items,
        total: saleDraft.total,
        source: 'sale',
        date: createLocalDateFromInput(saleDateInput?.value)
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

    const saleDateInput = document.getElementById('sale-date-input');
    const transaction = buildIncomeTransaction({
        branchId: table.branchId,
        items: table.items,
        total: table.total,
        source: 'table',
        date: createLocalDateFromInput(saleDateInput?.value),
        tableName: table.name || ''
    });

    await saveTransaction(transaction);
    deleteTable(tableId);
    showToast(`${table.name} cobrada con éxito`);
    closeSaleModal();
    if (typeof onUpdate === 'function') onUpdate();
}
