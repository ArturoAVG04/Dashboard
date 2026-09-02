import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy, getDocs, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { INITIAL_PRODUCTS, INITIAL_EXPENSE_TAGS, INITIAL_CATEGORIES } from '../config/constants.js';
import { normalizeProducts } from '../models/Product.js';
import { normalizeNamedList, sortNamedListAlphabetically } from './branches-service.js';

let customProducts = normalizeProducts(loadLocalState(STORAGE_KEYS.products, INITIAL_PRODUCTS));
let customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(loadLocalState(STORAGE_KEYS.expenseTags, INITIAL_EXPENSE_TAGS)));
let customCategories = normalizeNamedList(loadLocalState(STORAGE_KEYS.categories, INITIAL_CATEGORIES), 'cat').sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

let isSyncingProducts = false;
let isSyncingExpenseTags = false;
let isSyncingCategories = false;

export function normalizeExpenseTags(tags) {
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

export function getCustomProducts() {
    return customProducts;
}

export function setCustomProducts(products) {
    customProducts = products;
    saveLocalState(STORAGE_KEYS.products, customProducts);
}

export function getCustomExpenseTags() {
    return customExpenseTags;
}

export function setCustomExpenseTags(tags) {
    customExpenseTags = tags;
    saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
}

export function getCustomCategories() {
    return customCategories;
}

export function setCustomCategories(categories) {
    customCategories = categories;
    saveLocalState(STORAGE_KEYS.categories, customCategories);
}

export async function syncProductsToCloud() {
    if (!db || isSyncingProducts) return;

    isSyncingProducts = true;
    try {
        const collectionRef = collection(db, "dashboard_products");
        const existingSnapshot = await getDocs(collectionRef);
        const batch = writeBatch(db);

        existingSnapshot.forEach((docItem) => {
            batch.delete(docItem.ref);
        });

        customProducts.forEach((product, index) => {
            if (product && product.name) {
                const docRef = doc(collection(db, "dashboard_products"), product.id || `p_${index}`);
                batch.set(docRef, {
                    name: product.name,
                    price: Number(product.price) || 0,
                    category: product.category || 'General',
                    availableInBranches: Array.isArray(product.availableInBranches) ? product.availableInBranches : [],
                    modifiers: Array.isArray(product.modifiers) ? product.modifiers : [],
                    order: typeof product.order === 'number' ? product.order : index
                });
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar los productos:", error);
    } finally {
        isSyncingProducts = false;
    }
}

export async function syncExpenseTagsToCloud() {
    if (!db || isSyncingExpenseTags) return;

    isSyncingExpenseTags = true;
    try {
        const collectionRef = collection(db, "dashboard_expense_tags");
        const existingSnapshot = await getDocs(collectionRef);
        const batch = writeBatch(db);

        existingSnapshot.forEach((docItem) => {
            batch.delete(docItem.ref);
        });

        customExpenseTags.forEach((tag, index) => {
            if (tag && tag.name) {
                const docRef = doc(collection(db, "dashboard_expense_tags"), tag.id || `exp_${index}`);
                batch.set(docRef, {
                    name: tag.name,
                    order: typeof tag.order === 'number' ? tag.order : index
                });
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar los accesos de gasto:", error);
    } finally {
        isSyncingExpenseTags = false;
    }
}

export async function syncCategoriesToCloud() {
    if (!db || isSyncingCategories) return;

    isSyncingCategories = true;
    try {
        const collectionRef = collection(db, "dashboard_categories");
        const existingSnapshot = await getDocs(collectionRef);
        const batch = writeBatch(db);

        existingSnapshot.forEach((docItem) => {
            batch.delete(docItem.ref);
        });

        customCategories.forEach((category, index) => {
            if (category && category.name) {
                const docRef = doc(collection(db, "dashboard_categories"), category.id || `cat_${index}`);
                batch.set(docRef, {
                    name: category.name,
                    order: typeof category.order === 'number' ? category.order : index
                });
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar las categorías:", error);
    } finally {
        isSyncingCategories = false;
    }
}

export function subscribeProducts(callback) {
    if (!db) return;

    const productsQuery = query(collection(db, "dashboard_products"), orderBy("order", "asc"));
    onSnapshot(productsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncProductsToCloud();
            return;
        }

        customProducts = snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
        })).map((product, index) => normalizeProducts([product])[0]);
        saveLocalState(STORAGE_KEYS.products, customProducts);
        if (typeof callback === 'function') callback(customProducts);
    }, (error) => {
        console.warn("No se pudieron leer los productos desde Firebase:", error);
    });
}

export function subscribeExpenseTags(callback) {
    if (!db) return;

    const tagsQuery = query(collection(db, "dashboard_expense_tags"), orderBy("order", "asc"));
    onSnapshot(tagsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncExpenseTagsToCloud();
            return;
        }

        customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
        }))));
        saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
        if (typeof callback === 'function') callback(customExpenseTags);
    }, (error) => {
        console.warn("No se pudieron leer los accesos de gasto desde Firebase:", error);
    });
}

export function subscribeCategories(callback) {
    if (!db) return;

    const categoriesQuery = query(collection(db, "dashboard_categories"), orderBy("order", "asc"));
    onSnapshot(categoriesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await syncCategoriesToCloud();
            return;
        }

        const normalizedCats = normalizeNamedList(snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
        })), 'cat');
        customCategories = [...normalizedCats].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        saveLocalState(STORAGE_KEYS.categories, customCategories);
        if (typeof callback === 'function') callback(customCategories);
    }, (error) => {
        console.warn("No se pudieron leer las categorías desde Firebase:", error);
    });
}
