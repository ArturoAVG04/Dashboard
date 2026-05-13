export const STORAGE_KEYS = {
    transactions: 'localTransactions',
    products: 'customProducts',
    expenseTags: 'customExpenseTags',
    branches: 'customBranches',
    categories: 'customCategories',
    openTables: 'openTables',
    lastBranch: 'lastSelectedBranch',
    branchColors: 'branchColorMap'
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

export function saveLocalState(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('No se pudo guardar en almacenamiento local:', error);
    }
}
