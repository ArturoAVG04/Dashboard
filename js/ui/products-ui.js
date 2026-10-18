import { escapeHtml, formatMoney } from '../core/date-utils.js';
import { showToast } from '../core/ui-feedback.js';
import { getCustomProducts, commitProducts, getCustomCategories, commitCategories } from '../services/products-service.js';
import { getCustomBranches, commitBranches, getBranchById, productAvailableInBranch, hasDuplicateName, sortNamedListAlphabetically, getStableBranchColor } from '../services/branches-service.js';
import { upsertProduct, removeProductById, moveProductInList, normalizeProduct, sortProductsForBranch } from '../models/Product.js';
import { usesSharedModifiers, hasLegacyModifiers, resolveProductModifierGroups, describeModifierGroupRule } from '../models/ModifierGroup.js';
import { getModifierGroups } from '../services/modifier-groups-service.js';
import { WEEK_DAYS, getBranchSessionConfig, normalizeSchedule, describeSchedule } from '../models/BranchConfig.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';

let editingProductId = null;
let editingCategoryId = null;
let editingBranchId = null;

// ---------- Modificadores y consumo de inventario en el formulario de producto ----------
function renderProductModifierChooser(product = null) {
    const container = document.getElementById('manage-product-modifier-groups');
    const legacyNotice = document.getElementById('manage-product-legacy-modifiers');
    if (!container) return;

    const groups = getModifierGroups();
    const selected = new Set(usesSharedModifiers(product) ? product.modifierGroupIds : []);
    container.innerHTML = groups.length > 0
        ? groups.map(group => `
            <label class="check-chip">
                <input type="checkbox" name="manage_product_modifier" value="${escapeHtml(group.id)}" ${selected.has(group.id) ? 'checked' : ''}>
                <span>${escapeHtml(group.name)} <small class="muted-text">${escapeHtml(describeModifierGroupRule(group))}</small></span>
            </label>
        `).join('')
        : '<p class="field-hint">Aún no hay modificadores. Créalos en la pestaña Modificadores.</p>';

    if (legacyNotice) {
        const legacy = product && hasLegacyModifiers(product) ? resolveProductModifierGroups(product, []) : [];
        legacyNotice.style.display = legacy.length > 0 ? 'flex' : 'none';
        legacyNotice.innerHTML = legacy.length > 0
            ? `<i class="ph ph-info"></i><span>Este producto usa modificadores del sistema anterior (${legacy.map(g => escapeHtml(g.name)).join(', ')}). Siguen funcionando; conviértelos desde la pestaña Modificadores. Si eliges modificadores aquí, reemplazarán a los anteriores.</span>`
            : '';
    }
}


export function initDragAndDropContainer(container, itemSelector, onReorder) {
    if (!container) return;

    let dragSrcIndex = -1;
    const cards = container.querySelectorAll(itemSelector);

    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            dragSrcIndex = parseInt(card.getAttribute('data-index'), 10);
            card.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(dragSrcIndex));
            }
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            let srcIndex = dragSrcIndex;
            if (e.dataTransfer) {
                try {
                    const dataVal = e.dataTransfer.getData('text/plain');
                    if (dataVal !== '' && !isNaN(parseInt(dataVal, 10))) {
                        srcIndex = parseInt(dataVal, 10);
                    }
                } catch (err) { }
            }
            const targetIndex = parseInt(card.getAttribute('data-index'), 10);
            if (srcIndex !== -1 && targetIndex !== -1 && srcIndex !== targetIndex) {
                onReorder(srcIndex, targetIndex);
            }
        });

        card.addEventListener('dragend', () => {
            cards.forEach(el => el.classList.remove('dragging', 'drag-over'));
            dragSrcIndex = -1;
        });

        const handle = card.querySelector('.drag-handle');
        if (!handle) return;

        let touchActiveCard = null;
        let touchSrcIndex = -1;

        handle.addEventListener('touchstart', () => {
            touchActiveCard = card;
            touchSrcIndex = parseInt(card.getAttribute('data-index'), 10);
            card.classList.add('dragging');
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            if (!touchActiveCard) return;
            const touch = e.touches[0];
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            cards.forEach(el => el.classList.remove('drag-over'));
            if (elem) {
                const targetCard = elem.closest(itemSelector);
                if (targetCard && targetCard !== touchActiveCard) {
                    targetCard.classList.add('drag-over');
                }
            }
        }, { passive: false });

        handle.addEventListener('touchend', (e) => {
            if (!touchActiveCard) return;
            touchActiveCard.classList.remove('dragging');
            const touch = e.changedTouches[0];
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            cards.forEach(el => el.classList.remove('drag-over'));

            if (elem) {
                const targetCard = elem.closest(itemSelector);
                if (targetCard && targetCard !== touchActiveCard) {
                    const targetIndex = parseInt(targetCard.getAttribute('data-index'), 10);
                    if (touchSrcIndex !== -1 && targetIndex !== -1 && touchSrcIndex !== targetIndex) {
                        onReorder(touchSrcIndex, targetIndex);
                    }
                }
            }
            touchActiveCard = null;
            touchSrcIndex = -1;
        });
    });
}

function getSelectedProductsBranchId() {
    return document.getElementById('products-branch-filter')?.value || '';
}

// Guarda el orden propio de una sucursal (solo se escribe el documento de esa sucursal)
function saveBranchProductOrder(branchId, orderedIds) {
    saveBranchesState(getCustomBranches().map(branch => branch.id === branchId ? { ...branch, productOrder: orderedIds } : branch));
    renderManageProducts();
}

function getBranchOrderedProducts(branchId) {
    return sortProductsForBranch(getCustomProducts().filter(p => productAvailableInBranch(p, branchId)), getBranchById(branchId));
}

export function reorderProducts(fromIndex, toIndex, onComplete) {
    const branchId = getSelectedProductsBranchId();
    if (branchId) {
        const ids = getBranchOrderedProducts(branchId).map(product => product.id);
        if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) return;
        const [moved] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, moved);
        saveBranchProductOrder(branchId, ids);
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    let customProducts = getCustomProducts();
    if (fromIndex < 0 || fromIndex >= customProducts.length) return;
    if (toIndex < 0 || toIndex >= customProducts.length) return;

    const [moved] = customProducts.splice(fromIndex, 1);
    customProducts.splice(toIndex, 0, moved);
    saveProductsState(customProducts);
    if (typeof onComplete === 'function') onComplete();
}

export function reorderCategories(fromIndex, toIndex, onComplete) {
    let customCategories = getCustomCategories();
    if (fromIndex < 0 || fromIndex >= customCategories.length) return;
    if (toIndex < 0 || toIndex >= customCategories.length) return;

    const [moved] = customCategories.splice(fromIndex, 1);
    customCategories.splice(toIndex, 0, moved);
    saveCategoriesState(customCategories);
    if (typeof onComplete === 'function') onComplete();
}

export function sortProductsAlphabetically(onComplete) {
    const productsBranchSelect = document.getElementById('products-branch-filter');
    const selectedBranchId = productsBranchSelect ? productsBranchSelect.value : '';
    let customProducts = getCustomProducts();

    if (selectedBranchId) {
        const branchObj = getBranchById(selectedBranchId);
        const branchName = branchObj ? branchObj.name : 'la sucursal';

        const subset = customProducts.filter(p => productAvailableInBranch(p, selectedBranchId));
        if (subset.length === 0) {
            showToast("No hay productos en esta sucursal");
            return;
        }

        const sortedIds = [...subset]
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
            .map(product => product.id);
        saveBranchProductOrder(selectedBranchId, sortedIds);
        showToast(`Productos de ${branchName} ordenados A-Z`);
    } else {
        customProducts = sortNamedListAlphabetically(customProducts);
        saveProductsState(customProducts);
        showToast("Todos los productos ordenados A-Z");
    }

    if (typeof onComplete === 'function') onComplete();
}

export function sortCategoriesAlphabetically(onComplete) {
    let customCategories = getCustomCategories();
    customCategories = sortNamedListAlphabetically(customCategories);
    saveCategoriesState(customCategories);
    showToast("Categorías ordenadas alfabéticamente");
    if (typeof onComplete === 'function') onComplete();
}

export function saveProductsState(products = null) {
    let customProducts = products || getCustomProducts();
    customProducts = customProducts.map((product, index) => ({ ...normalizeProduct(product, index), order: index }));
    commitProducts(customProducts);
    renderManageProducts();
}

export function saveCategoriesState(categories = null) {
    let customCategories = categories || getCustomCategories();
    customCategories = customCategories.map((cat, index) => ({ ...cat, order: index }));
    commitCategories(customCategories);
    renderCategoryOptions();
    renderManageCategories();
}

export function saveBranchesState(branches = null) {
    let customBranches = branches || getCustomBranches();
    commitBranches(customBranches);
    renderManageBranches();
    renderManageProductBranchOptions();
}

export function renderCategoryOptions() {
    const manageCategoryInput = document.getElementById('manage-prod-cat');
    const customCategories = getCustomCategories();

    if (manageCategoryInput) {
        manageCategoryInput.innerHTML = customCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }
}

export function renderManageProductBranchOptions(selected = []) {
    const container = document.getElementById('manage-product-branches');
    if (!container) return;

    const customBranches = getCustomBranches();
    container.innerHTML = customBranches.map(branch => {
        const isChecked = selected.length === 0 || selected.includes(branch.id) || selected.includes(branch.name);
        return `
            <label class="check-chip">
                <input type="checkbox" name="manage_product_branch" value="${branch.id}" ${isChecked ? 'checked' : ''}>
                <span>${escapeHtml(branch.name)}</span>
            </label>
        `;
    }).join('');
}

export function getSelectedManageProductBranches() {
    const container = document.getElementById('manage-product-branches');
    if (!container) return [];
    const checked = container.querySelectorAll('input[name="manage_product_branch"]:checked');
    return Array.from(checked).map(input => input.value);
}

export function renderManageProducts() {
    const manageProductsList = document.getElementById('manage-products-list');
    if (!manageProductsList) return;

    const productsBranchSelect = document.getElementById('products-branch-filter');
    const customBranches = getCustomBranches();
    const customProducts = getCustomProducts();

    if (productsBranchSelect && customBranches.length > 0) {
        const currentVal = productsBranchSelect.value;
        const lastBranch = localStorage.getItem(STORAGE_KEYS.lastBranch) || '';
        
        productsBranchSelect.innerHTML = '<option value="">Todas las sucursales</option>' +
            customBranches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

        if (currentVal && Array.from(productsBranchSelect.options).some(o => o.value === currentVal)) {
            productsBranchSelect.value = currentVal;
        } else if (lastBranch && Array.from(productsBranchSelect.options).some(o => o.value === lastBranch)) {
            productsBranchSelect.value = lastBranch;
        } else {
            productsBranchSelect.value = '';
        }
    }

    const selectedBranchId = productsBranchSelect ? productsBranchSelect.value : '';

    // Con una sucursal elegida el orden es el de esa sucursal; con "Todas" es el orden general
    const filteredProducts = selectedBranchId
        ? sortProductsForBranch(customProducts.filter(p => productAvailableInBranch(p, selectedBranchId)), getBranchById(selectedBranchId))
        : customProducts;

    const orderHint = document.getElementById('products-order-hint');
    if (orderHint) {
        orderHint.textContent = selectedBranchId
            ? `Orden de ${getBranchById(selectedBranchId)?.name || 'la sucursal'}: arrastrar o mover solo cambia esta sucursal.`
            : 'Orden general: es el que usan las sucursales donde no has acomodado los productos.';
    }

    manageProductsList.innerHTML = '';
    manageProductsList.className = 'manage-grid';

    if (filteredProducts.length === 0) {
        manageProductsList.innerHTML = `<div class="empty-state"><i class="ph ph-hamburger"></i><p>No hay productos registrados${selectedBranchId ? ' para esta sucursal' : ''}.</p></div>`;
        return;
    }

    filteredProducts.forEach((p, listIndex) => {
        const realIndex = selectedBranchId ? listIndex : customProducts.findIndex(item => item.id === p.id);
        const lastIndex = selectedBranchId ? filteredProducts.length - 1 : customProducts.length - 1;
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.setAttribute('draggable', 'true');
        div.setAttribute('data-id', p.id);
        div.setAttribute('data-index', realIndex);

        const branchCount = Array.isArray(p.availableInBranches) ? p.availableInBranches.length : 0;
        const modifierGroups = resolveProductModifierGroups(p, getModifierGroups());
        const isLegacy = hasLegacyModifiers(p);

        div.innerHTML = `
            <div class="drag-handle" title="Arrastrar para reordenar"><i class="ph ph-dots-six-vertical"></i></div>
            <div class="manage-card-main">
                <div class="manage-card-title">${escapeHtml(p.name)} <span class="price-text">${formatMoney(p.price)}</span></div>
                <div class="manage-card-meta">
                    <span class="tag">${escapeHtml(p.category || 'Sin categoría')}</span>
                    <span>${branchCount > 0 ? `${branchCount} sucursal${branchCount === 1 ? '' : 'es'}` : 'Todas las sucursales'}</span>
                </div>
                ${modifierGroups.length > 0 ? `<div class="manage-card-meta manage-card-meta-accent"><i class="ph ph-sliders"></i> ${modifierGroups.map(g => escapeHtml(g.name)).join(', ')}${isLegacy ? ' <span class="tag tag-warning">sistema anterior</span>' : ''}</div>` : ''}
            </div>
            <div class="manage-card-actions">
                <div class="reorder-buttons">
                    <button class="btn-icon btn-icon-sm" data-action="move" data-index="${realIndex}" data-dir="-1" aria-label="Subir" ${realIndex === 0 ? 'disabled' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon btn-icon-sm" data-action="move" data-index="${realIndex}" data-dir="1" aria-label="Bajar" ${realIndex === lastIndex ? 'disabled' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
                <button class="btn-icon" data-action="edit" data-id="${p.id}" aria-label="Editar ${escapeHtml(p.name)}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-icon-danger delete" data-action="delete" data-id="${p.id}" aria-label="Eliminar ${escapeHtml(p.name)}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageProductsList.appendChild(div);
    });

    initDragAndDropContainer(manageProductsList, '.product-manage-card', (from, to) => reorderProducts(from, to, renderManageProducts));
}

export function resetManageProductForm() {
    editingProductId = null;
    const manageNameInput = document.getElementById('manage-prod-name');
    const managePriceInput = document.getElementById('manage-prod-price');
    const manageCategoryInput = document.getElementById('manage-prod-cat');
    const btnManageSaveProd = document.getElementById('manage-save-product');

    if (manageNameInput) manageNameInput.value = '';
    if (managePriceInput) managePriceInput.value = '';
    if (manageCategoryInput) manageCategoryInput.value = getCustomCategories()[0]?.name || '';
    renderManageProductBranchOptions();
    renderProductModifierChooser(null);
    if (btnManageSaveProd) btnManageSaveProd.textContent = 'Guardar';
}

export function saveManagedProduct() {
    const manageNameInput = document.getElementById('manage-prod-name');
    const managePriceInput = document.getElementById('manage-prod-price');
    const manageCategoryInput = document.getElementById('manage-prod-cat');
    const manageForm = document.getElementById('manage-new-product-form');

    const name = manageNameInput?.value.trim() || '';
    const price = parseFloat(managePriceInput?.value);
    const category = manageCategoryInput?.value || 'General';
    const availableInBranches = getSelectedManageProductBranches();

    if (!name || isNaN(price)) {
        showToast("Escribe el nombre y el precio del producto");
        return;
    }

    let customProducts = getCustomProducts();
    const original = editingProductId ? customProducts.find(p => p.id === editingProductId) : null;
    const payload = { name, price, category, availableInBranches };

    // Modificadores: si el producto aún usa el sistema anterior y no se eligió ninguno compartido,
    // se dejan como están (no se agrega modifierGroupIds para no ocultar los anteriores).
    const modifierGroupIds = [...document.querySelectorAll('#manage-product-modifier-groups input[name="manage_product_modifier"]:checked')].map(input => input.value);
    if (!original || usesSharedModifiers(original) || modifierGroupIds.length > 0 || !hasLegacyModifiers(original)) {
        payload.modifierGroupIds = modifierGroupIds;
    }

    if (editingProductId) {
        customProducts = upsertProduct(customProducts, payload, editingProductId);
        showToast("Producto actualizado");
    } else {
        customProducts = upsertProduct(customProducts, payload);
        showToast("Producto guardado");
    }

    saveProductsState(customProducts);
    resetManageProductForm();
    if (manageForm) manageForm.style.display = 'none';
}

export function startEditingProduct(id) {
    const customProducts = getCustomProducts();
    const product = customProducts.find(p => p.id === id);
    if (!product) return;

    editingProductId = id;
    const manageNameInput = document.getElementById('manage-prod-name');
    const managePriceInput = document.getElementById('manage-prod-price');
    const manageCategoryInput = document.getElementById('manage-prod-cat');
    const btnManageSaveProd = document.getElementById('manage-save-product');
    const manageForm = document.getElementById('manage-new-product-form');

    if (manageNameInput) manageNameInput.value = product.name;
    if (managePriceInput) managePriceInput.value = product.price;
    if (manageCategoryInput) manageCategoryInput.value = product.category;
    renderManageProductBranchOptions(product.availableInBranches || []);
    renderProductModifierChooser(product);
    if (btnManageSaveProd) btnManageSaveProd.textContent = 'Actualizar';
    if (manageForm) manageForm.style.display = 'block';
    if (manageNameInput) manageNameInput.focus();
}

export function deleteManagedProduct(id) {
    if (confirm("¿Estás seguro de que quieres eliminar este producto?")) {
        let customProducts = getCustomProducts();
        customProducts = removeProductById(customProducts, id);
        if (editingProductId === id) {
            resetManageProductForm();
            const manageForm = document.getElementById('manage-new-product-form');
            if (manageForm) manageForm.style.display = 'none';
        }
        saveProductsState(customProducts);
    }
}

export function moveManagedProduct(index, dir) {
    if (getSelectedProductsBranchId()) {
        reorderProducts(index, index + dir);
        return;
    }
    let customProducts = getCustomProducts();
    customProducts = moveProductInList(customProducts, index, dir);
    saveProductsState(customProducts);
}

export function renderManageCategories() {
    const manageCategoriesList = document.getElementById('manage-categories-list');
    if (!manageCategoriesList) return;

    const customCategories = getCustomCategories();
    manageCategoriesList.innerHTML = '';
    manageCategoriesList.className = 'manage-grid';

    customCategories.forEach((category, index) => {
        const div = document.createElement('div');
        div.className = 'product-manage-card category-manage-card';
        div.setAttribute('draggable', 'true');
        div.setAttribute('data-id', category.id);
        div.setAttribute('data-index', index);

        const productCount = getCustomProducts().filter(product => product.category === category.name).length;
        div.innerHTML = `
            <div class="drag-handle" title="Arrastrar para reordenar"><i class="ph ph-dots-six-vertical"></i></div>
            <div class="manage-card-main">
                <div class="manage-card-title">${escapeHtml(category.name)}</div>
                <div class="manage-card-meta">${productCount} producto${productCount === 1 ? '' : 's'}</div>
            </div>
            <div class="manage-card-actions">
                <div class="reorder-buttons">
                    <button class="btn-icon btn-icon-sm" data-action="category-move" data-index="${index}" data-dir="-1" aria-label="Subir" ${index === 0 ? 'disabled' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon btn-icon-sm" data-action="category-move" data-index="${index}" data-dir="1" aria-label="Bajar" ${index === customCategories.length - 1 ? 'disabled' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
                <button class="btn-icon" data-action="category-edit" data-id="${category.id}" aria-label="Editar ${escapeHtml(category.name)}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-icon-danger delete" data-action="category-delete" data-id="${category.id}" aria-label="Eliminar ${escapeHtml(category.name)}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageCategoriesList.appendChild(div);
    });

    initDragAndDropContainer(manageCategoriesList, '.category-manage-card', (from, to) => reorderCategories(from, to, renderManageCategories));
}

export function resetManageCategoryForm() {
    editingCategoryId = null;
    const manageCategoryNameInput = document.getElementById('manage-category-name');
    const btnManageSaveCategory = document.getElementById('manage-save-category');
    if (manageCategoryNameInput) manageCategoryNameInput.value = '';
    if (btnManageSaveCategory) btnManageSaveCategory.textContent = 'Guardar';
}

export function saveManagedCategory() {
    const manageCategoryNameInput = document.getElementById('manage-category-name');
    const manageCategoryForm = document.getElementById('manage-new-category-form');
    const name = manageCategoryNameInput?.value.trim() || '';
    if (!name) return;

    let customCategories = getCustomCategories();
    let customProducts = getCustomProducts();
    const isEditing = Boolean(editingCategoryId);
    const existingCategory = editingCategoryId
        ? customCategories.find(item => item.id === editingCategoryId)
        : null;
    const previousName = existingCategory?.name || null;

    if (hasDuplicateName(customCategories, name, editingCategoryId)) {
        showToast("Esa categoría ya existe");
        return;
    }

    if (previousName && previousName !== name) {
        customProducts = customProducts.map(product => product.category === previousName
            ? { ...product, category: name }
            : product
        );
        saveProductsState(customProducts);
    }

    if (editingCategoryId) {
        customCategories = customCategories.map(item => item.id === editingCategoryId ? { ...item, name } : item);
    } else {
        customCategories.push({
            id: `cat_${Date.now()}`,
            name,
            order: customCategories.length
        });
    }

    saveCategoriesState(customCategories);
    resetManageCategoryForm();
    if (manageCategoryForm) manageCategoryForm.style.display = 'none';
    showToast(isEditing ? "Categoría actualizada" : "Categoría guardada");
}

export function startEditingCategory(id) {
    const customCategories = getCustomCategories();
    const category = customCategories.find(item => item.id === id);
    if (!category) return;

    editingCategoryId = id;
    const manageCategoryNameInput = document.getElementById('manage-category-name');
    const btnManageSaveCategory = document.getElementById('manage-save-category');
    const manageCategoryForm = document.getElementById('manage-new-category-form');

    if (manageCategoryNameInput) manageCategoryNameInput.value = category.name;
    if (btnManageSaveCategory) btnManageSaveCategory.textContent = 'Actualizar';
    if (manageCategoryForm) manageCategoryForm.style.display = 'block';
    if (manageCategoryNameInput) manageCategoryNameInput.focus();
}

export function deleteManagedCategory(id) {
    const customCategories = getCustomCategories();
    const category = customCategories.find(item => item.id === id);
    if (!category) return;

    const remainingCategories = customCategories.filter(item => item.id !== id);
    if (remainingCategories.length === 0) {
        showToast("Debe quedar al menos una categoría");
        return;
    }

    if (confirm(`¿Eliminar la categoría "${category.name}"? Los productos de esa categoría pasarán a "${remainingCategories[0].name}".`)) {
        let customProducts = getCustomProducts();
        customProducts = customProducts.map(product => product.category === category.name
            ? { ...product, category: remainingCategories[0].name }
            : product
        );
        saveProductsState(customProducts);
        saveCategoriesState(remainingCategories);
        if (editingCategoryId === id) {
            resetManageCategoryForm();
            const manageCategoryForm = document.getElementById('manage-new-category-form');
            if (manageCategoryForm) manageCategoryForm.style.display = 'none';
        }
        showToast("Categoría eliminada");
    }
}

export function renderManageBranches() {
    const manageBranchesList = document.getElementById('manage-branches-list');
    if (!manageBranchesList) return;

    const customBranches = getCustomBranches();
    manageBranchesList.innerHTML = '';
    manageBranchesList.className = 'manage-grid';

    customBranches.forEach(branch => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <span class="branch-color-dot" style="background:${getStableBranchColor(branch)};"></span>
            <div class="manage-card-main">
                <div class="manage-card-title">${escapeHtml(branch.name)}</div>
                <div class="manage-card-meta">
                    <span class="tag">${branch.useTables ? '<i class="ph ph-table"></i> Con mesas' : '<i class="ph ph-lightning"></i> Venta directa'}</span>
                    ${branchSessionTags(branch)}
                </div>
                ${getBranchSessionConfig(branch).sessionsEnabled && describeSchedule(branch.schedule) ? `<div class="manage-card-meta"><i class="ph ph-clock"></i> ${escapeHtml(describeSchedule(branch.schedule))}</div>` : ''}
            </div>
            <div class="manage-card-actions">
                <button class="btn-icon" data-action="branch-edit" data-id="${branch.id}" aria-label="Editar ${escapeHtml(branch.name)}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-icon-danger delete" data-action="branch-delete" data-id="${branch.id}" aria-label="Eliminar ${escapeHtml(branch.name)}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageBranchesList.appendChild(div);
    });
}

function branchSessionTags(branch) {
    const config = getBranchSessionConfig(branch);
    if (!config.sessionsEnabled) return '';
    return [
        '<span class="tag"><i class="ph ph-chart-line"></i> Jornadas</span>',
        config.inventoryEnabled ? '<span class="tag"><i class="ph ph-cube"></i> Inventario</span>' : '',
        `<span class="tag">${config.openMode === 'schedule' ? '<i class="ph ph-clock"></i> Horario fijo' : '<i class="ph ph-power"></i> Botón'}</span>`
    ].join('');
}

// ---------- Configuración de jornadas en el formulario de sucursal ----------
function renderBranchScheduleEditor(schedule = {}) {
    const container = document.getElementById('manage-branch-schedule');
    if (!container) return;
    const normalized = normalizeSchedule(schedule);
    container.innerHTML = WEEK_DAYS.map(({ key, label }) => {
        const day = normalized[key];
        return `
            <div class="schedule-row${day ? '' : ' is-off'}" data-day="${key}">
                <label class="schedule-day">
                    <input type="checkbox" class="schedule-enabled" ${day ? 'checked' : ''}>
                    <span>${label}</span>
                </label>
                <input type="time" class="schedule-open" value="${day?.open || '13:00'}" aria-label="${label}: abre" ${day ? '' : 'disabled'}>
                <span class="schedule-sep">a</span>
                <input type="time" class="schedule-close" value="${day?.close || '21:00'}" aria-label="${label}: cierra" ${day ? '' : 'disabled'}>
            </div>
        `;
    }).join('');
}

function readBranchSchedule() {
    const schedule = {};
    document.querySelectorAll('#manage-branch-schedule .schedule-row').forEach(row => {
        if (!row.querySelector('.schedule-enabled')?.checked) return;
        schedule[row.dataset.day] = {
            open: row.querySelector('.schedule-open')?.value || '',
            close: row.querySelector('.schedule-close')?.value || ''
        };
    });
    return normalizeSchedule(schedule);
}

export function handleBranchScheduleChange(event) {
    const checkbox = event.target.closest('.schedule-enabled');
    if (!checkbox) return;
    const row = checkbox.closest('.schedule-row');
    row.classList.toggle('is-off', !checkbox.checked);
    row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = !checkbox.checked; });
}

export function updateBranchSessionOptions() {
    const enabled = document.getElementById('manage-branch-sessions')?.checked;
    const options = document.getElementById('manage-branch-sessions-options');
    if (options) options.style.display = enabled ? '' : 'none';
    const mode = document.querySelector('input[name="manage-branch-open-mode"]:checked')?.value;
    const label = document.getElementById('manage-branch-schedule-label');
    if (label) label.textContent = mode === 'schedule' ? 'Horario (obligatorio con horario fijo)' : 'Horario (opcional, como referencia y recordatorio)';
}

function fillBranchSessionFields(branch = null) {
    const config = getBranchSessionConfig(branch);
    const sessionsInput = document.getElementById('manage-branch-sessions');
    const inventoryInput = document.getElementById('manage-branch-inventory');
    if (sessionsInput) sessionsInput.checked = config.sessionsEnabled;
    if (inventoryInput) inventoryInput.checked = config.inventoryEnabled;
    document.querySelectorAll('input[name="manage-branch-open-mode"]').forEach(input => {
        input.checked = input.value === config.openMode;
    });
    renderBranchScheduleEditor(config.schedule);
    updateBranchSessionOptions();
}

export function resetManageBranchForm() {
    editingBranchId = null;
    const manageBranchNameInput = document.getElementById('manage-branch-name');
    const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
    const btnManageSaveBranch = document.getElementById('manage-save-branch');

    if (manageBranchNameInput) manageBranchNameInput.value = '';
    if (manageBranchUseTables) manageBranchUseTables.checked = false;
    fillBranchSessionFields(null);
    if (btnManageSaveBranch) btnManageSaveBranch.textContent = 'Guardar';
}

export function saveManagedBranch() {
    const manageBranchNameInput = document.getElementById('manage-branch-name');
    const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
    const manageBranchForm = document.getElementById('manage-new-branch-form');

    const name = manageBranchNameInput?.value.trim() || '';
    const useTables = Boolean(manageBranchUseTables?.checked);
    if (!name) {
        showToast("Escribe el nombre de la sucursal");
        return;
    }

    const sessionsEnabled = Boolean(document.getElementById('manage-branch-sessions')?.checked);
    const sessionConfig = {
        sessionsEnabled,
        inventoryEnabled: sessionsEnabled && Boolean(document.getElementById('manage-branch-inventory')?.checked),
        openMode: document.querySelector('input[name="manage-branch-open-mode"]:checked')?.value === 'schedule' ? 'schedule' : 'manual',
        schedule: readBranchSchedule()
    };
    if (sessionsEnabled && sessionConfig.openMode === 'schedule' && Object.keys(sessionConfig.schedule).length === 0) {
        showToast("Con horario fijo marca al menos un día con su horario");
        return;
    }

    let customBranches = getCustomBranches();
    const isEditing = Boolean(editingBranchId);

    if (hasDuplicateName(customBranches, name, editingBranchId)) {
        showToast("Esa sucursal ya existe");
        return;
    }

    if (editingBranchId) {
        customBranches = customBranches.map(item => item.id === editingBranchId ? { ...item, name, useTables, ...sessionConfig } : item);
    } else {
        customBranches.push({
            id: `branch_${Date.now()}`,
            name,
            useTables,
            ...sessionConfig,
            order: customBranches.length
        });
    }

    saveBranchesState(customBranches);
    resetManageBranchForm();
    if (manageBranchForm) manageBranchForm.style.display = 'none';
    showToast(isEditing ? "Sucursal actualizada" : "Sucursal guardada");
}

export function startEditingBranch(id) {
    const customBranches = getCustomBranches();
    const branch = customBranches.find(item => item.id === id);
    if (!branch) return;

    editingBranchId = id;
    const manageBranchNameInput = document.getElementById('manage-branch-name');
    const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
    const btnManageSaveBranch = document.getElementById('manage-save-branch');
    const manageBranchForm = document.getElementById('manage-new-branch-form');

    if (manageBranchNameInput) manageBranchNameInput.value = branch.name;
    if (manageBranchUseTables) manageBranchUseTables.checked = Boolean(branch.useTables);
    fillBranchSessionFields(branch);
    if (btnManageSaveBranch) btnManageSaveBranch.textContent = 'Actualizar';
    if (manageBranchForm) manageBranchForm.style.display = 'block';
    if (manageBranchNameInput) manageBranchNameInput.focus();
}

export function deleteManagedBranch(id) {
    let customBranches = getCustomBranches();
    if (customBranches.length <= 1) {
        showToast("Debe quedar al menos una sucursal");
        return;
    }

    const branch = customBranches.find(item => item.id === id);
    if (!branch) return;

    if (confirm(`¿Eliminar la sucursal "${branch.name}"?`)) {
        customBranches = customBranches.filter(item => item.id !== id);
        saveBranchesState(customBranches);
        if (editingBranchId === id) {
            resetManageBranchForm();
            const manageBranchForm = document.getElementById('manage-new-branch-form');
            if (manageBranchForm) manageBranchForm.style.display = 'none';
        }
        showToast("Sucursal eliminada");
    }
}
