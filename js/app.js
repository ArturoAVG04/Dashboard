// js/app.js - Modern Clean Orchestrator for Dashboard App
import { db } from './config/firebase-config.js';
import { STORAGE_KEYS, loadLocalState, saveLocalState } from './config/storage.js';
import { authenticate, isAuthenticated } from './core/auth.js';
import { getLocalDateInputValue, createLocalDateFromInput, isSameLocalDate } from './core/date-utils.js';
import { showToast, scrollToTop, initModalScrollLock } from './core/ui-feedback.js';

// Services
import {
    getCustomBranches,
    subscribeBranches,
    getBranchById
} from './services/branches-service.js';
import {
    getCustomProducts,
    getCustomCategories,
    getCustomExpenseTags,
    subscribeProducts,
    subscribeCategories,
    subscribeExpenseTags
} from './services/products-service.js';
import {
    getOpenTables,
    subscribeOpenTables,
    deleteTable
} from './services/tables-service.js';
import {
    getTransactions,
    fetchTransactions,
    deleteTransactionRecord,
    syncStrandedOfflineTransactions
} from './services/transactions-service.js';

// UI Controllers
import {
    initCharts,
    updateCharts
} from './ui/charts-ui.js';
import {
    downloadCSV,
    downloadImageSummary,
    downloadFullBackup
} from './ui/backup-ui.js';
import {
    updateDashboardSummaryCards,
    renderRecentTransactions,
    renderBranchSalesSummary,
    renderProductsPeriodSummary,
    getTopSellerStats
} from './ui/dashboard-ui.js';
import {
    renderTablesView,
    renderTablesBranchFilter
} from './ui/tables-ui.js';
import {
    renderFullHistory,
    toggleTopSellersSection,
    toggleTopExpensesSection,
    toggleTopExpensesMode,
    setCollapsibleSectionState,
    toggleHistoryTransactionsSection
} from './ui/history-ui.js';
import {
    renderCategoryOptions,
    renderManageProducts,
    renderManageCategories,
    renderManageBranches,
    renderManageProductBranchOptions,
    saveManagedProduct,
    saveManagedCategory,
    saveManagedBranch,
    startEditingProduct,
    startEditingCategory,
    startEditingBranch,
    deleteManagedProduct,
    deleteManagedCategory,
    deleteManagedBranch,
    moveManagedProduct,
    reorderCategories,
    sortProductsAlphabetically,
    sortCategoriesAlphabetically,
    resetManageProductForm,
    resetManageCategoryForm,
    resetManageBranchForm,
    handleBranchScheduleChange,
    updateBranchSessionOptions
} from './ui/products-ui.js';
import {
    renderSessionsSection,
    handleSessionsSectionClick,
    handleSessionModalClick,
    handleSessionModalInput,
    closeSessionModal,
    runScheduleTick,
    setSessionsChangeHandler
} from './ui/sessions-ui.js';
import { subscribeSessions } from './services/sessions-service.js';
import {
    renderManageModifiers,
    toggleModifierForm,
    closeModifierForm,
    addModifierOptionRow,
    handleModifierFormClick,
    handleModifierTypeChange,
    saveManagedModifier,
    startEditingModifier,
    deleteManagedModifier,
    migrateLegacyModifiers
} from './ui/modifiers-ui.js';
import {
    renderManageInventory,
    renderInventoryUnitOptions,
    toggleInventoryForm,
    closeInventoryForm,
    saveManagedInventoryItem,
    handleInventoryPanelClick,
    updateConsumerHints
} from './ui/inventory-ui.js';
import { subscribeModifierGroups, getProductModifierGroups } from './services/modifier-groups-service.js';
import { subscribeInventoryItems } from './services/inventory-service.js';
import {
    renderExpenseTags,
    renderManageExpenseTags,
    openExpenseModal,
    closeModal,
    handleExpenseFormSubmit,
    handleExpenseTagsContainerClick,
    handleExpenseSearchInput,
    addExpenseTagFromModal,
    handleManageExpenseTagGroupChange,
    saveManagedExpenseTag,
    startEditingExpenseTag,
    deleteManagedExpenseTag,
    resetManageExpenseForm,
    saveManagedExpenseGroup,
    startEditingExpenseGroup,
    deleteManagedExpenseGroup,
    resetManageExpenseGroupForm
} from './ui/expenses-ui.js';
import { subscribeExpenseGroups } from './services/expense-groups-service.js';
import {
    startNewSale,
    closeSaleModal,
    openSaleEditor,
    openTableEditor,
    renderSaleBranchOptions,
    renderSaleProducts,
    renderSaleSummary,
    setSaleMobilePanel,
    handleSaleBranchChange,
    handleSaleDateChange,
    handleSaleTimeInput,
    handleSaleTotalInput,
    handleSalePrimaryAction,
    handleCloseActiveTable,
    openModifiersModal,
    closeModifiersModal,
    updateModifiersModalTotal,
    confirmAddProductWithModifiers,
    enforceModifierMaxSelect,
    addItemToCurrentSale,
    updateCurrentSaleItemQty,
    removeItemFromCurrentSale
} from './ui/pos-ui.js';

// State
let currentFilter = 'day';
let customStartDate = null;
let customEndDate = null;
let customDateLabel = '';
let mainTypeFilter = 'all';
let historyTypeFilter = 'all';
let historySearchTerm = '';

let views = {};
let navBtns = {};

// View Management
const VIEW_TITLES = {
    dashboard: 'Principal',
    sessions: 'Jornadas',
    tables: 'Mesas',
    transactions: 'Historial',
    products: 'Productos y configuración',
    backup: 'Respaldos'
};
// El historial muestra todos los movimientos (tiene su propio buscador), por eso no lleva filtros de periodo
const VIEWS_WITH_PERIOD_FILTERS = ['dashboard', 'backup'];

let recentTransactionsVisible = true;

function setProductsTab(tabName) {
    const tabs = document.querySelectorAll('[data-products-tab]');
    if (![...tabs].some(tab => tab.dataset.productsTab === tabName)) tabName = 'products';
    tabs.forEach(tab => {
        const isActive = tab.dataset.productsTab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-products-panel]').forEach(panel => {
        panel.hidden = panel.dataset.productsPanel !== tabName;
    });
    saveLocalState(STORAGE_KEYS.productsTab, tabName);
}

export function switchView(viewName) {
    Object.values(views).forEach(v => v?.classList.remove('active-view'));
    Object.values(navBtns).forEach(btn => btn?.classList.remove('active'));

    if (views[viewName]) views[viewName].classList.add('active-view');
    if (navBtns[viewName]) navBtns[viewName].classList.add('active');
    Object.entries(navBtns).forEach(([name, btn]) => {
        if (btn) btn.setAttribute('aria-current', name === viewName ? 'page' : 'false');
    });

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = VIEW_TITLES[viewName] || 'Principal';
    // Los filtros de periodo solo aplican a las vistas que muestran movimientos
    const headerControls = document.getElementById('header-controls');
    if (headerControls) headerControls.hidden = !VIEWS_WITH_PERIOD_FILTERS.includes(viewName);

    if (viewName === 'dashboard') updateDashboard();
    if (viewName === 'sessions') renderSessionsSection();
    if (viewName === 'tables') renderTablesView(getTransactions());
    if (viewName === 'transactions') renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    if (viewName === 'products') {
        renderManageProducts();
        renderManageExpenseTags();
        renderManageCategories();
        renderManageBranches();
        renderManageProductBranchOptions();
        renderManageModifiers();
        renderManageInventory();
    }

    scrollToTop();
}

// Data Filtering & Calculations
export function getFilteredData() {
    const now = new Date();
    const transactions = getTransactions();

    return transactions.filter(t => {
        try {
            if (!t.date) return false;
            const tDate = new Date(t.date);
            if (isNaN(tDate.getTime())) return false;

            if (mainTypeFilter !== 'all' && t.type !== mainTypeFilter) return false;
            if (currentFilter === 'all') return true;

            if (currentFilter === 'custom') {
                if (!customStartDate || !customEndDate) return true;
                const startDate = new Date(customStartDate.getFullYear(), customStartDate.getMonth(), customStartDate.getDate());
                const endDate = new Date(customEndDate.getFullYear(), customEndDate.getMonth(), customEndDate.getDate(), 23, 59, 59);
                return tDate >= startDate && tDate <= endDate;
            }

            if (currentFilter === 'day') {
                return isSameLocalDate(tDate, now);
            }
            if (currentFilter === 'week') {
                const dayOfWeek = now.getDay() || 7;
                const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
                const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 7, 23, 59, 59);
                return tDate >= monday && tDate <= sunday;
            }
            if (currentFilter === 'month') {
                return tDate.getFullYear() === now.getFullYear() && tDate.getMonth() === now.getMonth();
            }
            if (currentFilter === 'year') {
                return tDate.getFullYear() === now.getFullYear();
            }
        } catch (e) {
            return false;
        }
        return false;
    });
}

export function getFilterLabel() {
    const labels = {
        day: 'Hoy',
        week: 'Esta semana',
        month: 'Este mes',
        year: 'Este año',
        all: 'Todo el historial',
        custom: customDateLabel || 'Fechas personalizadas'
    };
    return labels[currentFilter] || 'Resumen';
}

export function updateDashboard() {
    renderSessionsSection();
    const filtered = getFilteredData();
    const customProducts = getCustomProducts();

    updateDashboardSummaryCards(filtered);
    renderRecentTransactions(filtered);
    renderBranchSalesSummary(filtered);
    renderProductsPeriodSummary(filtered, getFilterLabel(), customProducts);
    updateCharts(filtered);
}

// Global actions exposed to inline buttons
window.deleteTransaction = async (id) => {
    if (confirm("¿Estás seguro de eliminar este registro?")) {
        await deleteTransactionRecord(id);
        updateDashboard();
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
        renderTablesView(getTransactions());
        showToast("Registro eliminado");
    }
};

window.editTransaction = (id) => {
    const transactions = getTransactions();
    const transaction = transactions.find(item => item.id === id);
    if (!transaction) return;
    if (transaction.type === 'income') {
        openSaleEditor(transaction);
    } else {
        openExpenseModal(transaction);
    }
};

// Event Listeners Setup
function setupEventListeners() {
    // Navigation
    navBtns.dashboard?.addEventListener('click', () => switchView('dashboard'));
    navBtns.sessions?.addEventListener('click', () => switchView('sessions'));
    navBtns.tables?.addEventListener('click', () => switchView('tables'));
    navBtns.transactions?.addEventListener('click', () => switchView('transactions'));
    navBtns.products?.addEventListener('click', () => switchView('products'));
    navBtns.backup?.addEventListener('click', () => switchView('backup'));
    document.getElementById('btn-view-all')?.addEventListener('click', () => switchView('transactions'));
    document.getElementById('btn-toggle-recent-transactions')?.addEventListener('click', (e) => {
        recentTransactionsVisible = !recentTransactionsVisible;
        setCollapsibleSectionState(document.getElementById('recent-transactions-panel'), e.currentTarget, recentTransactionsVisible);
    });

    // Pestañas de Productos y configuración
    document.querySelector('#view-products .tabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-products-tab]');
        if (tab) setProductsTab(tab.dataset.productsTab);
    });
    setProductsTab(loadLocalState(STORAGE_KEYS.productsTab, 'products'));

    // Dashboard Time Filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    const customDateTrigger = document.getElementById('custom-date-trigger');

    let customDatePicker = null;
    if (typeof flatpickr !== 'undefined' && customDateTrigger) {
        customDatePicker = flatpickr(customDateTrigger, {
            mode: "range",
            dateFormat: "Y-m-d",
            locale: "es",
            onClose: (selectedDates) => {
                if (selectedDates.length === 2) {
                    customStartDate = selectedDates[0];
                    customEndDate = selectedDates[1];
                    currentFilter = 'custom';
                    filterBtns.forEach(b => b.classList.remove('active'));
                    customDateTrigger.classList.add('active');
                    customDateLabel = `del ${customStartDate.toLocaleDateString('es-ES')} al ${customEndDate.toLocaleDateString('es-ES')}`;
                    const shortDate = (date) => date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
                    customDateTrigger.innerHTML = `<i class="ph ph-calendar-check"></i> <span>${shortDate(customStartDate)} – ${shortDate(customEndDate)}</span>`;
                    updateDashboard();
                }
            }
        });
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tgt = e.target.closest('.filter-btn');
            if (!tgt || !tgt.dataset.filter) return;
            filterBtns.forEach(b => b.classList.remove('active'));
            if (customDateTrigger) {
                customDateTrigger.classList.remove('active');
                customDateTrigger.innerHTML = '<i class="ph ph-calendar-blank"></i> <span>Fechas</span>';
            }
            tgt.classList.add('active');
            currentFilter = tgt.dataset.filter;
            updateDashboard();
        });
    });

    // Main Type Filters
    const mainTypeFilters = document.getElementById('main-type-filters');
    if (mainTypeFilters) {
        mainTypeFilters.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-type-filter]');
            if (!btn) return;
            mainTypeFilter = btn.dataset.typeFilter || 'all';
            mainTypeFilters.querySelectorAll('.type-filter-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.typeFilter === mainTypeFilter);
            });
            updateDashboard();
            if (views.transactions?.classList.contains('active-view')) {
                renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
            }
        });
    }

    // History Filters & Search
    const historyTypeFilterSelect = document.getElementById('history-type-filter');
    const historySearchInput = document.getElementById('history-search');

    historyTypeFilterSelect?.addEventListener('change', () => {
        historyTypeFilter = historyTypeFilterSelect.value || 'all';
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    historySearchInput?.addEventListener('input', () => {
        historySearchTerm = historySearchInput.value || '';
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    // Collapsible Panels
    document.getElementById('btn-toggle-top-sellers')?.addEventListener('click', () => {
        toggleTopSellersSection();
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    document.getElementById('btn-toggle-top-expenses')?.addEventListener('click', () => {
        toggleTopExpensesSection();
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    document.getElementById('btn-top-expenses-mode')?.addEventListener('click', () => {
        toggleTopExpensesMode();
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    document.getElementById('btn-toggle-history-transactions')?.addEventListener('click', () => {
        toggleHistoryTransactionsSection();
        renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
    });

    // POS & Sales Events
    document.getElementById('btn-new-sale')?.addEventListener('click', () => startNewSale());
    document.getElementById('close-sale-modal')?.addEventListener('click', () => closeSaleModal());
    document.getElementById('sale-branch-select')?.addEventListener('change', handleSaleBranchChange);
    document.getElementById('sale-date-input')?.addEventListener('change', handleSaleDateChange);
    document.getElementById('sale-time-input')?.addEventListener('input', handleSaleTimeInput);
    document.getElementById('sale-total-input')?.addEventListener('input', handleSaleTotalInput);
    document.getElementById('sale-primary-action')?.addEventListener('click', () => handleSalePrimaryAction({
        onUpdate: () => {
            updateDashboard();
            renderTablesView(getTransactions());
            if (views.transactions?.classList.contains('active-view')) {
                renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
            }
        },
        switchView
    }));
    document.getElementById('sale-close-table-btn')?.addEventListener('click', () => handleCloseActiveTable({
        onUpdate: () => {
            updateDashboard();
            renderTablesView(getTransactions());
        }
    }));

    const saleMobileSwitch = document.getElementById('sale-mobile-switch');
    if (saleMobileSwitch) {
        saleMobileSwitch.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-sale-panel]');
            if (btn) setSaleMobilePanel(btn.dataset.salePanel);
        });
    }

    document.getElementById('mobile-sale-summary')?.addEventListener('click', (e) => {
        if (e.target.closest('.mobile-summary-btn')) {
            setSaleMobilePanel('order');
        }
    });

    const saleProductsGrid = document.getElementById('sale-products-grid');
    if (saleProductsGrid) {
        saleProductsGrid.addEventListener('click', (event) => {
            // Un toque en cualquier parte de la tarjeta agrega el producto; los botones internos tienen su propia acción
            const btn = event.target.closest('button');
            const card = event.target.closest('.sale-product-card');
            if (!btn && !card) return;
            if (!btn && event.target.closest('.stepper')) return;

            const productId = btn?.dataset.productId || card?.dataset.productId;
            const action = btn ? btn.dataset.action : 'add';
            const product = getCustomProducts().find(p => p.id === productId);
            const hasModifiers = product && getProductModifierGroups(product).length > 0;
            
            if (action === 'customize' || (hasModifiers && (action === 'add' || !action))) {
                openModifiersModal(productId);
            } else if (action === 'add' || !action) {
                addItemToCurrentSale(productId);
            } else if (action === 'increase') {
                if (hasModifiers) openModifiersModal(productId);
                else updateCurrentSaleItemQty(productId, 1);
            } else if (action === 'decrease') {
                updateCurrentSaleItemQty(productId, -1);
            }
        });
    }

    const saleOrderItems = document.getElementById('sale-order-items');
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

    // Modifiers Modal Events
    document.getElementById('close-modifiers-modal')?.addEventListener('click', closeModifiersModal);
    document.getElementById('modifiers-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'modifiers-modal') closeModifiersModal();
    });
    document.getElementById('mod-qty-minus')?.addEventListener('click', () => {
        const valEl = document.getElementById('mod-qty-val');
        const currentQty = parseInt(valEl?.textContent || '1', 10);
        if (currentQty > 1) {
            const newQty = currentQty - 1;
            if (valEl) valEl.textContent = String(newQty);
            updateModifiersModalTotal();
        }
    });
    document.getElementById('mod-qty-plus')?.addEventListener('click', () => {
        const valEl = document.getElementById('mod-qty-val');
        const currentQty = parseInt(valEl?.textContent || '1', 10);
        const newQty = currentQty + 1;
        if (valEl) valEl.textContent = String(newQty);
        updateModifiersModalTotal();
    });
    document.getElementById('modifiers-modal-body')?.addEventListener('change', (e) => {
        enforceModifierMaxSelect(e.target);
        updateModifiersModalTotal();
    });
    document.getElementById('btn-confirm-modifiers')?.addEventListener('click', confirmAddProductWithModifiers);

    // Expense Modal & Form Events
    document.getElementById('btn-new-expense')?.addEventListener('click', () => openExpenseModal());
    document.getElementById('close-modal')?.addEventListener('click', () => closeModal());
    document.getElementById('transaction-form')?.addEventListener('submit', (e) => handleExpenseFormSubmit(e, {
        onUpdate: () => {
            updateDashboard();
            if (views.transactions?.classList.contains('active-view')) {
                renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
            }
        }
    }));

    // Dynamic Expense Shortcut form in modal
    const toggleAddExpense = document.getElementById('toggle-add-expense');
    const newExpenseForm = document.getElementById('new-expense-form');
    if (toggleAddExpense && newExpenseForm) {
        toggleAddExpense.addEventListener('click', () => {
            newExpenseForm.style.display = newExpenseForm.style.display === 'none' ? 'block' : 'none';
        });
    }

    document.getElementById('save-new-expense')?.addEventListener('click', () => addExpenseTagFromModal());
    document.getElementById('new-exp-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addExpenseTagFromModal();
        }
    });
    document.getElementById('expense-tags-container')?.addEventListener('click', handleExpenseTagsContainerClick);
    document.getElementById('expense-tag-search')?.addEventListener('input', handleExpenseSearchInput);
    document.getElementById('expense-tag-search')?.addEventListener('keydown', (e) => {
        // Evita que Enter en el buscador envíe el formulario de gasto
        if (e.key === 'Enter') e.preventDefault();
    });

    // Tables View Events
    const tablesBranchFilter = document.getElementById('tables-branch-filter');
    tablesBranchFilter?.addEventListener('change', () => {
        renderTablesView(getTransactions());
        if (tablesBranchFilter.value) {
            saveLocalState(STORAGE_KEYS.lastBranch, tablesBranchFilter.value);
            renderManageProducts();
        }
    });
    document.getElementById('btn-refresh-tables')?.addEventListener('click', () => renderTablesView(getTransactions()));

    const tablesGrid = document.getElementById('tables-grid');
    tablesGrid?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-table-action]');
        if (!btn) return;
        const { tableAction, id } = btn.dataset;

        if (tableAction === 'edit') openTableEditor(id);
        if (tableAction === 'charge') {
            openTableEditor(id);
            setSaleMobilePanel('order');
        }
        if (tableAction === 'delete') {
            if (confirm("¿Estás seguro de eliminar esta mesa?")) {
                deleteTable(id);
                renderTablesView(getTransactions());
                showToast("Mesa eliminada");
            }
        }
    });

    // Admin Products & Categories & Branches Events
    document.getElementById('btn-sort-products-az')?.addEventListener('click', () => sortProductsAlphabetically(renderManageProducts));
    document.getElementById('btn-sort-categories-az')?.addEventListener('click', () => sortCategoriesAlphabetically(renderManageCategories));
    document.getElementById('products-branch-filter')?.addEventListener('change', renderManageProducts);

    const manageNewProductForm = document.getElementById('manage-new-product-form');
    document.getElementById('btn-add-product-manage')?.addEventListener('click', () => {
        if (manageNewProductForm) {
            resetManageProductForm();
            manageNewProductForm.style.display = manageNewProductForm.style.display === 'none' ? 'block' : 'none';
        }
    });
    document.getElementById('manage-save-product')?.addEventListener('click', saveManagedProduct);

    const manageNewCategoryForm = document.getElementById('manage-new-category-form');
    document.getElementById('btn-add-category-manage')?.addEventListener('click', () => {
        if (manageNewCategoryForm) {
            resetManageCategoryForm();
            manageNewCategoryForm.style.display = manageNewCategoryForm.style.display === 'none' ? 'block' : 'none';
        }
    });
    document.getElementById('manage-save-category')?.addEventListener('click', saveManagedCategory);

    const manageNewBranchForm = document.getElementById('manage-new-branch-form');
    document.getElementById('btn-add-branch-manage')?.addEventListener('click', () => {
        if (manageNewBranchForm) {
            resetManageBranchForm();
            manageNewBranchForm.style.display = manageNewBranchForm.style.display === 'none' ? 'block' : 'none';
        }
    });
    document.getElementById('manage-save-branch')?.addEventListener('click', saveManagedBranch);
    document.getElementById('manage-branch-sessions')?.addEventListener('change', updateBranchSessionOptions);
    document.querySelectorAll('input[name="manage-branch-open-mode"]').forEach(input => input.addEventListener('change', updateBranchSessionOptions));
    document.getElementById('manage-branch-schedule')?.addEventListener('change', handleBranchScheduleChange);

    // Jornadas (Principal y modal de jornada)
    document.getElementById('sessions-section')?.addEventListener('click', handleSessionsSectionClick);
    document.getElementById('session-modal')?.addEventListener('click', handleSessionModalClick);
    document.getElementById('session-modal')?.addEventListener('input', handleSessionModalInput);
    document.getElementById('close-session-modal')?.addEventListener('click', closeSessionModal);
    setSessionsChangeHandler(() => {
        updateDashboard();
        renderSaleProducts();
    });

    const manageNewExpenseForm = document.getElementById('manage-new-expense-form');
    document.getElementById('btn-add-expense-manage')?.addEventListener('click', () => {
        if (manageNewExpenseForm) {
            resetManageExpenseForm();
            manageNewExpenseForm.style.display = manageNewExpenseForm.style.display === 'none' ? 'block' : 'none';
        }
    });
    document.getElementById('manage-save-expense')?.addEventListener('click', saveManagedExpenseTag);

    const manageNewExpenseGroupForm = document.getElementById('manage-new-expense-group-form');
    document.getElementById('btn-add-expense-group-manage')?.addEventListener('click', () => {
        if (manageNewExpenseGroupForm) {
            resetManageExpenseGroupForm();
            manageNewExpenseGroupForm.style.display = manageNewExpenseGroupForm.style.display === 'none' ? 'block' : 'none';
        }
    });
    document.getElementById('manage-save-expense-group')?.addEventListener('click', saveManagedExpenseGroup);
    document.getElementById('manage-expense-groups-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'expense-group-edit') startEditingExpenseGroup(id);
        if (action === 'expense-group-delete') deleteManagedExpenseGroup(id);
    });

    // Pestaña Modificadores
    const refreshProductViews = () => {
        renderManageProducts();
        renderSaleProducts();
        renderManageInventory();
    };
    document.getElementById('btn-add-modifier-manage')?.addEventListener('click', toggleModifierForm);
    document.getElementById('manage-cancel-modifier')?.addEventListener('click', closeModifierForm);
    document.getElementById('btn-add-mod-option-row')?.addEventListener('click', () => addModifierOptionRow());
    document.getElementById('manage-mod-type')?.addEventListener('change', handleModifierTypeChange);
    document.getElementById('manage-modifier-form')?.addEventListener('click', handleModifierFormClick);
    document.getElementById('manage-save-modifier')?.addEventListener('click', () => saveManagedModifier({ onProductsChanged: refreshProductViews }));
    document.getElementById('modifiers-migration-banner')?.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-migrate-modifiers')) {
            await migrateLegacyModifiers();
            refreshProductViews();
        }
    });
    document.getElementById('manage-modifiers-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'modifier-edit') startEditingModifier(id);
        if (action === 'modifier-delete') deleteManagedModifier(id, { onProductsChanged: refreshProductViews });
    });

    // Pestaña Inventario
    renderInventoryUnitOptions();
    document.getElementById('btn-add-inventory-manage')?.addEventListener('click', toggleInventoryForm);
    document.getElementById('manage-cancel-inventory')?.addEventListener('click', closeInventoryForm);
    document.getElementById('manage-save-inventory')?.addEventListener('click', async () => {
        await saveManagedInventoryItem();
        refreshProductViews();
    });
    document.querySelector('[data-products-panel="inventory"]')?.addEventListener('click', async (e) => {
        await handleInventoryPanelClick(e);
    });
    document.getElementById('manage-inventory-form')?.addEventListener('input', updateConsumerHints);

    // Admin Delegated List Handlers
    document.getElementById('manage-products-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id, index, dir } = btn.dataset;
        if (action === 'move') moveManagedProduct(Number(index), Number(dir));
        if (action === 'edit') startEditingProduct(id);
        if (action === 'delete') deleteManagedProduct(id);
    });

    document.getElementById('manage-categories-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id, index, dir } = btn.dataset;
        if (action === 'category-move') reorderCategories(Number(index), Number(index) + Number(dir), renderManageCategories);
        if (action === 'category-edit') startEditingCategory(id);
        if (action === 'category-delete') deleteManagedCategory(id);
    });

    document.getElementById('manage-branches-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'branch-edit') startEditingBranch(id);
        if (action === 'branch-delete') deleteManagedBranch(id);
    });

    document.getElementById('manage-expense-tags-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'expense-edit') startEditingExpenseTag(id);
        if (action === 'expense-delete') deleteManagedExpenseTag(id);
    });
    document.getElementById('manage-expense-tags-list')?.addEventListener('change', handleManageExpenseTagGroupChange);

    // Exports
    document.getElementById('btn-export-full-backup')?.addEventListener('click', (e) => {
        downloadFullBackup(showToast, e.currentTarget);
    });
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
        downloadCSV(getFilteredData(), currentFilter, showToast);
    });
    document.getElementById('btn-export-image')?.addEventListener('click', () => {
        const data = getFilteredData();
        const customProducts = getCustomProducts();
        downloadImageSummary(data, getFilterLabel(), currentFilter, getTopSellerStats(data, customProducts), showToast);
    });
}

// Authentication Flow
function unlockApp() {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainApp) mainApp.style.display = 'flex';
}

function initAuth() {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const loginPasswordInput = document.getElementById('login-password');
    const btnToggleLoginPassword = document.getElementById('toggle-login-password');

    if (isAuthenticated()) {
        unlockApp();
        return;
    }

    if (loginScreen) loginScreen.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';

    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = loginPasswordInput?.value || '';
        const isValid = await authenticate(pw);
        if (isValid) {
            if (loginError) loginError.style.display = 'none';
            unlockApp();
            showToast("Bienvenido de nuevo");
        } else {
            if (loginError) loginError.style.display = 'block';
            if (loginPasswordInput) {
                loginPasswordInput.value = '';
                loginPasswordInput.focus();
            }
        }
    });

    btnToggleLoginPassword?.addEventListener('click', () => {
        if (!loginPasswordInput) return;
        const isHidden = loginPasswordInput.type === 'password';
        loginPasswordInput.type = isHidden ? 'text' : 'password';
        const icon = btnToggleLoginPassword.querySelector('i');
        if (icon) {
            icon.className = isHidden ? 'ph ph-eye-slash' : 'ph ph-eye';
        }
    });
}

// Main App Initialization
function init() {
    views = {
        dashboard: document.getElementById('view-dashboard'),
        sessions: document.getElementById('view-sessions'),
        tables: document.getElementById('view-tables'),
        transactions: document.getElementById('view-transactions'),
        products: document.getElementById('view-products'),
        backup: document.getElementById('view-backup')
    };

    navBtns = {
        dashboard: document.getElementById('nav-dashboard'),
        sessions: document.getElementById('nav-sessions'),
        tables: document.getElementById('nav-tables'),
        transactions: document.getElementById('nav-transactions'),
        products: document.getElementById('nav-products'),
        backup: document.getElementById('nav-backup')
    };

    initAuth();
    setupEventListeners();
    initModalScrollLock();

    // Initial Subscriptions & Sync
    subscribeProducts(() => {
        renderManageProducts();
        renderSaleProducts();
        updateDashboard();
    });

    subscribeCategories(() => {
        renderCategoryOptions();
        renderManageCategories();
    });

    subscribeBranches(() => {
        renderManageBranches();
        renderManageProductBranchOptions();
        renderTablesBranchFilter();
        renderSaleBranchOptions();
        renderSaleProducts();
        renderTablesView(getTransactions());
        updateDashboard();
    });

    subscribeExpenseTags(() => {
        renderExpenseTags();
        renderManageExpenseTags();
    });

    subscribeSessions(() => {
        renderSessionsSection();
        renderSaleProducts();
    });

    // Horario fijo y duración en vivo: revisa cada minuto
    runScheduleTick();
    setInterval(() => {
        runScheduleTick();
        renderSessionsSection();
    }, 60000);

    subscribeModifierGroups(() => {
        renderManageModifiers();
        renderManageProducts();
        renderSaleProducts();
    });

    subscribeInventoryItems(() => {
        renderManageInventory();
        renderManageProducts();
    });

    subscribeExpenseGroups(() => {
        renderExpenseTags();
        renderManageExpenseTags();
        if (views.transactions?.classList.contains('active-view')) {
            renderFullHistory(getTransactions(), { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
        }
    });

    subscribeOpenTables(() => {
        renderTablesView(getTransactions());
    });

    fetchTransactions((transactions) => {
        updateDashboard();
        renderTablesView(transactions);
        if (views.transactions?.classList.contains('active-view')) {
            renderFullHistory(transactions, { typeFilter: historyTypeFilter, searchTerm: historySearchTerm });
        }
    });

    syncStrandedOfflineTransactions();

    // Setup visual date on top header
    const dateDisplay = document.getElementById('current-date-display');
    if (dateDisplay) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateDisplay.textContent = today.toLocaleDateString('es-ES', options);
    }

    switchView('dashboard');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
            .then(() => caches.keys())
            .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .catch((err) => console.warn('No se pudieron limpiar los service workers:', err));
    });
}

window.addEventListener('pageshow', () => {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    scrollToTop();
});
