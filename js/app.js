import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, getDocs, writeBatch, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { INITIAL_ZONES, INITIAL_PRODUCTS, INITIAL_EXPENSE_TAGS, INITIAL_CATEGORIES } from './constants.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from './storage.js';
import { authenticate, isAuthenticated } from './auth.js';
import { groupProductsByCategory, upsertProduct, moveProductInList, removeProductById } from './product-utils.js';

// State
let transactions = loadLocalState(STORAGE_KEYS.transactions, []);
let currentFilter = 'day'; // Match UI default
let charts = { main: null, category: null };
let customProducts = normalizeProducts(loadLocalState(STORAGE_KEYS.products, INITIAL_PRODUCTS));
let customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(loadLocalState(STORAGE_KEYS.expenseTags, INITIAL_EXPENSE_TAGS)));
let customBranches = sortNamedListAlphabetically(normalizeNamedList(loadLocalState(STORAGE_KEYS.branches, INITIAL_ZONES), 'branch'));
let customCategories = sortNamedListAlphabetically(normalizeNamedList(loadLocalState(STORAGE_KEYS.categories, INITIAL_CATEGORIES), 'cat'));
let openTables = normalizeOpenTables(loadLocalState(STORAGE_KEYS.openTables, []));

let customStartDate = null;
let customEndDate = null;
let customDateLabel = "";
let editingProductId = null;
let editingExpenseTagId = null;
let editingBranchId = null;
let editingCategoryId = null;
let editingTransactionId = null;
let isSyncingProducts = false;
let isSyncingExpenseTags = false;
let isSyncingBranches = false;
let isSyncingCategories = false;
let isSyncingTables = false;
let saleDraft = createEmptySaleDraft();
let activeSaleContext = { mode: 'sale', tableId: null };

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    tables: document.getElementById('view-tables'),
    transactions: document.getElementById('view-transactions'),
    products: document.getElementById('view-products'),
    backup: document.getElementById('view-backup')
};

const navBtns = {
    dashboard: document.getElementById('nav-dashboard'),
    tables: document.getElementById('nav-tables'),
    transactions: document.getElementById('nav-transactions'),
    products: document.getElementById('nav-products'),
    backup: document.getElementById('nav-backup')
};

const modal = document.getElementById('transaction-modal');
const form = document.getElementById('transaction-form');
const btnNewSale = document.getElementById('btn-new-sale');
const btnNewExpense = document.getElementById('btn-new-expense');
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
const btnToggleLoginPassword = document.getElementById('toggle-login-password');

const recentTbody = document.getElementById('recent-tbody');
const historyTbody = document.getElementById('history-tbody');
const topSellersTbody = document.getElementById('top-sellers-tbody');
const branchSalesList = document.getElementById('branch-sales-list');

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
const modalProductCategoryInput = document.getElementById('new-prod-cat');
const btnManageSaveProd = document.getElementById('manage-save-product');
const manageProductsList = document.getElementById('manage-products-list');
const manageProductBranches = document.getElementById('manage-product-branches');
const manageExpenseForm = document.getElementById('manage-new-expense-form');
const manageExpenseNameInput = document.getElementById('manage-exp-name');
const btnAddExpenseManage = document.getElementById('btn-add-expense-manage');
const btnManageSaveExpense = document.getElementById('manage-save-expense');
const manageExpenseTagsList = document.getElementById('manage-expense-tags-list');
const manageCategoryForm = document.getElementById('manage-new-category-form');
const manageCategoryNameInput = document.getElementById('manage-category-name');
const btnAddCategoryManage = document.getElementById('btn-add-category-manage');
const btnManageSaveCategory = document.getElementById('manage-save-category');
const manageCategoriesList = document.getElementById('manage-categories-list');
const manageBranchForm = document.getElementById('manage-new-branch-form');
const manageBranchNameInput = document.getElementById('manage-branch-name');
const manageBranchUseTables = document.getElementById('manage-branch-use-tables');
const btnAddBranchManage = document.getElementById('btn-add-branch-manage');
const btnManageSaveBranch = document.getElementById('manage-save-branch');
const manageBranchesList = document.getElementById('manage-branches-list');
const modalTitle = document.getElementById('transaction-modal-title');
const tablesGrid = document.getElementById('tables-grid');
const tablesBranchFilter = document.getElementById('tables-branch-filter');
const btnRefreshTables = document.getElementById('btn-refresh-tables');
const saleModal = document.getElementById('sale-modal');
const closeSaleModalBtn = document.getElementById('close-sale-modal');
const saleModalTitle = document.getElementById('sale-modal-title');
const saleModalSubtitle = document.getElementById('sale-modal-subtitle');
const saleBranchSelect = document.getElementById('sale-branch-select');
const saleProductsGrid = document.getElementById('sale-products-grid');
const saleOrderItems = document.getElementById('sale-order-items');
const saleItemsCount = document.getElementById('sale-items-count');
const saleTotalInput = document.getElementById('sale-total-input');
const saleTotalDisplay = document.getElementById('sale-total-display');
const salePrimaryAction = document.getElementById('sale-primary-action');
const saleCloseTableBtn = document.getElementById('sale-close-table-btn');
const saleTableBanner = document.getElementById('sale-table-banner');
const saleMobileSwitch = document.getElementById('sale-mobile-switch');
const saleLayout = document.querySelector('.sale-layout');

function createEmptySaleDraft(overrides = {}) {
    return {
        branchId: '',
        items: [],
        total: 0,
        ...overrides
    };
}

function normalizeProduct(product, index = 0) {
    return {
        ...product,
        id: product.id || `p_${index}_${Date.now()}`,
        price: Number(product.price) || 0,
        category: product.category || 'General',
        availableInBranches: Array.isArray(product.availableInBranches)
            ? product.availableInBranches.filter(Boolean)
            : []
    };
}

function normalizeProducts(products) {
    return (products || []).map((product, index) => normalizeProduct(product, index));
}

function normalizeTable(table, index = 0) {
    const items = Array.isArray(table.items)
        ? table.items.map(item => ({
            productId: item.productId || '',
            name: item.name || 'Producto',
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 0
        })).filter(item => item.qty > 0)
        : [];

    return {
        id: table.id || `table_${Date.now()}_${index}`,
        branchId: table.branchId || '',
        name: table.name || `Mesa ${index + 1}`,
        items,
        total: typeof table.total === 'number' ? table.total : getItemsTotal(items),
        status: table.status || 'open',
        createdAt: table.createdAt || new Date().toISOString()
    };
}

function normalizeOpenTables(tables) {
    return (tables || []).map((table, index) => normalizeTable(table, index))
        .filter(table => table.status === 'open');
}

function getItemsTotal(items) {
    return items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
}

function getBranchById(branchId) {
    return customBranches.find(branch => branch.id === branchId) || null;
}

function getBranchNameById(branchId) {
    return getBranchById(branchId)?.name || '';
}

function productAvailableInBranch(product, branchId) {
    if (!product || !branchId) return true;
    return !Array.isArray(product.availableInBranches)
        || product.availableInBranches.length === 0
        || product.availableInBranches.includes(branchId);
}

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
    renderCategoryOptions();
    renderProductsList();
    renderExpenseTags();
    renderManageCategories();
    renderManageBranches();
    renderManageProducts();
    renderManageExpenseTags();
    renderManageProductBranchOptions();
    renderTablesBranchFilter();
    renderTablesView();
    renderSaleBranchOptions();
    setSaleMobilePanel('menu');

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
    subscribeBranches();
    subscribeCategories();
    subscribeOpenTables();
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
                availableInBranches: Array.isArray(product.availableInBranches) ? product.availableInBranches : [],
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

async function syncBranchesToCloud() {
    if (!db || isSyncingBranches) return;

    isSyncingBranches = true;
    try {
        const collectionRef = collection(db, "dashboard_branches");
        const existingSnapshot = await getDocs(collectionRef);
        const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
        const nextIds = new Set(customBranches.map(item => item.id));
        const batch = writeBatch(db);

        customBranches.forEach((branch, index) => {
            const ref = doc(db, "dashboard_branches", branch.id);
            batch.set(ref, { name: branch.name, useTables: Boolean(branch.useTables), order: index });
        });

        existingIds.forEach(id => {
            if (!nextIds.has(id)) {
                batch.delete(doc(db, "dashboard_branches", id));
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar las sucursales:", error);
    } finally {
        isSyncingBranches = false;
    }
}

async function syncOpenTablesToCloud() {
    if (!db || isSyncingTables) return;

    isSyncingTables = true;
    try {
        const collectionRef = collection(db, "dashboard_tables");
        const existingSnapshot = await getDocs(collectionRef);
        const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
        const nextIds = new Set(openTables.map(item => item.id));
        const batch = writeBatch(db);

        openTables.forEach((table) => {
            batch.set(doc(db, "dashboard_tables", table.id), normalizeTable(table));
        });

        existingIds.forEach(id => {
            if (!nextIds.has(id)) {
                batch.delete(doc(db, "dashboard_tables", id));
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar las mesas:", error);
    } finally {
        isSyncingTables = false;
    }
}

async function syncCategoriesToCloud() {
    if (!db || isSyncingCategories) return;

    isSyncingCategories = true;
    try {
        const collectionRef = collection(db, "dashboard_categories");
        const existingSnapshot = await getDocs(collectionRef);
        const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
        const nextIds = new Set(customCategories.map(item => item.id));
        const batch = writeBatch(db);

        customCategories.forEach((category, index) => {
            const ref = doc(db, "dashboard_categories", category.id);
            batch.set(ref, { name: category.name, order: index });
        });

        existingIds.forEach(id => {
            if (!nextIds.has(id)) {
                batch.delete(doc(db, "dashboard_categories", id));
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar las categorías:", error);
    } finally {
        isSyncingCategories = false;
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
        })).map((product, index) => normalizeProduct(product, index));
        saveLocalState(STORAGE_KEYS.products, customProducts);
        renderProductsList();
        renderManageProducts();
        renderSaleProducts();
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

        customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        }))));
        saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
        renderExpenseTags();
        renderManageExpenseTags();
    }, (error) => {
        console.warn("No se pudieron leer los accesos de gasto desde Firebase:", error);
    });
}

function subscribeBranches() {
    if (!db) return;

    const branchesQuery = query(collection(db, "dashboard_branches"), orderBy("order", "asc"));
    onSnapshot(branchesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncBranchesToCloud();
            return;
        }

        customBranches = sortNamedListAlphabetically(normalizeNamedList(snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        })), 'branch'));
        saveLocalState(STORAGE_KEYS.branches, customBranches);
        initFormZones();
        renderManageBranches();
        renderManageProductBranchOptions();
        renderTablesBranchFilter();
        renderSaleBranchOptions();
        renderSaleProducts();
        renderTablesView();
        updateDashboard();
    }, (error) => {
        console.warn("No se pudieron leer las sucursales desde Firebase:", error);
    });
}

function subscribeCategories() {
    if (!db) return;

    const categoriesQuery = query(collection(db, "dashboard_categories"), orderBy("order", "asc"));
    onSnapshot(categoriesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncCategoriesToCloud();
            return;
        }

        customCategories = sortNamedListAlphabetically(normalizeNamedList(snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        })), 'cat'));
        saveLocalState(STORAGE_KEYS.categories, customCategories);
        renderCategoryOptions();
        renderProductsList();
        renderManageCategories();
        renderManageProducts();
    }, (error) => {
        console.warn("No se pudieron leer las categorías desde Firebase:", error);
    });
}

function subscribeOpenTables() {
    if (!db) return;

    const tablesQuery = query(collection(db, "dashboard_tables"), orderBy("createdAt", "asc"));
    onSnapshot(tablesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncOpenTablesToCloud();
            return;
        }

        openTables = normalizeOpenTables(snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        })));
        saveLocalState(STORAGE_KEYS.openTables, openTables);
        renderTablesView();
    }, (error) => {
        console.warn("No se pudieron leer las mesas desde Firebase:", error);
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

function normalizeNamedList(items, prefix) {
    return (items || []).map((item, index) => {
        if (typeof item === 'string') {
            return {
                id: `${prefix}_${index}_${item.toLowerCase().replace(/\s+/g, '_')}`,
                name: item,
                order: index,
                ...(prefix === 'branch' ? { useTables: false } : {})
            };
        }

        const normalizedItem = {
            id: item.id || `${prefix}_${index}_${(item.name || '').toLowerCase().replace(/\s+/g, '_')}`,
            name: item.name || '',
            order: typeof item.order === 'number' ? item.order : index
        };

        if (prefix === 'branch') {
            normalizedItem.useTables = Boolean(item.useTables);
        }

        return normalizedItem;
    }).filter(item => item.name);
}

function sortNamedListAlphabetically(items) {
    return [...items]
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
        .map((item, index) => ({ ...item, order: index }));
}

function hasDuplicateName(items, name, ignoreId = null) {
    const normalizedName = normalizeText(name);
    return items.some(item => item.id !== ignoreId && normalizeText(item.name) === normalizedName);
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

    if (btnToggleLoginPassword) {
        btnToggleLoginPassword.addEventListener('click', () => {
            const isHidden = loginPassword.type === 'password';
            loginPassword.type = isHidden ? 'text' : 'password';
            btnToggleLoginPassword.innerHTML = `<i class="ph ${isHidden ? 'ph-eye-slash' : 'ph-eye'}"></i>`;
        });
    }

    // Navigation
    navBtns.dashboard.addEventListener('click', () => switchView('dashboard'));
    navBtns.tables.addEventListener('click', () => switchView('tables'));
    navBtns.transactions.addEventListener('click', () => switchView('transactions'));
    navBtns.products.addEventListener('click', () => switchView('products'));
    navBtns.backup.addEventListener('click', () => switchView('backup'));
    btnViewAll.addEventListener('click', () => switchView('transactions'));

    // Exports
    document.getElementById('btn-export-image').addEventListener('click', downloadImageSummary);
    document.getElementById('btn-export-csv').addEventListener('click', downloadCSV);

    // Modal
    btnNewSale.addEventListener('click', () => startNewSale());
    btnNewExpense.addEventListener('click', () => openExpenseModal());
    btnCloseModal.addEventListener('click', () => closeModal());
    closeSaleModalBtn.addEventListener('click', () => closeSaleModal());
    saleBranchSelect.addEventListener('change', handleSaleBranchChange);
    saleTotalInput.addEventListener('input', handleSaleTotalInput);
    salePrimaryAction.addEventListener('click', handleSalePrimaryAction);
    saleCloseTableBtn.addEventListener('click', handleCloseActiveTable);

    if (saleMobileSwitch) {
        saleMobileSwitch.addEventListener('click', (event) => {
            const button = event.target.closest('[data-sale-panel]');
            if (!button) return;
            setSaleMobilePanel(button.dataset.salePanel);
        });
    }

    if (tablesBranchFilter) {
        tablesBranchFilter.addEventListener('change', renderTablesView);
    }

    if (btnRefreshTables) {
        btnRefreshTables.addEventListener('click', renderTablesView);
    }

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
        const cat = modalProductCategoryInput.value;
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
            if (hasDuplicateName(customExpenseTags, name)) {
                showToast("Ese atajo ya está registrado");
                return;
            }
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

    if (btnAddCategoryManage) {
        btnAddCategoryManage.addEventListener('click', () => {
            if (editingCategoryId) resetManageCategoryForm();
            manageCategoryForm.style.display = manageCategoryForm.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (btnManageSaveCategory) {
        btnManageSaveCategory.addEventListener('click', () => {
            saveManagedCategory();
        });
    }

    if (btnAddBranchManage) {
        btnAddBranchManage.addEventListener('click', () => {
            if (editingBranchId) resetManageBranchForm();
            manageBranchForm.style.display = manageBranchForm.style.display === 'none' ? 'block' : 'none';
        });
    }

    if (btnManageSaveBranch) {
        btnManageSaveBranch.addEventListener('click', () => {
            saveManagedBranch();
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

            const { action, id } = actionButton.dataset;

            if (action === 'expense-edit') {
                startEditingExpenseTag(id);
            }

            if (action === 'expense-delete') {
                deleteManagedExpenseTag(id);
            }
        });
    }

    if (manageCategoriesList) {
        manageCategoriesList.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;

            const { action, id } = actionButton.dataset;

            if (action === 'category-edit') {
                startEditingCategory(id);
            }

            if (action === 'category-delete') {
                deleteManagedCategory(id);
            }
        });
    }

    if (manageBranchesList) {
        manageBranchesList.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;

            const { action, id } = actionButton.dataset;

            if (action === 'branch-edit') {
                startEditingBranch(id);
            }

            if (action === 'branch-delete') {
                deleteManagedBranch(id);
            }
        });
    }

    if (tablesGrid) {
        tablesGrid.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-table-action]');
            if (!actionButton) return;

            const { tableAction, id } = actionButton.dataset;

            if (tableAction === 'edit') {
                openTableEditor(id);
            }

            if (tableAction === 'charge') {
                closeTable(id);
            }
        });
    }

    if (saleProductsGrid) {
        saleProductsGrid.addEventListener('click', (event) => {
            const button = event.target.closest('[data-product-id]');
            if (!button) return;
            addItemToCurrentSale(button.dataset.productId);
        });
    }

    if (saleOrderItems) {
        saleOrderItems.addEventListener('click', (event) => {
            const button = event.target.closest('[data-sale-action]');
            if (!button) return;

            const { saleAction, id } = button.dataset;

            if (saleAction === 'increase') updateCurrentSaleItemQty(id, 1);
            if (saleAction === 'decrease') updateCurrentSaleItemQty(id, -1);
            if (saleAction === 'remove') removeItemFromCurrentSale(id);
        });
    }
}

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active-view'));
    Object.values(navBtns).forEach(btn => btn.classList.remove('active'));

    views[viewName].classList.add('active-view');
    navBtns[viewName].classList.add('active');

    if (viewName === 'dashboard') updateDashboard();
    if (viewName === 'tables') renderTablesView();
    if (viewName === 'transactions') renderFullHistory();
    if (viewName === 'products') {
        renderManageProducts();
        renderManageExpenseTags();
        renderManageCategories();
        renderManageBranches();
        renderManageProductBranchOptions();
    }
}

function openModal(transaction = null) {
    form.reset();
    editingTransactionId = transaction?.id || null;
    modalTitle.textContent = editingTransactionId ? 'Editar Movimiento' : 'Registrar Movimiento';

    // Set default date to LOCAL date instead of UTC to avoid "Tomorrow" timezone bugs.
    const tzOffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
    document.getElementById('date').value = localISOTime;

    toggleFormType('income');
    newProductForm.style.display = 'none';
    newExpenseForm.style.display = 'none';

    document.querySelectorAll('.product-qty').forEach(input => input.value = 0);
    calculateSubtotals();

    document.getElementById('description').value = '';
    if (transaction) {
        populateTransactionForm(transaction);
    }

    modal.classList.add('open');
}

function closeModal() {
    editingTransactionId = null;
    modalTitle.textContent = 'Registrar Movimiento';
    modal.classList.remove('open');
}

function initFormZones() {
    zoneSelect.innerHTML = '';
    customBranches.forEach(branch => {
        const o = document.createElement('option');
        o.value = o.textContent = branch.name;
        zoneSelect.appendChild(o);
    });
}

function renderSaleBranchOptions() {
    if (!saleBranchSelect) return;

    const selectedBranchId = saleDraft.branchId;
    saleBranchSelect.innerHTML = '';

    customBranches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        saleBranchSelect.appendChild(option);
    });

    if (customBranches.some(branch => branch.id === selectedBranchId)) {
        saleBranchSelect.value = selectedBranchId;
    } else if (customBranches[0]) {
        saleBranchSelect.value = customBranches[0].id;
        saleDraft.branchId = customBranches[0].id;
    }
}

function renderTablesBranchFilter() {
    if (!tablesBranchFilter) return;

    const selectedValue = tablesBranchFilter.value;
    tablesBranchFilter.innerHTML = '<option value="">Todas las sucursales</option>';

    customBranches.filter(branch => branch.useTables).forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        tablesBranchFilter.appendChild(option);
    });

    tablesBranchFilter.value = Array.from(tablesBranchFilter.options).some(option => option.value === selectedValue)
        ? selectedValue
        : '';
}

function renderManageProductBranchOptions(selectedBranchIds = null) {
    if (!manageProductBranches) return;

    const selected = new Set(Array.isArray(selectedBranchIds) ? selectedBranchIds : []);
    manageProductBranches.innerHTML = '';

    customBranches.forEach(branch => {
        const label = document.createElement('label');
        label.className = 'inline-checkbox';
        label.innerHTML = `
            <input type="checkbox" value="${branch.id}" ${selected.has(branch.id) ? 'checked' : ''}>
            <span>${branch.name}</span>
        `;
        manageProductBranches.appendChild(label);
    });
}

function getSelectedManageProductBranches() {
    return Array.from(manageProductBranches?.querySelectorAll('input[type="checkbox"]:checked') || [])
        .map(input => input.value);
}

function renderCategoryOptions() {
    const categoryNames = customCategories.map(item => item.name);

    [manageCategoryInput, modalProductCategoryInput].forEach(select => {
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '';

        categoryNames.forEach(category => {
            const option = document.createElement('option');
            option.value = option.textContent = category;
            select.appendChild(option);
        });

        if (categoryNames.includes(currentValue)) {
            select.value = currentValue;
        }
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
                    <div style="color: var(--text-muted); font-size: 0.8rem;">${Array.isArray(p.availableInBranches) && p.availableInBranches.length > 0 ? `${p.availableInBranches.length} sucursales asignadas` : 'Disponible en todas las sucursales'}</div>
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
    customProducts = customProducts.map((product, index) => ({ ...normalizeProduct(product, index), order: index }));
    saveLocalState(STORAGE_KEYS.products, customProducts);
    renderManageProducts();
    renderProductsList();
    renderSaleProducts();
    syncProductsToCloud();
}

async function renameTransactionsBranch(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;

    transactions = transactions.map((transaction) => transaction.zone === oldName
        ? { ...transaction, zone: newName }
        : transaction
    );
    saveLocalState(STORAGE_KEYS.transactions, transactions);
    updateDashboard();
    if (views.transactions.classList.contains('active-view')) {
        renderFullHistory();
    }

    if (!db) return;

    try {
        const affectedTransactions = await getDocs(query(collection(db, "transactions"), where("zone", "==", oldName)));
        if (affectedTransactions.empty) return;

        const batch = writeBatch(db);
        affectedTransactions.forEach((item) => {
            batch.update(doc(db, "transactions", item.id), { zone: newName });
        });
        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron actualizar las sucursales en el historial:", error);
    }
}

function saveBranchesState() {
    customBranches = sortNamedListAlphabetically(customBranches);
    saveLocalState(STORAGE_KEYS.branches, customBranches);
    initFormZones();
    renderManageBranches();
    renderManageProductBranchOptions();
    renderTablesBranchFilter();
    renderSaleBranchOptions();
    renderSaleProducts();
    renderTablesView();
    updateDashboard();
    syncBranchesToCloud();
}

function saveCategoriesState() {
    customCategories = sortNamedListAlphabetically(customCategories);
    saveLocalState(STORAGE_KEYS.categories, customCategories);
    renderCategoryOptions();
    renderManageCategories();
    renderManageProducts();
    renderProductsList();
    syncCategoriesToCloud();
}

function resetManageProductForm() {
    editingProductId = null;
    manageNameInput.value = '';
    managePriceInput.value = '';
    manageCategoryInput.value = customCategories[0]?.name || '';
    renderManageProductBranchOptions();
    btnManageSaveProd.textContent = 'Guardar';
}

function saveManagedProduct() {
    const name = manageNameInput.value.trim();
    const price = parseFloat(managePriceInput.value);
    const category = manageCategoryInput.value;
    const availableInBranches = getSelectedManageProductBranches();

    if (!name || isNaN(price)) return;

    if (editingProductId) {
        customProducts = upsertProduct(customProducts, { name, price, category, availableInBranches }, editingProductId);
        showToast("Producto actualizado");
    } else {
        customProducts = upsertProduct(customProducts, { name, price, category, availableInBranches });
        showToast("Producto guardado");
    }

    saveProductsState();
    resetManageProductForm();
    manageForm.style.display = 'none';
}

function upsertNamedItem(items, payload, prefix, currentId = null) {
    if (currentId) {
        return items.map(item => item.id === currentId ? { ...item, ...payload } : item);
    }

    return [
        ...items,
        {
            id: `${prefix}_${Date.now()}`,
            name: payload.name,
            order: items.length,
            ...(prefix === 'branch' ? { useTables: Boolean(payload.useTables) } : {})
        }
    ];
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
    renderManageProductBranchOptions(product.availableInBranches || []);
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

function resetManageCategoryForm() {
    editingCategoryId = null;
    manageCategoryNameInput.value = '';
    btnManageSaveCategory.textContent = 'Guardar';
}

function renderManageCategories() {
    if (!manageCategoriesList) return;

    manageCategoriesList.innerHTML = '';
    manageCategoriesList.className = 'view-products-grid';

    customCategories.forEach(category => {
        const div = document.createElement('div');
        div.className = 'product-manage-card';
        div.innerHTML = `
            <div>
                <div style="font-weight: 500;">${category.name}</div>
                <div style="color: var(--text-muted); font-size: 0.85rem;">Categoría disponible</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <button class="btn-icon" data-action="category-edit" data-id="${category.id}"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" data-action="category-delete" data-id="${category.id}"><i class="ph ph-trash"></i></button>
            </div>
        `;
        manageCategoriesList.appendChild(div);
    });
}

function saveManagedCategory() {
    const name = manageCategoryNameInput.value.trim();
    if (!name) return;
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
        saveProductsState();
    }

    customCategories = upsertNamedItem(customCategories, { name }, 'cat', editingCategoryId);
    saveCategoriesState();
    resetManageCategoryForm();
    manageCategoryForm.style.display = 'none';
    showToast(isEditing ? "Categoría actualizada" : "Categoría guardada");
}

function startEditingCategory(id) {
    const category = customCategories.find(item => item.id === id);
    if (!category) return;

    editingCategoryId = id;
    manageCategoryNameInput.value = category.name;
    btnManageSaveCategory.textContent = 'Actualizar';
    manageCategoryForm.style.display = 'block';
    manageCategoryNameInput.focus();
}

function deleteManagedCategory(id) {
    const category = customCategories.find(item => item.id === id);
    if (!category) return;

    const remainingCategories = customCategories.filter(item => item.id !== id);
    if (remainingCategories.length === 0) {
        showToast("Debe quedar al menos una categoría");
        return;
    }

    if (confirm(`¿Eliminar la categoría "${category.name}"? Los productos de esa categoría pasarán a "${remainingCategories[0].name}".`)) {
        customProducts = customProducts.map(product => product.category === category.name
            ? { ...product, category: remainingCategories[0].name }
            : product
        );
        saveProductsState();
        customCategories = remainingCategories;
        saveCategoriesState();
        if (editingCategoryId === id) {
            resetManageCategoryForm();
            manageCategoryForm.style.display = 'none';
        }
        showToast("Categoría eliminada");
    }
}

function resetManageBranchForm() {
    editingBranchId = null;
    manageBranchNameInput.value = '';
    manageBranchUseTables.checked = false;
    btnManageSaveBranch.textContent = 'Guardar';
}

function renderManageBranches() {
    if (!manageBranchesList) return;

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

function saveManagedBranch() {
    const name = manageBranchNameInput.value.trim();
    const useTables = Boolean(manageBranchUseTables.checked);
    if (!name) return;
    const isEditing = Boolean(editingBranchId);
    const existingBranch = editingBranchId
        ? customBranches.find(item => item.id === editingBranchId)
        : null;
    const previousName = existingBranch?.name || null;

    if (hasDuplicateName(customBranches, name, editingBranchId)) {
        showToast("Esa sucursal ya existe");
        return;
    }

    customBranches = upsertNamedItem(customBranches, { name, useTables }, 'branch', editingBranchId);
    saveBranchesState();
    if (previousName && previousName !== name) {
        renameTransactionsBranch(previousName, name);
    }
    resetManageBranchForm();
    manageBranchForm.style.display = 'none';
    showToast(isEditing ? "Sucursal actualizada" : "Sucursal guardada");
}

function startEditingBranch(id) {
    const branch = customBranches.find(item => item.id === id);
    if (!branch) return;

    editingBranchId = id;
    manageBranchNameInput.value = branch.name;
    manageBranchUseTables.checked = Boolean(branch.useTables);
    btnManageSaveBranch.textContent = 'Actualizar';
    manageBranchForm.style.display = 'block';
    manageBranchNameInput.focus();
}

function deleteManagedBranch(id) {
    if (customBranches.length <= 1) {
        showToast("Debe quedar al menos una sucursal");
        return;
    }

    const branch = customBranches.find(item => item.id === id);
    if (!branch) return;

    if (confirm(`¿Eliminar la sucursal "${branch.name}"?`)) {
        customBranches = customBranches.filter(item => item.id !== id);
        saveBranchesState();
        if (editingBranchId === id) {
            resetManageBranchForm();
            manageBranchForm.style.display = 'none';
        }
        showToast("Sucursal eliminada");
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

function removeExpenseTagById(tags, id) {
    return tags
        .filter(tag => tag.id !== id)
        .map((tag, index) => ({ ...tag, order: index }));
}

function saveExpenseTagsState() {
    customExpenseTags = sortNamedListAlphabetically(customExpenseTags);
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

    if (hasDuplicateName(customExpenseTags, name, editingExpenseTagId)) {
        showToast("Ese atajo ya está registrado");
        return;
    }

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
                <div>
                    <div style="font-weight: 500;">${tag.name}</div>
                    <div style="color: var(--text-muted); font-size: 0.85rem;">Atajo de gasto en orden alfabético</div>
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

function deleteManagedExpenseTag(id) {
    if (confirm("¿Estás seguro de que quieres eliminar este acceso de gasto?")) {
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

function openExpenseModal() {
    openModal();
    const expenseRadio = document.querySelector('input[name="type"][value="expense"]');
    if (expenseRadio) {
        expenseRadio.checked = true;
        toggleFormType('expense');
    }
}

function setSaleMobilePanel(panel = 'menu') {
    if (!saleLayout || !saleMobileSwitch) return;

    saleLayout.classList.remove('show-menu', 'show-order');
    saleLayout.classList.add(panel === 'order' ? 'show-order' : 'show-menu');

    saleMobileSwitch.querySelectorAll('[data-sale-panel]').forEach(button => {
        button.classList.toggle('active', button.dataset.salePanel === panel);
    });
}

function startNewSale() {
    if (customBranches.length === 0) {
        showToast("Crea al menos una sucursal antes de registrar ventas");
        return;
    }
    activeSaleContext = { mode: 'sale', tableId: null };
    saleDraft = createEmptySaleDraft({ branchId: customBranches[0]?.id || '' });
    renderSaleBranchOptions();
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    saleModal.classList.add('open');
}

function closeSaleModal() {
    saleModal.classList.remove('open');
    activeSaleContext = { mode: 'sale', tableId: null };
    saleDraft = createEmptySaleDraft();
    setSaleMobilePanel('menu');
}

function updateSaleModalMeta() {
    const branch = getBranchById(saleDraft.branchId);
    const isTableMode = activeSaleContext.mode === 'table';

    saleModalTitle.textContent = isTableMode ? 'Editar Mesa' : 'Registrar Venta';
    saleModalSubtitle.textContent = isTableMode
        ? 'Agrega productos, ajusta cantidades y cobra cuando la mesa esté lista.'
        : 'Selecciona sucursal y arma el pedido.';
    salePrimaryAction.innerHTML = isTableMode
        ? '<i class="ph ph-floppy-disk"></i> Guardar Mesa'
        : `<i class="ph ${branch?.useTables ? 'ph-table' : 'ph-check-circle'}"></i> ${branch?.useTables ? 'Crear Mesa' : 'Guardar Venta'}`;
    saleCloseTableBtn.style.display = isTableMode ? 'flex' : 'none';

    if (isTableMode) {
        const table = openTables.find(item => item.id === activeSaleContext.tableId);
        saleTableBanner.style.display = 'block';
        saleTableBanner.innerHTML = `<strong>${table?.name || 'Mesa abierta'}</strong> · ${branch?.name || 'Sucursal'} · ${saleDraft.items.reduce((sum, item) => sum + item.qty, 0)} productos`;
    } else {
        saleTableBanner.style.display = branch?.useTables ? 'block' : 'none';
        saleTableBanner.textContent = branch?.useTables
            ? 'Esta sucursal usa mesas. Al continuar se abrirá una nueva mesa para editar y cobrar después.'
            : '';
    }
}

function handleSaleBranchChange() {
    saleDraft.branchId = saleBranchSelect.value || customBranches[0]?.id || '';
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
}

function getProductsForBranch(branchId) {
    return customProducts.filter(product => productAvailableInBranch(product, branchId));
}

function renderSaleProducts() {
    if (!saleProductsGrid) return;

    const branchId = saleBranchSelect.value || saleDraft.branchId || customBranches[0]?.id || '';
    saleDraft.branchId = branchId;
    const products = getProductsForBranch(branchId);

    if (products.length === 0) {
        saleProductsGrid.innerHTML = `<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted);">No hay productos disponibles para esta sucursal.</div>`;
        return;
    }

    saleProductsGrid.innerHTML = products.map(product => `
        <article class="sale-product-card">
            <div class="category">${product.category}</div>
            <h4>${product.name}</h4>
            <div class="price">${formatMoney(product.price)}</div>
            <button type="button" class="submit-btn" data-product-id="${product.id}" style="margin-top:auto;">
                <i class="ph ph-plus"></i> Agregar
            </button>
        </article>
    `).join('');
}

function renderSaleSummary() {
    if (!saleOrderItems) return;

    const totalItems = saleDraft.items.reduce((sum, item) => sum + item.qty, 0);
    saleItemsCount.textContent = `${totalItems} producto${totalItems === 1 ? '' : 's'}`;
    saleTotalDisplay.textContent = formatMoney(saleDraft.total);
    saleTotalInput.value = saleDraft.total > 0 ? String(saleDraft.total) : '';

    if (saleDraft.items.length === 0) {
        saleOrderItems.innerHTML = `<div class="card" style="padding: 1rem; text-align:center; color:var(--text-muted);">Todavía no agregas productos.</div>`;
        updateSaleModalMeta();
        return;
    }

    saleOrderItems.innerHTML = saleDraft.items.map(item => `
        <div class="sale-order-row">
            <div>
                <h4>${item.name}</h4>
                <div class="sale-order-meta">${formatMoney(item.price)} c/u · ${formatMoney(item.price * item.qty)}</div>
            </div>
            <div class="sale-order-controls">
                <button type="button" data-sale-action="decrease" data-id="${item.productId}">-</button>
                <span>${item.qty}</span>
                <button type="button" data-sale-action="increase" data-id="${item.productId}">+</button>
                <button type="button" class="delete" data-sale-action="remove" data-id="${item.productId}"><i class="ph ph-trash"></i></button>
            </div>
        </div>
    `).join('');

    updateSaleModalMeta();
}

function syncSaleDraftTotal() {
    saleDraft.total = getItemsTotal(saleDraft.items);
}

function persistActiveSaleDraft() {
    if (activeSaleContext.mode !== 'table' || !activeSaleContext.tableId) return;
    updateTable(activeSaleContext.tableId, {
        branchId: saleDraft.branchId,
        items: saleDraft.items,
        total: saleDraft.total
    });
}

function addItemToCurrentSale(productId) {
    const product = customProducts.find(item => item.id === productId);
    if (!product) return;

    const existing = saleDraft.items.find(item => item.productId === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        saleDraft.items.push({
            productId: product.id,
            name: product.name,
            price: Number(product.price) || 0,
            qty: 1
        });
    }

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
    if (window.innerWidth <= 1024) setSaleMobilePanel('order');
}

function updateCurrentSaleItemQty(productId, delta) {
    saleDraft.items = saleDraft.items
        .map(item => item.productId === productId ? { ...item, qty: item.qty + delta } : item)
        .filter(item => item.qty > 0);

    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
}

function removeItemFromCurrentSale(productId) {
    saleDraft.items = saleDraft.items.filter(item => item.productId !== productId);
    syncSaleDraftTotal();
    persistActiveSaleDraft();
    renderSaleSummary();
}

function handleSaleTotalInput() {
    const manualTotal = parseFloat(saleTotalInput.value);
    saleDraft.total = !isNaN(manualTotal) && manualTotal >= 0 ? manualTotal : getItemsTotal(saleDraft.items);
    persistActiveSaleDraft();
    renderSaleSummary();
}

function buildIncomeTransaction({ branchId, items, total, source = 'sale' }) {
    const branch = getBranchById(branchId);
    const desc = items.length > 0
        ? items.map(item => `${item.qty}x ${item.name}`).join(', ')
        : 'Venta General';

    return {
        type: 'income',
        amount: Number(total) || 0,
        desc,
        category: 'Venta',
        branch: branchId || '',
        zone: branch?.name || '',
        branchId: branchId || '',
        itemsSoldArray: items.map(item => ({
            productId: item.productId,
            name: item.name,
            qty: Number(item.qty) || 0,
            price: Number(item.price) || 0,
            total: (Number(item.price) || 0) * (Number(item.qty) || 0),
            category: customProducts.find(product => product.id === item.productId)?.category || ''
        })),
        products: items.map(item => ({ ...item })),
        source,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString()
    };
}

async function saveTransactionRecord(newTx, successMessage = 'Registro guardado con éxito') {
    try {
        if (!db) throw new Error("Firebase No Configurado");
        await addDoc(collection(db, "transactions"), newTx);
        showToast(successMessage);
        return true;
    } catch (err) {
        console.error("Error guardando:", err);
        showToast("Guardado localmente. Revisar Firebase.");
        const localTx = { ...newTx, id: `temp_${Date.now()}` };
        transactions = [localTx, ...transactions];
        saveLocalState(STORAGE_KEYS.transactions, transactions);
        updateDashboard();
        if (views.transactions.classList.contains('active-view')) renderFullHistory();
        return false;
    }
}

async function handleSalePrimaryAction() {
    const branchId = saleBranchSelect.value || saleDraft.branchId || customBranches[0]?.id || '';
    const branch = getBranchById(branchId);

    if (!branch) {
        showToast("Selecciona una sucursal");
        return;
    }

    saleDraft.branchId = branchId;

    if (branch.useTables && activeSaleContext.mode !== 'table') {
        const table = createTable(branchId);
        saleDraft = createEmptySaleDraft({
            branchId,
            items: table.items,
            total: table.total
        });
        activeSaleContext = { mode: 'table', tableId: table.id };
        switchView('tables');
        renderSaleSummary();
        updateSaleModalMeta();
        showToast(`${table.name} creada`);
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
        switchView('tables');
        return;
    }

    const newTx = buildIncomeTransaction({
        branchId,
        items: saleDraft.items,
        total: saleDraft.total,
        source: 'sale'
    });
    await saveTransactionRecord(newTx, 'Venta guardada con éxito');
    closeSaleModal();
}

async function handleCloseActiveTable() {
    if (!activeSaleContext.tableId) return;
    await closeTable(activeSaleContext.tableId);
}

function getOpenTables(branchId = '') {
    return openTables.filter(table => table.status === 'open' && (!branchId || table.branchId === branchId));
}

function saveOpenTablesState() {
    openTables = normalizeOpenTables(openTables);
    saveLocalState(STORAGE_KEYS.openTables, openTables);
    renderTablesView();
    syncOpenTablesToCloud();
}

function getNextTableName(branchId) {
    const maxNumber = getOpenTables(branchId)
        .map(table => {
            const match = String(table.name || '').match(/Mesa\s+(\d+)/i);
            return match ? Number(match[1]) : 0;
        })
        .reduce((max, value) => Math.max(max, value), 0);

    return `Mesa ${maxNumber + 1}`;
}

function createTable(branchId) {
    const table = normalizeTable({
        id: `table_${Date.now()}`,
        branchId,
        name: getNextTableName(branchId),
        items: [],
        total: 0,
        status: 'open',
        createdAt: new Date().toISOString()
    });

    openTables = [...openTables, table];
    saveOpenTablesState();
    return table;
}

function saveTable(table) {
    const normalized = normalizeTable(table);
    const exists = openTables.some(item => item.id === normalized.id);
    openTables = exists
        ? openTables.map(item => item.id === normalized.id ? normalized : item)
        : [...openTables, normalized];
    saveOpenTablesState();
    return normalized;
}

function updateTable(tableId, patch) {
    const current = openTables.find(item => item.id === tableId);
    if (!current) return null;

    const nextTable = normalizeTable({
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch)
    });
    return saveTable(nextTable);
}

function deleteTable(tableId) {
    openTables = openTables.filter(item => item.id !== tableId);
    saveOpenTablesState();
}

function addItemToTable(tableId, productId) {
    const table = openTables.find(item => item.id === tableId);
    if (!table) return null;
    const product = customProducts.find(item => item.id === productId);
    if (!product) return table;

    const items = [...table.items];
    const existing = items.find(item => item.productId === productId);

    if (existing) existing.qty += 1;
    else items.push({ productId, name: product.name, price: product.price, qty: 1 });

    return updateTable(tableId, { items, total: getItemsTotal(items) });
}

function removeItemFromTable(tableId, productId) {
    const table = openTables.find(item => item.id === tableId);
    if (!table) return null;
    const items = table.items.filter(item => item.productId !== productId);
    return updateTable(tableId, { items, total: getItemsTotal(items) });
}

function updateItemQty(tableId, productId, delta) {
    const table = openTables.find(item => item.id === tableId);
    if (!table) return null;
    const items = table.items
        .map(item => item.productId === productId ? { ...item, qty: item.qty + delta } : item)
        .filter(item => item.qty > 0);
    return updateTable(tableId, { items, total: getItemsTotal(items) });
}

function openTableEditor(tableId) {
    const table = openTables.find(item => item.id === tableId);
    if (!table) return;

    activeSaleContext = { mode: 'table', tableId };
    saleDraft = createEmptySaleDraft({
        branchId: table.branchId,
        items: table.items.map(item => ({ ...item })),
        total: Number(table.total) || getItemsTotal(table.items)
    });
    renderSaleBranchOptions();
    saleBranchSelect.value = table.branchId;
    saleDraft.branchId = table.branchId;
    renderSaleProducts();
    renderSaleSummary();
    updateSaleModalMeta();
    setSaleMobilePanel('menu');
    saleModal.classList.add('open');
}

function renderTablesView() {
    if (!tablesGrid) return;

    const branchId = tablesBranchFilter?.value || '';
    const filteredTables = getOpenTables(branchId);

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
            <div class="table-card-actions">
                <button type="button" class="submit-btn" data-table-action="edit" data-id="${table.id}"><i class="ph ph-pencil-simple"></i> Editar</button>
                <button type="button" class="submit-btn" style="background: var(--success);" data-table-action="charge" data-id="${table.id}"><i class="ph ph-currency-circle-dollar"></i> Cobrar</button>
            </div>
        </article>
    `).join('');
}

async function closeTable(tableId) {
    const table = openTables.find(item => item.id === tableId);
    if (!table) return;

    if ((Number(table.total) || 0) <= 0) {
        showToast("La mesa no tiene total para cobrar");
        return;
    }

    const transaction = buildIncomeTransaction({
        branchId: table.branchId,
        items: table.items,
        total: table.total,
        source: 'table'
    });

    await saveTransactionRecord(transaction, `${table.name} cobrada con éxito`);
    deleteTable(tableId);

    if (activeSaleContext.tableId === tableId) {
        closeSaleModal();
    }
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

function populateTransactionForm(transaction) {
    if (!transaction) return;

    const type = transaction.type === 'expense' ? 'expense' : 'income';
    const selectedType = document.querySelector(`input[name="type"][value="${type}"]`);
    if (selectedType) {
        selectedType.checked = true;
        toggleFormType(type);
    }

    const date = transaction.date ? new Date(transaction.date) : new Date();
    if (!isNaN(date.getTime())) {
        const tzOffset = date.getTimezoneOffset() * 60000;
        document.getElementById('date').value = new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
    }

    totalSalesAmount.value = Number(transaction.amount) || '';
    document.getElementById('description').value = type === 'expense' ? (transaction.desc || '') : '';

    if (type === 'income') {
        if (transaction.zone && !customBranches.some(branch => branch.name === transaction.zone)) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = fallbackOption.textContent = transaction.zone;
            zoneSelect.appendChild(fallbackOption);
        }
        zoneSelect.value = transaction.zone || customBranches[0]?.name || '';

        const itemsByName = new Map(
            getItemsForTransaction(transaction).map(item => [item.name, Number(item.qty) || 0])
        );

        document.querySelectorAll('.product-qty').forEach(input => {
            const id = input.id.replace('qty_', '');
            const product = customProducts.find(prod => prod.id === id);
            input.value = product ? (itemsByName.get(product.name) || 0) : 0;
        });
        calculateSubtotals();
    }
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

        zone = zoneSelect.value || customBranches[0]?.name || '';
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
        if (editingTransactionId && !editingTransactionId.startsWith('temp_')) {
            await updateDoc(doc(db, "transactions", editingTransactionId), newTx);
            showToast("Registro actualizado con éxito");
        } else if (editingTransactionId && editingTransactionId.startsWith('temp_')) {
            transactions = transactions.map(item => item.id === editingTransactionId ? { ...item, ...newTx, id: editingTransactionId } : item);
            saveLocalState(STORAGE_KEYS.transactions, transactions);
            updateDashboard();
            renderFullHistory();
            showToast("Registro actualizado localmente");
        } else {
            await addDoc(collection(db, "transactions"), newTx);
            showToast("Registro guardado con éxito");
        }
        closeModal();
    } catch (err) {
        console.error("Error guardando:", err);
        showToast("Guardado localmente. Revisar Firebase.");
        newTx.id = editingTransactionId || ("temp_" + Date.now());
        const exists = transactions.some(item => item.id === newTx.id);
        transactions = exists
            ? transactions.map(item => item.id === newTx.id ? newTx : item)
            : [...transactions, newTx];
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

window.editTransaction = (id) => {
    const transaction = transactions.find(item => item.id === id);
    if (!transaction) return;
    openModal(transaction);
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
    renderBranchSalesSummary(data);
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

function renderBranchSalesSummary(data) {
    if (!branchSalesList) return;

    const salesByBranch = customBranches.map(branch => ({
        name: branch.name,
        total: data
            .filter(item => item.type === 'income' && item.zone === branch.name)
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    }));

    branchSalesList.innerHTML = salesByBranch.map(branch => `
        <div class="branch-sales-item">
            <span>${branch.name}</span>
            <strong>${formatMoney(branch.total)}</strong>
        </div>
    `).join('');
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
        ${showDelete ? `<td><div class="history-actions"><button class="btn-text" onclick="editTransaction('${t.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button><button class="btn-text" onclick="deleteTransaction('${t.id}')" title="Eliminar"><i class="ph ph-trash"></i></button></div></td>` : ''}
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
    const branchBreakdown = customBranches
        .map(branch => ({
            name: branch.name,
            total: data
                .filter(item => item.type === 'income' && item.zone === branch.name)
                .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
        }))
        .filter(item => item.total > 0);

    if (branchBreakdown.length === 0) {
        charts.category.data = { labels: ['Sin datos'], datasets: [{ data: [1], backgroundColor: ['#334155'], borderWidth: 0 }] };
        document.getElementById('balance-stats-container').innerHTML = '';
    } else {
        charts.category.data = {
            labels: branchBreakdown.map(item => item.name),
            datasets: [{
                data: branchBreakdown.map(item => item.total),
                backgroundColor: ['#10b981', '#0ea5e9', '#f59e0b', '#f97316', '#8b5cf6', '#14b8a6'],
                borderWidth: 0
            }]
        };

        const diff = totalInc - totalExp;
        const diffText = diff >= 0 ? 'Ganancia Neta' : 'Pérdida';
        const diffClass = diff >= 0 ? 'profit' : 'loss';

        document.getElementById('balance-stats-container').innerHTML = `
            <div class="balance-stats">
                <div class="balance-stat-item income">
                    <span class="label">Ventas Totales</span>
                    <span class="value">${formatMoney(totalInc)}</span>
                    <span style="font-size:0.8rem">${branchBreakdown.length} sucursales con ventas</span>
                </div>
                <div class="balance-stat-item expense">
                    <span class="label">Gastos</span>
                    <span class="value">${formatMoney(totalExp)}</span>
                    <span style="font-size:0.8rem">Total del periodo</span>
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const isLocalDevHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);

        if (isLocalDevHost) {
            navigator.serviceWorker.getRegistrations()
                .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
                .then(() => caches.keys())
                .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
                .catch((error) => {
                    console.warn('No se pudieron limpiar los service workers locales:', error);
                });
            return;
        }

        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('No se pudo registrar el service worker:', error);
        });
    });
}
