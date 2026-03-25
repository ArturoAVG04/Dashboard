import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { INITIAL_ZONES, INITIAL_PRODUCTS, INITIAL_EXPENSE_TAGS } from './constants.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from './storage.js';
import { authenticate, isAuthenticated } from './auth.js';
import { groupProductsByCategory, upsertProduct, moveProductInList, removeProductById } from './product-utils.js';

// State
let transactions = loadLocalState(STORAGE_KEYS.transactions, []);
let currentFilter = 'day'; // Match UI default
let charts = { main: null, category: null };
let customProducts = loadLocalState(STORAGE_KEYS.products, INITIAL_PRODUCTS);
let customExpenseTags = normalizeExpenseTags(loadLocalState(STORAGE_KEYS.expenseTags, INITIAL_EXPENSE_TAGS));

let customStartDate = null;
let customEndDate = null;
let customDateLabel = "";
let editingProductId = null;
let editingExpenseTagId = null;
let isSyncingProducts = false;
let isSyncingExpenseTags = false;

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    transactions: document.getElementById('view-transactions'),
    products: document.getElementById('view-products'),
    backup: document.getElementById('view-backup')
};

const navBtns = {
    dashboard: document.getElementById('nav-dashboard'),
    transactions: document.getElementById('nav-transactions'),
    products: document.getElementById('nav-products'),
    backup: document.getElementById('nav-backup')
};

const modal = document.getElementById('transaction-modal');
const form = document.getElementById('transaction-form');
const btnNewTx = document.getElementById('btn-new-transaction');
const btnCloseModal = document.getElementById('close-modal');
const btnViewAll = document.getElementById('btn-view-all');

const summaryIncome = document.getElementById('summary-income');
const summaryExpense = document.getElementById('summary-expense');
const summaryProfit = document.getElementById('summary-profit');

// Login Elements
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('main-app');
const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

const recentTbody = document.getElementById('recent-tbody');
const historyTbody = document.getElementById('history-tbody');
const topSellersTbody = document.getElementById('top-sellers-tbody');

// Form specific elements
const typeSelectors = document.querySelectorAll('input[name="type"]');
const extraSalesFields = document.getElementById('extra-sales-fields');
const productsContainer = document.getElementById('products-container');
const zoneSelect = document.getElementById('zone-select');
const totalSalesAmount = document.getElementById('amount');

const filterBtns = document.querySelectorAll('.filter-btn');

// Dynamic Form Elements
const btnToggleAddProduct = document.getElementById('toggle-add-product');
const btnToggleAddExpense = document.getElementById('toggle-add-expense');
const newProductForm = document.getElementById('new-product-form');
const newExpenseForm = document.getElementById('new-expense-form');
const btnSaveNewProduct = document.getElementById('save-new-product');
const btnSaveNewExpense = document.getElementById('save-new-expense');
const expenseTagsContainer = document.getElementById('expense-tags-container');
const manageForm = document.getElementById('manage-new-product-form');
const manageNameInput = document.getElementById('manage-prod-name');
const managePriceInput = document.getElementById('manage-prod-price');
const manageCategoryInput = document.getElementById('manage-prod-cat');
const btnManageSaveProd = document.getElementById('manage-save-product');
const manageProductsList = document.getElementById('manage-products-list');
const manageExpenseForm = document.getElementById('manage-new-expense-form');
const manageExpenseNameInput = document.getElementById('manage-exp-name');
const btnAddExpenseManage = document.getElementById('btn-add-expense-manage');
const btnManageSaveExpense = document.getElementById('manage-save-expense');
const manageExpenseTagsList = document.getElementById('manage-expense-tags-list');

// Init App
function init() {
    if (document.getElementById('flatpickr-range')) {
        flatpickr("#flatpickr-range", {
            mode: "range",
            locale: "es",
            dateFormat: "d M Y",
            onChange: function (selectedDates) {
                if (selectedDates.length === 2) {
                    customStartDate = selectedDates[0];
                    customEndDate = selectedDates[1];
                    currentFilter = 'custom';
                    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                    updateDashboard();
                    if (views.transactions.classList.contains('active-view')) renderFullHistory();
                }
            }
        });
    }

    setupDateStr();
    setupEventListeners();
    initCharts();
    initFormZones();
    renderProductsList();
    renderExpenseTags();
    renderManageExpenseTags();

    // Auth Check
    if (isAuthenticated()) {
        unlockApp();
    }
}

function unlockApp() {
    loginScreen.style.display = 'none';
    mainApp.style.display = 'flex';

    // Si ya tenemos transacciones locales, las mostramos primero
    if (transactions.length > 0) {
        updateDashboard();
        if (views.transactions.classList.contains('active-view')) renderFullHistory();
    }

    fetchTransactions();
    subscribeProducts();
    subscribeExpenseTags();
}

async function syncProductsToCloud() {
    if (!db || isSyncingProducts) return;

    isSyncingProducts = true;
    try {
        const collectionRef = collection(db, "dashboard_products");
        const existingSnapshot = await getDocs(collectionRef);
        const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
        const nextIds = new Set(customProducts.map(item => item.id));
        const batch = writeBatch(db);

        customProducts.forEach((product, index) => {
            const ref = doc(db, "dashboard_products", product.id);
            batch.set(ref, {
                name: product.name,
                price: product.price,
                category: product.category,
                order: index
            });
        });

        existingIds.forEach(id => {
            if (!nextIds.has(id)) {
                batch.delete(doc(db, "dashboard_products", id));
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar los productos:", error);
    } finally {
        isSyncingProducts = false;
    }
}

async function syncExpenseTagsToCloud() {
    if (!db || isSyncingExpenseTags) return;

    isSyncingExpenseTags = true;
    try {
        const collectionRef = collection(db, "dashboard_expense_tags");
        const existingSnapshot = await getDocs(collectionRef);
        const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
        const nextIds = new Set(customExpenseTags.map(item => item.id));
        const batch = writeBatch(db);

        customExpenseTags.forEach((tag, index) => {
            const ref = doc(db, "dashboard_expense_tags", tag.id);
            batch.set(ref, {
                name: tag.name,
                order: index
            });
        });

        existingIds.forEach(id => {
            if (!nextIds.has(id)) {
                batch.delete(doc(db, "dashboard_expense_tags", id));
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar los accesos de gasto:", error);
    } finally {
        isSyncingExpenseTags = false;
    }
}

function subscribeProducts() {
    if (!db) return;

    const productsQuery = query(collection(db, "dashboard_products"), orderBy("order", "asc"));
    onSnapshot(productsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncProductsToCloud();
            return;
        }

        customProducts = snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        }));
        saveLocalState(STORAGE_KEYS.products, customProducts);
        renderProductsList();
        renderManageProducts();
    }, (error) => {
        console.warn("No se pudieron leer los productos desde Firebase:", error);
    });
}

function subscribeExpenseTags() {
    if (!db) return;

    const tagsQuery = query(collection(db, "dashboard_expense_tags"), orderBy("order", "asc"));
    onSnapshot(tagsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncExpenseTagsToCloud();
            return;
        }

        customExpenseTags = normalizeExpenseTags(snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        })));
        saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
        renderExpenseTags();
        renderManageExpenseTags();
    }, (error) => {
        console.warn("No se pudieron leer los accesos de gasto desde Firebase:", error);
    });
}

// Format Currency
const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount || 0);
};

function normalizeExpenseTags(tags) {
    return (tags || []).map((tag, index) => {
        if (typeof tag === 'string') {
            return { id: `exp_${index}_${tag.toLowerCase().replace(/\s+/g, '_')}`, name: tag, order: index };
        }

        return {
            id: tag.id || `exp_${index}_${(tag.name || '').toLowerCase().replace(/\s+/g, '_')}`,
            name: tag.name || '',
            order: typeof tag.order === 'number' ? tag.order : index
        };
    }).filter(tag => tag.name);
}

// UI Feedback
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `<i class="ph-fill ph-check-circle"></i> ${message}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Setup Listeners
function setupEventListeners() {
    // Login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pw = loginPassword.value;

            if (await authenticate(pw)) {
                loginError.style.display = 'none';
                unlockApp();
            } else {
                loginError.style.display = 'block';
            }
        });
    }

    // Navigation
    navBtns.dashboard.addEventListener('click', () => switchView('dashboard'));
    navBtns.transactions.addEventListener('click', () => switchView('transactions'));
    navBtns.products.addEventListener('click', () => switchView('products'));
    navBtns.backup.addEventListener('click', () => switchView('backup'));
    btnViewAll.addEventListener('click', () => switchView('transactions'));

    // Exports
    document.getElementById('btn-export-image').addEventListener('click', downloadImageSummary);
    document.getElementById('btn-export-csv').addEventListener('click', downloadCSV);

    // Modal
    btnNewTx.addEventListener('click', () => openModal());
    btnCloseModal.addEventListener('click', () => closeModal());

    typeSelectors.forEach(radio => {
        radio.addEventListener('change', (e) => toggleFormType(e.target.value));
    });

    form.addEventListener('submit', handleFormSubmit);

    // Filters
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tgt = e.target.closest('.filter-btn');
            if (!tgt) return;
            filterBtns.forEach(b => b.classList.remove('active'));
            tgt.classList.add('active');
            currentFilter = tgt.dataset.filter;
            updateDashboard();
        });
    });

    // Dynamic Form UI Toggles
    btnToggleAddProduct.addEventListener('click', () => {
        newProductForm.style.display = newProductForm.style.display === 'none' ? 'block' : 'none';
    });

    btnToggleAddExpense.addEventListener('click', () => {
        newExpenseForm.style.display = newExpenseForm.style.display === 'none' ? 'block' : 'none';
    });

    // Save Custom Product
    btnSaveNewProduct.addEventListener('click', () => {
        const name = document.getElementById('new-prod-name').value.trim();
        const price = parseFloat(document.getElementById('new-prod-price').value);
        const cat = document.getElementById('new-prod-cat').value;
        if (name && !isNaN(price)) {
            customProducts = upsertProduct(customProducts, { name, price, category: cat });

            document.getElementById('new-prod-name').value = '';
            document.getElementById('new-prod-price').value = '';
            newProductForm.style.display = 'none';
            saveProductsState();
            showToast("Producto agregado a tu lista");
        }
    });

    // Save Custom Expense Tag
    btnSaveNewExpense.addEventListener('click', () => {
        const name = document.getElementById('new-exp-name').value.trim();
        if (name) {
            customExpenseTags = upsertExpenseTag(customExpenseTags, { name });
            saveExpenseTagsState();

            document.getElementById('new-exp-name').value = '';
            newExpenseForm.style.display = 'none';
            showToast("Atajo agregado");
        }
    });

    // Manage Products view specific events
    const btnAddProductManage = document.getElementById('btn-add-product-manage');
    if (btnAddProductManage) {
        btnAddProductManage.addEventListener('click', () => {
            if (editingProductId) resetManageProductForm();
            manageForm.style.display = manageForm.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (btnManageSaveProd) {
        btnManageSaveProd.addEventListener('click', () => {
            saveManagedProduct();
        });
    }

    if (btnAddExpenseManage) {
        btnAddExpenseManage.addEventListener('click', () => {
            if (editingExpenseTagId) resetManageExpenseForm();
            manageExpenseForm.style.display = manageExpenseForm.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (btnManageSaveExpense) {
        btnManageSaveExpense.addEventListener('click', () => {
            saveManagedExpenseTag();
        });
    }

    if (manageProductsList) {
        manageProductsList.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;

            const { action, id, index, dir } = actionButton.dataset;

            if (action === 'move') {
                moveManagedProduct(Number(index), Number(dir));
            }

            if (action === 'edit') {
                startEditingProduct(id);
            }

            if (action === 'delete') {
                deleteManagedProduct(id);
            }
        });
    }

    if (manageExpenseTagsList) {
        manageExpenseTagsList.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;

            const { action, id, index, dir } = actionButton.dataset;

            if (action === 'expense-move') {
                moveManagedExpenseTag(Number(index), Number(dir));
            }

            if (action === 'expense-edit') {
                startEditingExpenseTag(id);
            }

            if (action === 'expense-delete') {
                deleteManagedExpenseTag(id);
            }
        });
    }
}

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active-view'));
    Object.values(navBtns).forEach(btn => btn.classList.remove('active'));

    views[viewName].classList.add('active-view');
    navBtns[viewName].classList.add('active');

    if (viewName === 'dashboard') updateDashboard();
    if (viewName === 'transactions') renderFullHistory();
    if (viewName === 'products') {
        renderManageProducts();
        renderManageExpenseTags();
    }
}

function openModal() {
    form.reset();

    // Set default date to LOCAL date instead of UTC to avoid "Tomorrow" timezone bugs.
    const tzOffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
    document.getElementById('date').value = localISOTime;

    toggleFormType('income');
    newProductForm.style.display = 'none';
    newExpenseForm.style.display = 'none';

    document.querySelectorAll('.product-qty').forEach(input => input.value = 0);
    calculateSubtotals();

    modal.classList.add('open');
}

function closeModal() {
    modal.classList.remove('open');
}

function initFormZones() {
    zoneSelect.innerHTML = '';
    INITIAL_ZONES.forEach(z => {
        const o = document.createElement('option');
        o.value = o.textContent = z;
        zoneSelect.appendChild(o);
    });
}

function renderProductsList() {
    productsContainer.innerHTML = '';
    const grouped = groupProductsByCategory(customProducts);

    Object.keys(grouped).forEach(cat => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'product-category-group';
        groupDiv.innerHTML = `<h4>${cat}</h4>`;

        grouped[cat].forEach(p => {
            const item = document.createElement('div');
            item.className = 'product-item';
            item.innerHTML = `
                <div class="product-info">
                    <span class="product-name">${p.name}</span>
                    <span class="product-price">$${p.price}</span>
                </div>
                <div class="product-controls">
                    <button type="button" class="qty-btn minus" data-id="${p.id}">-</button>
                    <input type="number" class="product-qty" id="qty_${p.id}" value="0" min="0" data-price="${p.price}">
                    <button type="button" class="qty-btn plus" data-id="${p.id}">+</button>
                </div>
            `;
            groupDiv.appendChild(item);
        });
        productsContainer.appendChild(groupDiv);
    });

    document.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            const input = document.getElementById(`qty_${id}`);
            let val = parseInt(input.value) || 0;
            if (e.target.classList.contains('plus')) val++;
            else if (val > 0) val--;
            input.value = val;
            calculateSubtotals();
        });
    });

    document.querySelectorAll('.product-qty').forEach(input => {
        input.addEventListener('input', calculateSubtotals);
    });
}

function renderManageProducts() {
    manageProductsList.innerHTML = '';

    // Make sure it looks like a grid
    manageProductsList.className = 'view-products-grid';

    customProducts.forEach((p, index) => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                    <button class="btn-icon" data-action="move" data-index="${index}" data-dir="-1" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon" data-action="move" data-index="${index}" data-dir="1" ${index === customProducts.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
                <div>
                    <div style="font-weight: 500;">${p.name} <small style="color:var(--text-muted)">(${p.category})</small></div>
                    <div style="color: var(--success); font-size: 0.9rem;">$${p.price}</div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="edit" data-id="${p.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="delete" data-id="${p.id}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageProductsList.appendChild(div);
    });
}

function saveProductsState() {
    customProducts = customProducts.map((product, index) => ({ ...product, order: index }));
    saveLocalState(STORAGE_KEYS.products, customProducts);
    renderManageProducts();
    renderProductsList();
    syncProductsToCloud();
}

function resetManageProductForm() {
    editingProductId = null;
    manageNameInput.value = '';
    managePriceInput.value = '';
    manageCategoryInput.value = 'Hamburguesas';
    btnManageSaveProd.textContent = 'Guardar';
}

function saveManagedProduct() {
    const name = manageNameInput.value.trim();
    const price = parseFloat(managePriceInput.value);
    const category = manageCategoryInput.value;

    if (!name || isNaN(price)) return;

    if (editingProductId) {
        customProducts = upsertProduct(customProducts, { name, price, category }, editingProductId);
        showToast("Producto actualizado");
    } else {
        customProducts = upsertProduct(customProducts, { name, price, category });
        showToast("Producto guardado");
    }

    saveProductsState();
    resetManageProductForm();
    manageForm.style.display = 'none';
}

function moveManagedProduct(index, dir) {
    customProducts = moveProductInList(customProducts, index, dir);
    saveProductsState();
}

function startEditingProduct(id) {
    const product = customProducts.find(p => p.id === id);
    if (!product) return;

    editingProductId = id;
    manageNameInput.value = product.name;
    managePriceInput.value = product.price;
    manageCategoryInput.value = product.category;
    btnManageSaveProd.textContent = 'Actualizar';
    manageForm.style.display = 'block';
    manageNameInput.focus();
}

function deleteManagedProduct(id) {
    if (confirm("¿Estás seguro de que quieres eliminar este producto?")) {
        customProducts = removeProductById(customProducts, id);
        if (editingProductId === id) {
            resetManageProductForm();
            manageForm.style.display = 'none';
        }
        saveProductsState();
    }
}

function upsertExpenseTag(tags, payload, currentId = null) {
    if (currentId) {
        return tags.map((tag, index) => tag.id === currentId
            ? { ...tag, ...payload, order: index }
            : tag
        );
    }

    return [
        ...tags,
        {
            id: `exp_${Date.now()}`,
            name: payload.name,
            order: tags.length
        }
    ];
}

function moveExpenseTagInList(tags, index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= tags.length) return tags;

    const nextTags = [...tags];
    const temp = nextTags[index];
    nextTags[index] = nextTags[newIndex];
    nextTags[newIndex] = temp;

    return nextTags.map((tag, currentIndex) => ({ ...tag, order: currentIndex }));
}

function removeExpenseTagById(tags, id) {
    return tags
        .filter(tag => tag.id !== id)
        .map((tag, index) => ({ ...tag, order: index }));
}

function saveExpenseTagsState() {
    customExpenseTags = customExpenseTags.map((tag, index) => ({ ...tag, order: index }));
    saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
    renderExpenseTags();
    renderManageExpenseTags();
    syncExpenseTagsToCloud();
}

function resetManageExpenseForm() {
    editingExpenseTagId = null;
    manageExpenseNameInput.value = '';
    btnManageSaveExpense.textContent = 'Guardar';
}

function saveManagedExpenseTag() {
    const name = manageExpenseNameInput.value.trim();
    if (!name) return;

    if (editingExpenseTagId) {
        customExpenseTags = upsertExpenseTag(customExpenseTags, { name }, editingExpenseTagId);
        showToast("Acceso actualizado");
    } else {
        customExpenseTags = upsertExpenseTag(customExpenseTags, { name });
        showToast("Acceso guardado");
    }

    saveExpenseTagsState();
    resetManageExpenseForm();
    manageExpenseForm.style.display = 'none';
}

function renderManageExpenseTags() {
    if (!manageExpenseTagsList) return;

    manageExpenseTagsList.innerHTML = '';
    manageExpenseTagsList.className = 'view-products-grid';

    customExpenseTags.forEach((tag, index) => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                    <button class="btn-icon" data-action="expense-move" data-index="${index}" data-dir="-1" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-up"></i></button>
                    <button class="btn-icon" data-action="expense-move" data-index="${index}" data-dir="1" ${index === customExpenseTags.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="ph ph-caret-down"></i></button>
                </div>
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

function startEditingExpenseTag(id) {
    const tag = customExpenseTags.find(item => item.id === id);
    if (!tag) return;

    editingExpenseTagId = id;
    manageExpenseNameInput.value = tag.name;
    btnManageSaveExpense.textContent = 'Actualizar';
    manageExpenseForm.style.display = 'block';
    manageExpenseNameInput.focus();
}

function moveManagedExpenseTag(index, dir) {
    customExpenseTags = moveExpenseTagInList(customExpenseTags, index, dir);
    saveExpenseTagsState();
}

function deleteManagedExpenseTag(id) {
    if (confirm("Â¿EstÃ¡s seguro de que quieres eliminar este acceso de gasto?")) {
        customExpenseTags = removeExpenseTagById(customExpenseTags, id);
        if (editingExpenseTagId === id) {
            resetManageExpenseForm();
            manageExpenseForm.style.display = 'none';
        }
        saveExpenseTagsState();
    }
}

function downloadImageSummary() {
    const data = getFilteredData();
    const summaryNode = buildExportSummary(data);
    showToast("Generando captura... por favor espera");
    setTimeout(async () => {
        try {
            document.body.appendChild(summaryNode);
            const canvas = await html2canvas(summaryNode, {
                backgroundColor: '#f8fafc',
                scale: 2,
                useCORS: true
            });
            summaryNode.remove();
            const link = document.createElement('a');
            const dStr = new Date().toISOString().slice(0, 10);
            link.download = `Resumen_Barra_${currentFilter}_${dStr}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast("Resumen visual descargado");
        } catch (e) {
            summaryNode.remove();
            console.error(e);
            showToast("Error al generar la imagen");
        }
    }, 600);
}

function getFilterLabel() {
    const labels = {
        day: 'Hoy',
        week: 'Ultimos 7 dias',
        month: 'Este mes',
        year: 'Este ano',
        all: 'Todo el historial',
        custom: customDateLabel || 'Fechas personalizadas'
    };

    return labels[currentFilter] || 'Resumen';
}

function formatExportDate(dateValue) {
    if (!dateValue) return 'Sin fecha';

    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return 'Sin fecha';

    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildExportSummary(data) {
    let ingresos = 0;
    let gastos = 0;

    data.forEach(item => {
        if (item.type === 'income') ingresos += item.amount;
        else gastos += item.amount;
    });

    const recentRows = [...data]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 6)
        .map(item => `
            <tr>
                <td>${formatExportDate(item.date)}</td>
                <td>${item.type === 'income' ? 'Ingreso' : 'Gasto'}</td>
                <td>${item.desc || 'Sin descripcion'}</td>
                <td style="text-align:right; color:${item.type === 'income' ? '#047857' : '#b91c1c'}; font-weight:700;">
                    ${item.type === 'income' ? '+' : '-'}${formatMoney(item.amount)}
                </td>
            </tr>
        `)
        .join('');

    const topSellerRows = getTopSellerStats(data)
        .slice(0, 6)
        .map(([, stats]) => `
            <tr>
                <td>${stats.label}</td>
                <td style="text-align:right;">${stats.qty}</td>
                <td style="text-align:right; font-weight:700;">${formatMoney(stats.total)}</td>
            </tr>
        `)
        .join('');

    const wrapper = document.createElement('div');
    wrapper.className = 'export-summary-canvas';
    wrapper.innerHTML = `
        <div class="export-summary-sheet">
            <div class="export-summary-header">
                <div>
                    <div class="export-kicker">La Barra</div>
                    <h2>Resumen del negocio</h2>
                    <p>${getFilterLabel()}</p>
                </div>
                <div class="export-stamp">
                    <span>Generado</span>
                    <strong>${new Date().toLocaleDateString('es-MX')}</strong>
                </div>
            </div>
            <div class="export-summary-grid">
                <div class="export-stat income">
                    <span>Ventas</span>
                    <strong>${formatMoney(ingresos)}</strong>
                </div>
                <div class="export-stat expense">
                    <span>Gastos</span>
                    <strong>${formatMoney(gastos)}</strong>
                </div>
                <div class="export-stat profit">
                    <span>Ganancia neta</span>
                    <strong>${formatMoney(ingresos - gastos)}</strong>
                </div>
            </div>
            <div class="export-columns">
                <section class="export-panel">
                    <h3>Movimientos recientes</h3>
                    <table class="export-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Descripcion</th>
                                <th style="text-align:right;">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentRows || '<tr><td colspan="4" style="text-align:center; color:#64748b;">Sin movimientos en este periodo</td></tr>'}
                        </tbody>
                    </table>
                </section>
                <section class="export-panel">
                    <h3>Productos vendidos</h3>
                    <table class="export-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th style="text-align:right;">Cantidad</th>
                                <th style="text-align:right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topSellerRows || '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin productos vendidos</td></tr>'}
                        </tbody>
                    </table>
                </section>
            </div>
        </div>
    `;

    return wrapper;
}

function downloadCSV() {
    const data = getFilteredData();
    if (data.length === 0) {
        showToast("No hay datos en este periodo para exportar");
        return;
    }

    let csvContent = "\uFEFFFecha,Tipo,Monto,Categoria,Zona,Descripcion\n";

    data.forEach(t => {
        let type = t.type === 'income' ? 'Ingreso' : 'Gasto';
        let date = "Desconocida";
        try { if (t.date) date = new Date(t.date).toLocaleDateString('es-ES'); } catch (e) { }

        let desc = '"' + (t.desc || '').replace(/"/g, '""') + '"';
        let cat = '"' + (t.category || '').replace(/"/g, '""') + '"';
        let zone = '"' + (t.zone || '').replace(/"/g, '""') + '"';

        csvContent += `${date},${type},${t.amount},${cat},${zone},${desc}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `Respaldo_${currentFilter}_${dStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Respaldo descargado");
}

function renderExpenseTags() {
    expenseTagsContainer.innerHTML = '';
    customExpenseTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'expense-tag';
        btn.textContent = tag.name;
        btn.addEventListener('click', () => {
            document.getElementById('description').value = tag.name;
            showToast("Atajo pegado en descripción");
        });
        expenseTagsContainer.appendChild(btn);
    });
}

function toggleFormType(type) {
    if (type === 'income') {
        extraSalesFields.style.display = 'block';
        document.getElementById('desc-group').style.display = 'none';
        document.getElementById('amount-label').textContent = 'Total Editable de la Venta ($)';
    } else {
        extraSalesFields.style.display = 'none';
        document.getElementById('desc-group').style.display = 'block';
        document.getElementById('amount-label').textContent = 'Monto del Gasto ($)';
    }
}

function calculateSubtotals() {
    let total = 0;
    document.querySelectorAll('.product-qty').forEach(input => {
        const qty = parseInt(input.value) || 0;
        const price = parseFloat(input.dataset.price);
        total += qty * price;
    });
    totalSalesAmount.value = total > 0 ? total : '';
}

function setupDateStr() {
    const today = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').textContent = today.toLocaleDateString('es-ES', options);
}

// Firebase CRUD
async function handleFormSubmit(e) {
    e.preventDefault();
    const type = document.querySelector('input[name="type"]:checked').value;
    const amount = parseFloat(totalSalesAmount.value) || 0;
    const dateVal = document.getElementById('date').value;

    // Almacenar string ISO completo basado en la hora local para evitar offsets raros.
    const nowLocal = new Date();
    const [yy, mm, dd] = dateVal.split('-');
    nowLocal.setFullYear(parseInt(yy), parseInt(mm) - 1, parseInt(dd));

    const dateObj = nowLocal;


    let desc = "";
    let category = "";
    let zone = "";
    let itemsSold = [];
    let itemsSoldArray = []; // V3 Data Structure

    if (type === 'income') {
        document.querySelectorAll('.product-qty').forEach(input => {
            const qty = parseInt(input.value) || 0;
            if (qty > 0) {
                const id = input.id.replace('qty_', '');
                const p = customProducts.find(prod => prod.id === id);
                if (p) {
                    itemsSold.push(`${qty}x ${p.name}`);
                    itemsSoldArray.push({
                        name: p.name,
                        qty: qty,
                        price: p.price,
                        total: p.price * qty,
                        category: p.category
                    });
                }
            }
        });

        zone = zoneSelect.value;
        category = "Venta";
        desc = itemsSold.length > 0 ? itemsSold.join(', ') : "Venta General";
    } else {
        desc = document.getElementById('description').value || "Gasto sin descripción";
        category = "Gastos (General)";
    }

    const newTx = {
        type, amount, desc, category, zone, itemsSoldArray, date: dateObj.toISOString(), createdAt: new Date().toISOString()
    };

    try {
        if (!db) throw new Error("Firebase No Configurado");
        await addDoc(collection(db, "transactions"), newTx);
        closeModal();
        showToast("Registro guardado con éxito");
    } catch (err) {
        console.error("Error guardando:", err);
        showToast("Guardado localmente. Revisar Firebase.");
        newTx.id = "temp_" + Date.now();
        transactions.push(newTx);
        saveLocalState(STORAGE_KEYS.transactions, transactions);
        updateDashboard();
        renderFullHistory();
        closeModal();
    }
}

function fetchTransactions() {
    if (!db) return;
    const q = query(collection(db, "transactions"), orderBy("date", "desc"));

    onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            transactions = [];
            snapshot.forEach((doc) => {
                transactions.push({ id: doc.id, ...doc.data() });
            });
            saveLocalState(STORAGE_KEYS.transactions, transactions);
            updateDashboard();
            if (views.transactions.classList.contains('active-view')) renderFullHistory();
        }
    }, (error) => {
        console.warn("⚠️ No se pudo leer Firebase, usando datos locales:", error);
    });
}

window.deleteTransaction = async (id) => {
    if (confirm("¿Estás seguro de eliminar este registro?")) {
        try {
            if (id.startsWith('temp_')) {
                transactions = transactions.filter(t => t.id !== id);
                saveLocalState(STORAGE_KEYS.transactions, transactions);
                updateDashboard();
                renderFullHistory();
            } else {
                await deleteDoc(doc(db, "transactions", id));
            }
        } catch (e) {
            console.error(e);
        }
    }
};

// Data Processing & Rendering
function getFilteredData() {
    const now = new Date();

    return transactions.filter(t => {
        try {
            if (!t.date) return false;
            const tDate = new Date(t.date);
            if (isNaN(tDate.getTime())) return false;

            if (currentFilter === 'all') return true;

            if (currentFilter === 'custom') {
                if (!customStartDate || !customEndDate) return true; // If custom is selected but dates aren't set, show all.

                // Make inclusive boundary spanning entire visual days
                const startDate = new Date(customStartDate.getFullYear(), customStartDate.getMonth(), customStartDate.getDate());
                const endDate = new Date(customEndDate.getFullYear(), customEndDate.getMonth(), customEndDate.getDate(), 23, 59, 59);
                customDateLabel = 'del ' + startDate.toLocaleDateString('es-ES') + ' al ' + endDate.toLocaleDateString('es-ES');
                return tDate >= startDate && tDate <= endDate;
            }

            if (currentFilter === 'day') {
                return tDate.getFullYear() === now.getFullYear() && tDate.getMonth() === now.getMonth() && tDate.getDate() === now.getDate();
            }
            if (currentFilter === 'week') {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(now.getDate() - 7);
                return tDate >= oneWeekAgo && tDate <= now;
            }
            if (currentFilter === 'month') {
                return tDate.getFullYear() === now.getFullYear() && tDate.getMonth() === now.getMonth();
            }
            if (currentFilter === 'year') {
                return tDate.getFullYear() === now.getFullYear();
            }
            return true;
        } catch (e) {
            return false;
        }
    });
}

function updateDashboard() {
    const data = getFilteredData();

    let ingresos = 0, gastos = 0;
    data.forEach(t => {
        if (t.type === 'income') ingresos += t.amount;
        else gastos += t.amount;
    });

    summaryIncome.textContent = formatMoney(ingresos);
    summaryExpense.textContent = formatMoney(gastos);
    summaryProfit.textContent = formatMoney(ingresos - gastos);

    recentTbody.innerHTML = '';
    const recent = [...data].sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
    });
    if (recent.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted)">Aún no hay transacciones</td></tr>`;
    } else {
        recent.forEach(t => recentTbody.appendChild(createRow(t, false)));
    }

    updateCharts(data);
    renderTopSellers(data);
}

function getItemsForTransaction(transaction) {
    if (Array.isArray(transaction.itemsSoldArray) && transaction.itemsSoldArray.length > 0) {
        return transaction.itemsSoldArray.map(item => ({
            name: item.name,
            qty: Number(item.qty) || 0,
            total: Number(item.total) || ((Number(item.price) || 0) * (Number(item.qty) || 0))
        }));
    }

    if (!transaction.desc || transaction.desc === 'Venta General') return [];

    const normalizedDesc = transaction.desc
        .replace(/\s+[xX]\s+/g, 'x ')
        .replace(/[•|]/g, ',')
        .trim();
    const parts = normalizedDesc.split(/\s*,\s*/).filter(Boolean);
    const parsedItems = parts
        .map(part => {
            const match = part.match(/^(\d+)\s*x\s+(.+)$/i);
            if (!match) return null;
            return {
                qty: parseInt(match[1], 10),
                name: match[2].trim()
            };
        })
        .filter(Boolean);

    if (parsedItems.length === 0) return [];

    const totalQty = parsedItems.reduce((sum, item) => sum + item.qty, 0) || 1;

    return parsedItems.map(item => {
        const product = customProducts.find(prod => prod.name === item.name);
        const fallbackUnitPrice = product ? product.price : (transaction.amount / totalQty);

        return {
            ...item,
            total: fallbackUnitPrice * item.qty
        };
    });
}

function normalizeText(value) {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function toTitleCase(value) {
    return value
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getAggregationMeta(productName) {
    const originalName = (productName || '').trim();
    const normalizedName = normalizeText(originalName);

    const compactComboMatch = normalizedName.match(/^(\d+)\s*x\s*\$?\s*(\d+(?:\.\d+)?)\s+(.+)$/i);
    if (compactComboMatch) {
        const [, qty, price, rawProduct] = compactComboMatch;
        const product = normalizeText(rawProduct);
        return {
            key: `combo:${product}:${qty}:${price}`,
            label: `${qty} ${toTitleCase(product)} por $${price}`
        };
    }

    const naturalComboMatch = normalizedName.match(/^(\d+)\s+(.+?)\s+por\s+\$?\s*(\d+(?:\.\d+)?)$/i);
    if (naturalComboMatch) {
        const [, qty, rawProduct, price] = naturalComboMatch;
        const product = normalizeText(rawProduct);
        return {
            key: `combo:${product}:${qty}:${price}`,
            label: `${qty} ${toTitleCase(product)} por $${price}`
        };
    }

    return {
        key: `name:${normalizedName}`,
        label: originalName
    };
}

function getTopSellerStats(data) {
    const productStats = {};

    data.forEach(t => {
        if (t.type === 'income') {
            const items = getItemsForTransaction(t);

            if (items.length > 0) {
                items.forEach(item => {
                    const aggregation = getAggregationMeta(item.name);
                    if (!productStats[aggregation.key]) {
                        productStats[aggregation.key] = {
                            label: aggregation.label,
                            qty: 0,
                            total: 0
                        };
                    }

                    productStats[aggregation.key].qty += item.qty;
                    productStats[aggregation.key].total += (item.total || 0);
                });
            }
        }
    });

    return Object.entries(productStats)
        .sort((a, b) => {
            if (b[1].qty !== a[1].qty) return b[1].qty - a[1].qty;
            return b[1].total - a[1].total;
        });
}

function renderTopSellers(data) {
    const sorted = getTopSellerStats(data);

    topSellersTbody.innerHTML = '';
    if (sorted.length === 0) {
        topSellersTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Sin datos para mostrar</td></tr>`;
        return;
    }

    sorted.forEach(([name, stats]) => {
        topSellersTbody.innerHTML += `
            <tr>
                <td style="font-weight: 500;">${stats.label || name}</td>
                <td class="align-right">${stats.qty}</td>
                <td class="align-right text-success">${formatMoney(stats.total)}</td>
            </tr>
        `;
    });
}

function createRow(t, showDelete = true) {
    const tr = document.createElement('tr');

    let dateStr = "Fecha desconocida";
    try {
        if (t.date) {
            const d = new Date(t.date);
            if (!isNaN(d.getTime())) {
                const options = { day: '2-digit', month: 'short', year: 'numeric' };
                // Using standard Javascript to ensure formatting always works even if dateFns throws.
                dateStr = d.toLocaleDateString('es-ES', options);
            }
        }
    } catch (e) { }

    const badgeType = t.type === 'income' ? 'Ingreso' : 'Gasto';
    const amountClass = t.type === 'income' ? 'text-success' : 'text-danger';
    const sign = t.type === 'income' ? '+' : '-';
    const zoneBadge = t.zone ? `<small style="display:block; color:var(--primary); font-size:0.75rem;"><i class="ph ph-map-pin"></i> ${t.zone}</small>` : '';

    tr.innerHTML = `
        <td>${dateStr}</td>
        <td><span class="badge ${t.type}">${badgeType}</span></td>
        <td>${t.desc} ${zoneBadge}</td>
        <td>${t.category}</td>
        <td class="align-right" style="font-weight: 600; color: var(--${t.type === 'income' ? 'success' : 'danger'})">
            ${sign}${formatMoney(t.amount)}
        </td>
        ${showDelete ? `<td><button class="btn-text" onclick="deleteTransaction('${t.id}')"><i class="ph ph-trash"></i></button></td>` : ''}
    `;
    return tr;
}

function renderFullHistory() {
    renderTopSellers(transactions);
    historyTbody.innerHTML = '';
    if (transactions.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted)">Aún no hay transacciones</td></tr>`;
        return;
    }
    transactions.forEach(t => historyTbody.appendChild(createRow(t, true)));
}

// Charts Logic
function initCharts() {
    const ctxMain = document.getElementById('mainChart').getContext('2d');
    const ctxCat = document.getElementById('categoryChart').getContext('2d');

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    charts.main = new Chart(ctxMain, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { position: 'top' } }
        }
    });

    charts.category = new Chart(ctxCat, {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } },
            cutout: '75%'
        }
    });
}

function updateCharts(data) {
    const groupedByDay = {};
    data.forEach(t => {
        let day = "N/A";
        try {
            if (t.date) {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    day = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
                }
            }
        } catch (e) { }

        if (!groupedByDay[day]) groupedByDay[day] = { inc: 0, exp: 0 };
        if (t.type === 'income') groupedByDay[day].inc += t.amount;
        else groupedByDay[day].exp += t.amount;
    });

    const labels = Object.keys(groupedByDay).sort();
    const incomes = labels.map(l => groupedByDay[l].inc);
    const expenses = labels.map(l => groupedByDay[l].exp);

    charts.main.data = {
        labels,
        datasets: [
            { label: 'Ingresos', data: incomes, backgroundColor: '#10b981', borderRadius: 4 },
            { label: 'Gastos', data: expenses, backgroundColor: '#ef4444', borderRadius: 4 }
        ]
    };
    charts.main.update();

    const totalInc = data.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExp = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const totalCombined = totalInc + totalExp || 1;

    const pctInc = ((totalInc / totalCombined) * 100).toFixed(1);
    const pctExp = ((totalExp / totalCombined) * 100).toFixed(1);

    if (totalInc === 0 && totalExp === 0) {
        charts.category.data = { labels: ['Sin datos'], datasets: [{ data: [1], backgroundColor: ['#334155'], borderWidth: 0 }] };
        document.getElementById('balance-stats-container').innerHTML = '';
    } else {
        charts.category.data = {
            labels: ['Ingresos', 'Gastos'],
            datasets: [{
                data: [totalInc, totalExp],
                backgroundColor: ['#10b981', '#ef4444'],
                borderWidth: 0
            }]
        };

        const diff = totalInc - totalExp;
        const diffText = diff >= 0 ? 'Ganancia Neta' : 'Pérdida';
        const diffClass = diff >= 0 ? 'profit' : 'loss';

        document.getElementById('balance-stats-container').innerHTML = `
            <div class="balance-stats">
                <div class="balance-stat-item income">
                    <span class="label">Ventas</span>
                    <span class="value">${pctInc}%</span>
                    <span style="font-size:0.8rem">${formatMoney(totalInc)}</span>
                </div>
                <div class="balance-stat-item expense">
                    <span class="label">Gastos</span>
                    <span class="value">${pctExp}%</span>
                    <span style="font-size:0.8rem">${formatMoney(totalExp)}</span>
                </div>
            </div>
            <div class="balance-result ${diffClass}">
                ${diffText}: ${formatMoney(Math.abs(diff))}
            </div>
        `;
    }
    charts.category.update();
}

document.addEventListener('DOMContentLoaded', init);
