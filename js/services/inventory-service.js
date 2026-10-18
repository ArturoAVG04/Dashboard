import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { normalizeInventoryItems, getBranchItems } from '../models/Inventory.js';
import { commitListChanges } from './firestore-sync.js';

// Colección nueva (F4): artículos que se llevan físicamente, uno por sucursal, con los productos que los consumen.
const COLLECTION = 'inventory_items';

let inventoryItems = normalizeInventoryItems(loadLocalState(STORAGE_KEYS.inventoryItems, []));

export function inventoryItemToDoc(item, index) {
    return {
        name: item.name,
        unit: item.unit || 'pza',
        unitCost: typeof item.unitCost === 'number' ? item.unitCost : null,
        active: item.active !== false,
        order: typeof item.order === 'number' ? item.order : index,
        branchId: item.branchId || null,
        consumers: (item.consumers || []).map(consumer => consumer.type === 'option'
            ? { type: 'option', groupId: consumer.groupId, optionId: consumer.optionId, qty: consumer.qty }
            : { type: 'product', productId: consumer.productId, qty: consumer.qty })
    };
}

export function getInventoryItems() {
    return inventoryItems;
}

// Artículos de una sucursal (los que no tienen sucursal son del esquema anterior)
export function getBranchInventoryItems(branchId) {
    return getBranchItems(inventoryItems, branchId);
}

export function getLegacyInventoryItems() {
    return inventoryItems.filter(item => !item.branchId);
}

// Guarda varios artículos a la vez (conversión del esquema anterior o copia entre sucursales)
export function upsertInventoryItems(items) {
    const previous = inventoryItems;
    const byId = new Map(inventoryItems.map(item => [item.id, item]));
    items.forEach(item => byId.set(item.id, item));
    setLocal([...byId.values()]);
    return commitListChanges(COLLECTION, previous, inventoryItems, inventoryItemToDoc);
}

export function getInventoryItemById(id) {
    return inventoryItems.find(item => item.id === id) || null;
}

function setLocal(items) {
    inventoryItems = normalizeInventoryItems(items);
    saveLocalState(STORAGE_KEYS.inventoryItems, inventoryItems);
}

export async function upsertInventoryItem(item) {
    const normalized = normalizeInventoryItems([{ order: inventoryItems.length, ...item, id: item.id || `inv_${Date.now()}` }])[0];
    if (!normalized) return null;
    const exists = inventoryItems.some(entry => entry.id === normalized.id);
    setLocal(exists ? inventoryItems.map(entry => entry.id === normalized.id ? normalized : entry) : [...inventoryItems, normalized]);

    if (db) {
        try {
            await setDoc(doc(db, COLLECTION, normalized.id), inventoryItemToDoc(normalized, 0), { merge: true });
        } catch (error) {
            console.warn("No se pudo guardar el artículo de inventario:", error);
        }
    }
    return normalized;
}

export async function removeInventoryItem(id) {
    setLocal(inventoryItems.filter(item => item.id !== id));
    if (db) {
        try {
            await deleteDoc(doc(db, COLLECTION, id));
        } catch (error) {
            console.warn("No se pudo eliminar el artículo de inventario:", error);
        }
    }
}

export function subscribeInventoryItems(callback) {
    if (!db) return;
    onSnapshot(collection(db, COLLECTION), (snapshot) => {
        setLocal(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
        if (typeof callback === 'function') callback(inventoryItems);
    }, (error) => {
        console.warn("No se pudieron leer los artículos de inventario desde Firebase:", error);
    });
}
