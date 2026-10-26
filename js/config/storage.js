export const STORAGE_KEYS = {
    transactions: 'localTransactions',
    products: 'customProducts',
    expenseTags: 'customExpenseTags',
    branches: 'customBranches',
    categories: 'customCategories',
    openTables: 'openTables',
    lastBranch: 'lastSelectedBranch',
    lastSaleBranch: 'lastSaleBranch',
    sessionsTab: 'sessionsTab',
    historyPeriod: 'historyPeriod',
    comparisonSort: 'comparisonSort',
    cutsBranch: 'cutsBranch',
    reportBranch: 'reportBranch',
    branchColors: 'branchColorMap',
    expenseGroups: 'customExpenseGroups',
    expenseGroupsExpanded: 'expenseGroupsExpanded',
    productsTab: 'productsTab',
    modifierGroups: 'customModifierGroups',
    inventoryItems: 'inventoryItems',
    sessions: 'dailySessions',
    inventoryBranch: 'inventoryBranch'
};

function parseJSON(value, fallback) {
    if (!value) return fallback;

    try {
        return JSON.parse(value);
    } catch (error) {
        console.warn('No se pudo leer almacenamiento local:', error);
        return fallback;
    }
}

export function loadLocalState(key, fallback) {
    try {
        return parseJSON(localStorage.getItem(key), fallback);
    } catch (error) {
        console.warn('No se pudo acceder al almacenamiento local:', error);
        return fallback;
    }
}

// Devuelve false si no se pudo guardar (p. ej. almacenamiento lleno)
export function saveLocalState(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn('No se pudo guardar en almacenamiento local:', error);
        return false;
    }
}
