import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { normalizeModifierGroups, normalizeModifierGroup, resolveProductModifierGroups } from '../models/ModifierGroup.js';
import { commitListChanges } from './firestore-sync.js';

// Colección nueva (F3); se guarda documento por documento.
const COLLECTION = 'dashboard_modifier_groups';

let modifierGroups = normalizeModifierGroups(loadLocalState(STORAGE_KEYS.modifierGroups, []));

export function modifierGroupToDoc(group, index) {
    return {
        name: group.name,
        type: group.type,
        required: Boolean(group.required),
        maxSelect: group.maxSelect ?? null,
        options: (group.options || []).map(opt => ({
            id: opt.id,
            name: opt.name,
            price: Number(opt.price) || 0,
            stockUsage: opt.stockUsage || []
        })),
        order: typeof group.order === 'number' ? group.order : index
    };
}

export function getModifierGroups() {
    return modifierGroups;
}

export function getProductModifierGroups(product) {
    return resolveProductModifierGroups(product, modifierGroups);
}

function setLocal(groups) {
    modifierGroups = normalizeModifierGroups(groups);
    saveLocalState(STORAGE_KEYS.modifierGroups, modifierGroups);
}

export async function upsertModifierGroup(group) {
    const normalized = normalizeModifierGroup({ order: modifierGroups.length, ...group, id: group.id || `modg_${Date.now()}` });
    const exists = modifierGroups.some(item => item.id === normalized.id);
    setLocal(exists ? modifierGroups.map(item => item.id === normalized.id ? normalized : item) : [...modifierGroups, normalized]);

    if (db) {
        try {
            await setDoc(doc(db, COLLECTION, normalized.id), modifierGroupToDoc(normalized, 0), { merge: true });
        } catch (error) {
            console.warn("No se pudo guardar el modificador:", error);
        }
    }
    return normalized;
}

// Agrega varios grupos a la vez (conversión desde el sistema anterior). Solo escribe los nuevos.
export function addModifierGroups(groups) {
    const previous = modifierGroups;
    setLocal([...modifierGroups, ...groups]);
    return commitListChanges(COLLECTION, previous, modifierGroups, modifierGroupToDoc);
}

export async function removeModifierGroup(id) {
    setLocal(modifierGroups.filter(group => group.id !== id));
    if (db) {
        try {
            await deleteDoc(doc(db, COLLECTION, id));
        } catch (error) {
            console.warn("No se pudo eliminar el modificador:", error);
        }
    }
}

export function subscribeModifierGroups(callback) {
    if (!db) return;
    onSnapshot(collection(db, COLLECTION), (snapshot) => {
        setLocal(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
        if (typeof callback === 'function') callback(modifierGroups);
    }, (error) => {
        console.warn("No se pudieron leer los modificadores desde Firebase:", error);
    });
}
