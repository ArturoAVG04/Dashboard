export const STORAGE_KEYS = {
    transactions: 'localTransactions',
    products: 'customProducts',
    expenseTags: 'customExpenseTags',
    branches: 'customBranches',
    categories: 'customCategories'
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
    return parseJSON(localStorage.getItem(key), fallback);
}

export function saveLocalState(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}
