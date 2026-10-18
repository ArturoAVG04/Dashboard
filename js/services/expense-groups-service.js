import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { BRANCH_COLOR_PALETTE } from '../config/constants.js';
import { normalizeExpenseGroups } from '../models/ExpenseTag.js';

// Colección nueva; se guarda documento por documento.
const COLLECTION = 'dashboard_expense_groups';

let expenseGroups = normalizeExpenseGroups(loadLocalState(STORAGE_KEYS.expenseGroups, []));

export function getExpenseGroups() {
    return expenseGroups;
}

export function getNextExpenseGroupColor() {
    const used = new Set(expenseGroups.map(group => group.color));
    return BRANCH_COLOR_PALETTE.find(color => !used.has(color)) || BRANCH_COLOR_PALETTE[expenseGroups.length % BRANCH_COLOR_PALETTE.length];
}

export async function upsertExpenseGroup(group) {
    const normalized = normalizeExpenseGroups([{
        order: expenseGroups.length,
        ...group,
        id: group.id || `expg_${Date.now()}`
    }])[0];
    if (!normalized) return null;

    const exists = expenseGroups.some(item => item.id === normalized.id);
    expenseGroups = normalizeExpenseGroups(exists
        ? expenseGroups.map(item => item.id === normalized.id ? normalized : item)
        : [...expenseGroups, normalized]);
    saveLocalState(STORAGE_KEYS.expenseGroups, expenseGroups);

    if (db) {
        try {
            await setDoc(doc(db, COLLECTION, normalized.id), {
                name: normalized.name,
                color: normalized.color,
                order: normalized.order
            }, { merge: true });
        } catch (error) {
            console.warn("No se pudo guardar el grupo de gasto:", error);
        }
    }
    return normalized;
}

export async function removeExpenseGroup(id) {
    expenseGroups = expenseGroups.filter(group => group.id !== id);
    saveLocalState(STORAGE_KEYS.expenseGroups, expenseGroups);

    if (db) {
        try {
            await deleteDoc(doc(db, COLLECTION, id));
        } catch (error) {
            console.warn("No se pudo eliminar el grupo de gasto:", error);
        }
    }
}

export function subscribeExpenseGroups(callback) {
    if (!db) return;

    onSnapshot(collection(db, COLLECTION), (snapshot) => {
        expenseGroups = normalizeExpenseGroups(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
        saveLocalState(STORAGE_KEYS.expenseGroups, expenseGroups);
        if (typeof callback === 'function') callback(expenseGroups);
    }, (error) => {
        console.warn("No se pudieron leer los grupos de gasto desde Firebase:", error);
    });
}
