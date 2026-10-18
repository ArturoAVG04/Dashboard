import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { INITIAL_PRODUCTS, INITIAL_EXPENSE_TAGS, INITIAL_CATEGORIES } from '../config/constants.js';
import { normalizeProducts } from '../models/Product.js';
import { normalizeNamedList, sortNamedListAlphabetically } from './branches-service.js';
import { commitListChanges, uploadList } from './firestore-sync.js';

const PRODUCTS_COLLECTION = 'dashboard_products';
const CATEGORIES_COLLECTION = 'dashboard_categories';
const EXPENSE_TAGS_COLLECTION = 'dashboard_expense_tags';

let customProducts = normalizeProducts(loadLocalState(STORAGE_KEYS.products, INITIAL_PRODUCTS));
let customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(loadLocalState(STORAGE_KEYS.expenseTags, INITIAL_EXPENSE_TAGS)));
let customCategories = normalizeNamedList(loadLocalState(STORAGE_KEYS.categories, INITIAL_CATEGORIES), 'cat').sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

// Campos que la app guarda en Firestore para cada tipo de documento
export function productToDoc(product, index) {
    return {
        name: product.name,
        price: Number(product.price) || 0,
        category: product.category || 'General',
        availableInBranches: Array.isArray(product.availableInBranches) ? product.availableInBranches : [],
        modifiers: Array.isArray(product.modifiers) ? product.modifiers : [],
        order: typeof product.order === 'number' ? product.order : index,
        // Campos nuevos (F3/F4): solo se escriben si el producto ya los usa, para no alterar productos sin configurar
        ...(Array.isArray(product.modifierGroupIds) ? { modifierGroupIds: product.modifierGroupIds } : {}),
        ...(Array.isArray(product.stockUsage) ? { stockUsage: product.stockUsage } : {})
    };
}

export function categoryToDoc(category, index) {
    return {
        name: category.name,
        order: typeof category.order === 'number' ? category.order : index
    };
}

export function expenseTagToDoc(tag, index) {
    return {
        name: tag.name,
        order: typeof tag.order === 'number' ? tag.order : index,
        groupId: tag.groupId || ''
    };
}

// Conserva campos desconocidos del documento (compatibilidad hacia adelante)
export function normalizeExpenseTags(tags) {
    return (tags || []).map((tag, index) => {
        if (typeof tag === 'string') {
            return { id: `exp_${index}_${tag.toLowerCase().replace(/\s+/g, '_')}`, name: tag, order: index, groupId: '' };
        }

        return {
            ...tag,
            id: tag.id || `exp_${index}_${(tag.name || '').toLowerCase().replace(/\s+/g, '_')}`,
            name: tag.name || '',
            order: typeof tag.order === 'number' ? tag.order : index,
            groupId: tag.groupId || ''
        };
    }).filter(tag => tag.name);
}

export function getCustomProducts() {
    return customProducts;
}

export function getCustomExpenseTags() {
    return customExpenseTags;
}

export function getCustomCategories() {
    return customCategories;
}

// Reemplaza la lista local y guarda en Firestore solo los productos que cambiaron
export function commitProducts(products) {
    const previous = customProducts;
    customProducts = products;
    saveLocalState(STORAGE_KEYS.products, customProducts);
    return commitListChanges(PRODUCTS_COLLECTION, previous, customProducts, productToDoc);
}

export function commitCategories(categories) {
    const previous = customCategories;
    customCategories = categories;
    saveLocalState(STORAGE_KEYS.categories, customCategories);
    return commitListChanges(CATEGORIES_COLLECTION, previous, customCategories, categoryToDoc);
}

// Guardado por documento: solo toca el atajo editado
export async function upsertExpenseTag(tag) {
    const normalized = normalizeExpenseTags([tag])[0];
    if (!normalized) return null;

    const exists = customExpenseTags.some(item => item.id === normalized.id);
    customExpenseTags = sortNamedListAlphabetically(exists
        ? customExpenseTags.map(item => item.id === normalized.id ? { ...item, ...normalized } : item)
        : [...customExpenseTags, normalized]);
    saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);

    if (db) {
        try {
            await setDoc(doc(db, EXPENSE_TAGS_COLLECTION, normalized.id), expenseTagToDoc(normalized, 0), { merge: true });
        } catch (error) {
            console.warn("No se pudo guardar el atajo de gasto:", error);
        }
    }
    return normalized;
}

export async function removeExpenseTag(id) {
    customExpenseTags = customExpenseTags.filter(tag => tag.id !== id);
    saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);

    if (db) {
        try {
            await deleteDoc(doc(db, EXPENSE_TAGS_COLLECTION, id));
        } catch (error) {
            console.warn("No se pudo eliminar el atajo de gasto:", error);
        }
    }
}

// En las suscripciones: si la colección está vacía en la nube (primer uso), se sube lo local sin borrar nada.
export function subscribeProducts(callback) {
    if (!db) return;

    const productsQuery = query(collection(db, PRODUCTS_COLLECTION), orderBy("order", "asc"));
    onSnapshot(productsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await uploadList(PRODUCTS_COLLECTION, customProducts, productToDoc);
            return;
        }

        customProducts = normalizeProducts(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
        saveLocalState(STORAGE_KEYS.products, customProducts);
        if (typeof callback === 'function') callback(customProducts);
    }, (error) => {
        console.warn("No se pudieron leer los productos desde Firebase:", error);
    });
}

export function subscribeExpenseTags(callback) {
    if (!db) return;

    const tagsQuery = query(collection(db, EXPENSE_TAGS_COLLECTION), orderBy("order", "asc"));
    onSnapshot(tagsQuery, async (snapshot) => {
        if (snapshot.empty) {
            await uploadList(EXPENSE_TAGS_COLLECTION, customExpenseTags, expenseTagToDoc);
            return;
        }

        customExpenseTags = sortNamedListAlphabetically(normalizeExpenseTags(snapshot.docs.map(item => ({ ...item.data(), id: item.id }))));
        saveLocalState(STORAGE_KEYS.expenseTags, customExpenseTags);
        if (typeof callback === 'function') callback(customExpenseTags);
    }, (error) => {
        console.warn("No se pudieron leer los accesos de gasto desde Firebase:", error);
    });
}

export function subscribeCategories(callback) {
    if (!db) return;

    const categoriesQuery = query(collection(db, CATEGORIES_COLLECTION), orderBy("order", "asc"));
    onSnapshot(categoriesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await uploadList(CATEGORIES_COLLECTION, customCategories, categoryToDoc);
            return;
        }

        const normalizedCats = normalizeNamedList(snapshot.docs.map(item => ({ ...item.data(), id: item.id })), 'cat');
        customCategories = [...normalizedCats].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        saveLocalState(STORAGE_KEYS.categories, customCategories);
        if (typeof callback === 'function') callback(customCategories);
    }, (error) => {
        console.warn("No se pudieron leer las categorías desde Firebase:", error);
    });
}
