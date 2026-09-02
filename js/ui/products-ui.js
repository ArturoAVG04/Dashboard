import { escapeHtml, getLocalDateInputValue, createLocalDateFromInput } from '../core/date-utils.js';
import { showToast, scrollToTop } from '../core/ui-feedback.js';
import { getCustomProducts, setCustomProducts, getCustomCategories, setCustomCategories, getCustomExpenseTags, setCustomExpenseTags, syncProductsToCloud, syncCategoriesToCloud, syncExpenseTagsToCloud } from '../services/products-service.js';
import { getCustomBranches, setCustomBranches, syncBranchesToCloud, getBranchById, productAvailableInBranch, hasDuplicateName, sortNamedListAlphabetically } from '../services/branches-service.js';
import { upsertProduct, removeProductById, moveProductInList, normalizeProduct } from '../models/Product.js';
import { saveTransaction, updateTransactionRecord } from '../services/transactions-service.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';

let editingProductId = null;
let editingCategoryId = null;
let editingBranchId = null;
let editingExpenseTagId = null;
let editingTransactionId = null;
let selectedExpenseShortcuts = [];

export function getEditingTransactionId() {
    return editingTransactionId;
}

export function setEditingTransactionId(id) {
    editingTransactionId = id;
}

export function createModifierOptionRowHtml(opt = { id: '', name: '', price: 0 }) {
    const optId = opt.id || `opt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    return `
        <div class="mod-option-row-edit" data-opt-id="${optId}">
            <input type="text" class="mod-opt-name-input" placeholder="Nombre (ej. Búfalo, BBQ)" value="${escapeHtml(opt.name || '')}" required>
            <div class="mod-option-price-wrapper">
                <span>+$</span>
                <input type="number" class="mod-opt-price-input" placeholder="0" min="0" step="0.5" value="${opt.price || 0}">
            </div>
            <button type="button" class="btn-remove-mod-opt" title="Eliminar opción"><i class="ph ph-trash"></i></button>
        </div>
    `;
}

export function createModifierGroupCardHtml(group = { id: '', name: '', type: 'single', options: [] }) {
    const groupId = group.id || `mod_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const optionsHtml = Array.isArray(group.options) && group.options.length > 0
        ? group.options.map(opt => createModifierOptionRowHtml(opt)).join('')
        : createModifierOptionRowHtml();

    return `
        <div class="modifier-group-card" data-group-id="${groupId}">
            <div class="mod-group-header">
                <input type="text" class="mod-group-name-input" placeholder="Nombre del Grupo (ej. Salsas)" value="${escapeHtml(group.name || '')}" required>
                <div class="mod-group-controls">
                    <select class="mod-group-type-select">
                        <option value="single" ${group.type !== 'multiple' ? 'selected' : ''}>🔘 Selección Única (1 opción)</option>
                        <option value="multiple" ${group.type === 'multiple' ? 'selected' : ''}>☑️ Selección Múltiple (1 o más)</option>
                    </select>
                    <button type="button" class="btn-remove-mod-group" title="Eliminar grupo"><i class="ph ph-trash"></i></button>
                </div>
            </div>
            <div class="mod-group-options-list">
                ${optionsHtml}
            </div>
            <button type="button" class="btn-add-mod-option"><i class="ph ph-plus"></i> Agregar Opción</button>
        </div>
    `;
}

export function renderManageProductModifiers(modifiers = []) {
    const container = document.getElementById('manage-modifier-groups-container');
    if (!container) return;
    container.innerHTML = '';

    if (Array.isArray(modifiers) && modifiers.length > 0) {
        modifiers.forEach(group => {
            const div = document.createElement('div');
            div.innerHTML = createModifierGroupCardHtml(group);
            container.appendChild(div.firstElementChild);
        });
    }
}

export function getManageProductModifiers() {
    const container = document.getElementById('manage-modifier-groups-container');
    if (!container) return [];

    const cards = container.querySelectorAll('.modifier-group-card');
    const groups = [];

    cards.forEach((card, gIdx) => {
        const nameInput = card.querySelector('.mod-group-name-input');
        const typeSelect = card.querySelector('.mod-group-type-select');
        const groupName = nameInput?.value?.trim() || '';
        const groupType = typeSelect?.value === 'multiple' ? 'multiple' : 'single';
        const groupId = card.dataset.groupId || `mod_${Date.now()}_${gIdx}`;

        if (!groupName) return;

        const optionRows = card.querySelectorAll('.mod-option-row-edit');
        const options = [];

        optionRows.forEach((row, oIdx) => {
            const optNameInput = row.querySelector('.mod-opt-name-input');
            const optPriceInput = row.querySelector('.mod-opt-price-input');
            const optName = optNameInput?.value?.trim() || '';
            const optPrice = parseFloat(optPriceInput?.value) || 0;
            const optId = row.dataset.optId || `opt_${Date.now()}_${oIdx}`;

            if (optName) {
                options.push({
                    id: optId,
                    name: optName,
                    price: optPrice >= 0 ? optPrice : 0
                });
            }
        });

        if (options.length > 0) {
            groups.push({
                id: groupId,
                name: groupName,
                type: groupType,
                options
            });
        }
    });

    return groups;
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

export function reorderProducts(fromIndex, toIndex, onComplete) {
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

        const sortedSubset = [...subset].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

        let subIdx = 0;
        customProducts = customProducts.map(p => {
            if (productAvailableInBranch(p, selectedBranchId)) {
                return sortedSubset[subIdx++];
            }
            return p;
        });

        saveProductsState(customProducts);
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
    setCustomProducts(customProducts);
    renderManageProducts();
    syncProductsToCloud();
}

export function saveCategoriesState(categories = null) {
    let customCategories = categories || getCustomCategories();
    customCategories = customCategories.map((cat, index) => ({ ...cat, order: index }));
    setCustomCategories(customCategories);
    renderCategoryOptions();
    renderManageCategories();
    syncCategoriesToCloud();
}

export function saveBranchesState(branches = null) {
    let customBranches = branches || getCustomBranches();
    setCustomBranches(customBranches);
    renderManageBranches();
    renderManageProductBranchOptions();
    syncBranchesToCloud();
}

export function saveExpenseTagsState(tags = null) {
    let customExpenseTags = tags || getCustomExpenseTags();
    customExpenseTags = sortNamedListAlphabetically(customExpenseTags);
    setCustomExpenseTags(customExpenseTags);
    renderExpenseTags();
    renderManageExpenseTags();
    syncExpenseTagsToCloud();
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
            <label class="branch-checkbox-label">
                <input type="checkbox" name="manage_product_branch" value="${branch.id}" ${isChecked ? 'checked' : ''}>
                <span>${branch.name}</span>
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

    const filteredProducts = selectedBranchId
        ? customProducts.filter(p => productAvailableInBranch(p, selectedBranchId))
        : customProducts;

    manageProductsList.innerHTML = '';
    manageProductsList.className = 'view-products-grid';

    if (filteredProducts.length === 0) {
        manageProductsList.innerHTML = `<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:2rem;">No hay productos registrados ${selectedBranchId ? 'para esta sucursal' : ''}.</div>`;
        return;
    }

    filteredProducts.forEach((p) => {
        const realIndex = customProducts.findIndex(item => item.id === p.id);
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.setAttribute('draggable', 'true');
        div.setAttribute('data-id', p.id);
        div.setAttribute('data-index', realIndex);

        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem; flex-grow:1;">
                <div class="drag-handle" title="Arrastrar para reordenar">
                    <i class="ph ph-dots-six-vertical" style="font-size:1.3rem;"></i>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <button class="btn-icon" data-action="move" data-index="${realIndex}" data-dir="-1" ${realIndex === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon" data-action="move" data-index="${realIndex}" data-dir="1" ${realIndex === customProducts.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
                <div>
                    <div style="font-weight: 500;">${p.name} <small style="color:var(--text-muted)">(${p.category || 'Sin categoría'})</small></div>
                    <div style="color: var(--success); font-size: 0.9rem;">$${p.price}</div>
                    <div style="color: var(--text-muted); font-size: 0.8rem;">${Array.isArray(p.availableInBranches) && p.availableInBranches.length > 0 ? `${p.availableInBranches.length} sucursales asignadas` : 'Disponible en todas las sucursales'}</div>
                    ${Array.isArray(p.modifiers) && p.modifiers.length > 0 ? `<div style="color: var(--primary); font-size: 0.8rem; margin-top: 0.2rem;"><i class="ph ph-sliders"></i> ${p.modifiers.length} grupo${p.modifiers.length === 1 ? '' : 's'} de opciones (${p.modifiers.map(g => g.name).join(', ')})</div>` : ''}
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="edit" data-id="${p.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="delete" data-id="${p.id}"><i class="ph ph-trash"></i></button>
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
    renderManageProductModifiers([]);
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
    const modifiers = getManageProductModifiers();

    if (!name || isNaN(price)) return;

    let customProducts = getCustomProducts();
    if (editingProductId) {
        customProducts = upsertProduct(customProducts, { name, price, category, availableInBranches, modifiers }, editingProductId);
        showToast("Producto actualizado");
    } else {
        customProducts = upsertProduct(customProducts, { name, price, category, availableInBranches, modifiers });
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
    renderManageProductModifiers(product.modifiers || []);
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
    let customProducts = getCustomProducts();
    customProducts = moveProductInList(customProducts, index, dir);
    saveProductsState(customProducts);
}

export function renderManageCategories() {
    const manageCategoriesList = document.getElementById('manage-categories-list');
    if (!manageCategoriesList) return;

    const customCategories = getCustomCategories();
    manageCategoriesList.innerHTML = '';
    manageCategoriesList.className = 'view-products-grid';

    customCategories.forEach((category, index) => {
        const div = document.createElement('div');
        div.className = 'product-manage-card category-manage-card';
        div.setAttribute('draggable', 'true');
        div.setAttribute('data-id', category.id);
        div.setAttribute('data-index', index);

        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem; flex-grow:1;">
                <div class="drag-handle" title="Arrastrar para reordenar">
                    <i class="ph ph-dots-six-vertical" style="font-size:1.3rem;"></i>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <button class="btn-icon" data-action="category-move" data-index="${index}" data-dir="-1" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon" data-action="category-move" data-index="${index}" data-dir="1" ${index === customCategories.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
                <div>
                    <div style="font-weight: 500;">${category.name}</div>
                    <div style="color: var(--text-muted); font-size: 0.85rem;">Categoría disponible</div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="category-edit" data-id="${category.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="category-delete" data-id="${category.id}"><i class="ph ph-trash"></i></button>
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
    manageBranchesList.className = 'view-products-grid';

    customBranches.forEach(branch => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <div>
                <div style="font-weight: 500;">${branch.name}</div>
                <div style="color: var(--text-muted); font-size: 0.85rem;">${branch.useTables ? 'Con mesas abiertas' : 'Venta directa'}</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="branch-edit" data-id="${branch.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="branch-delete" data-id="${branch.id}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageBranchesList.appendChild(div);
    });
}

export function resetManageBranchForm() {
    editingBranchId = null;
    const manageBranchNameInput = document.getElementById('manage-branch-name');
    const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
    const btnManageSaveBranch = document.getElementById('manage-save-branch');

    if (manageBranchNameInput) manageBranchNameInput.value = '';
    if (manageBranchUseTables) manageBranchUseTables.checked = false;
    if (btnManageSaveBranch) btnManageSaveBranch.textContent = 'Guardar';
}

export function saveManagedBranch() {
    const manageBranchNameInput = document.getElementById('manage-branch-name');
    const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
    const manageBranchForm = document.getElementById('manage-new-branch-form');

    const name = manageBranchNameInput?.value.trim() || '';
    const useTables = Boolean(manageBranchUseTables?.checked);
    if (!name) return;

    let customBranches = getCustomBranches();
    const isEditing = Boolean(editingBranchId);

    if (hasDuplicateName(customBranches, name, editingBranchId)) {
        showToast("Esa sucursal ya existe");
        return;
    }

    if (editingBranchId) {
        customBranches = customBranches.map(item => item.id === editingBranchId ? { ...item, name, useTables } : item);
    } else {
        customBranches.push({
            id: `branch_${Date.now()}`,
            name,
            useTables,
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

export function renderManageExpenseTags() {
    const manageExpenseTagsList = document.getElementById('manage-expense-tags-list');
    if (!manageExpenseTagsList) return;

    const customExpenseTags = getCustomExpenseTags();
    manageExpenseTagsList.innerHTML = '';
    manageExpenseTagsList.className = 'view-products-grid';

    customExpenseTags.forEach((tag) => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <div>
                    <div style="font-weight: 500;">${tag.name}</div>
                    <div style="color: var(--text-muted); font-size: 0.85rem;">Atajo de gasto</div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="expense-edit" data-id="${tag.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="expense-delete" data-id="${tag.id}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageExpenseTagsList.appendChild(div);
    });
}

export function resetManageExpenseForm() {
    editingExpenseTagId = null;
    const manageExpenseNameInput = document.getElementById('manage-exp-name');
    const btnManageSaveExpense = document.getElementById('manage-save-expense');
    if (manageExpenseNameInput) manageExpenseNameInput.value = '';
    if (btnManageSaveExpense) btnManageSaveExpense.textContent = 'Guardar';
}

export function saveManagedExpenseTag() {
    const manageExpenseNameInput = document.getElementById('manage-exp-name');
    const manageExpenseForm = document.getElementById('manage-new-expense-form');
    const name = manageExpenseNameInput?.value.trim() || '';
    if (!name) return;

    let customExpenseTags = getCustomExpenseTags();
    if (hasDuplicateName(customExpenseTags, name, editingExpenseTagId)) {
        showToast("Ese atajo ya está registrado");
        return;
    }

    if (editingExpenseTagId) {
        customExpenseTags = customExpenseTags.map(tag => tag.id === editingExpenseTagId ? { ...tag, name } : tag);
        showToast("Acceso actualizado");
    } else {
        customExpenseTags.push({ id: `exp_${Date.now()}`, name, order: customExpenseTags.length });
        showToast("Acceso guardado");
    }

    saveExpenseTagsState(customExpenseTags);
    resetManageExpenseForm();
    if (manageExpenseForm) manageExpenseForm.style.display = 'none';
}

export function startEditingExpenseTag(id) {
    const customExpenseTags = getCustomExpenseTags();
    const tag = customExpenseTags.find(item => item.id === id);
    if (!tag) return;

    editingExpenseTagId = id;
    const manageExpenseNameInput = document.getElementById('manage-exp-name');
    const btnManageSaveExpense = document.getElementById('manage-save-expense');
    const manageExpenseForm = document.getElementById('manage-new-expense-form');

    if (manageExpenseNameInput) manageExpenseNameInput.value = tag.name;
    if (btnManageSaveExpense) btnManageSaveExpense.textContent = 'Actualizar';
    if (manageExpenseForm) manageExpenseForm.style.display = 'block';
    if (manageExpenseNameInput) manageExpenseNameInput.focus();
}

export function deleteManagedExpenseTag(id) {
    if (confirm("¿Estás seguro de que quieres eliminar este acceso de gasto?")) {
        let customExpenseTags = getCustomExpenseTags();
        customExpenseTags = customExpenseTags.filter(tag => tag.id !== id);
        if (editingExpenseTagId === id) {
            resetManageExpenseForm();
            const manageExpenseForm = document.getElementById('manage-new-expense-form');
            if (manageExpenseForm) manageExpenseForm.style.display = 'none';
        }
        saveExpenseTagsState(customExpenseTags);
    }
}

export function renderExpenseTags() {
    const expenseTagsContainer = document.getElementById('expense-tags-container');
    if (!expenseTagsContainer) return;

    const customExpenseTags = getCustomExpenseTags();
    expenseTagsContainer.innerHTML = '';
    customExpenseTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `expense-tag${selectedExpenseShortcuts.includes(tag.name) ? ' active' : ''}`;
        btn.textContent = tag.name;
        btn.addEventListener('click', () => toggleExpenseShortcut(tag.name));
        expenseTagsContainer.appendChild(btn);
    });
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

    selectedExpensesContainer.style.display = 'grid';
    selectedExpensesContainer.innerHTML = '';

    selectedExpenseShortcuts.forEach(name => {
        const row = document.createElement('div');
        row.className = 'selected-expense-row';

        const label = document.createElement('div');
        label.className = 'selected-expense-name';
        label.textContent = name;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'selected-expense-amount';
        input.dataset.expenseName = name;
        input.min = '0';
        input.step = '0.5';
        input.placeholder = 'Costo';
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

export function openExpenseModal(transaction = null) {
    const modal = document.getElementById('transaction-modal');
    const title = document.getElementById('transaction-modal-title');
    const descInput = document.getElementById('description');
    const amountInput = document.getElementById('amount');
    const dateInput = document.getElementById('date');
    const expenseForm = document.getElementById('transaction-form');

    if (!modal) return;
    if (expenseForm) expenseForm.reset();
    resetSelectedExpenses();

    if (transaction) {
        editingTransactionId = transaction.id;
        if (title) title.textContent = "Editar Gasto";
        if (descInput) descInput.value = transaction.desc || '';
        if (amountInput) amountInput.value = transaction.amount || '';
        if (dateInput) dateInput.value = transaction.date ? getLocalDateInputValue(new Date(transaction.date)) : getLocalDateInputValue();
    } else {
        editingTransactionId = null;
        if (title) title.textContent = "Registrar Gasto";
        if (dateInput) dateInput.value = getLocalDateInputValue();
    }

    modal.classList.add('open');
    scrollToTop();
}

export function closeModal() {
    const modal = document.getElementById('transaction-modal');
    if (modal) modal.classList.remove('open');
    editingTransactionId = null;
    resetSelectedExpenses();
    scrollToTop();
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
                zone: '',
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
        zone: '',
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
