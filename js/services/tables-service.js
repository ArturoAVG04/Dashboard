import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy, getDocs, writeBatch, doc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { isSameLocalDate } from '../core/date-utils.js';
import { normalizeOpenTables, calculateItemsTotal, Table } from '../models/Table.js';

let openTables = normalizeOpenTables(loadLocalState(STORAGE_KEYS.openTables, []));
let isSyncingTables = false;

export function getOpenTables() {
    return openTables;
}

export function setOpenTables(tables) {
    openTables = normalizeOpenTables(tables);
    saveLocalState(STORAGE_KEYS.openTables, openTables);
}

export function getTableById(tableId) {
    return openTables.find(table => table.id === tableId) || null;
}

export function getTodayTablesCount(branchId, transactions = []) {
    const openCount = openTables.filter(t => t.status === 'open' && isSameLocalDate(t.createdAt) && (!branchId || t.branchId === branchId)).length;
    const closedCount = (transactions || []).filter(t => t.source === 'table' && isSameLocalDate(t.date || t.createdAt) && (!branchId || t.branchId === branchId || t.branch === branchId)).length;
    return openCount + closedCount;
}

export function getNextTableName(branchId, transactions = []) {
    const openTodayNumbers = openTables
        .filter(table => table.status === 'open' && isSameLocalDate(table.createdAt) && (!branchId || table.branchId === branchId))
        .map(table => {
            const match = (table.name || '').match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        });

    const closedTodayNumbers = (transactions || [])
        .filter(t => t.source === 'table' && isSameLocalDate(t.date || t.createdAt) && (!branchId || t.branchId === branchId || t.branch === branchId))
        .map(t => {
            const match = (t.tableName || t.desc || '').match(/Mesa\s*(\d+)/i);
            return match ? parseInt(match[1], 10) : 0;
        });

    const allTodayNumbers = [...openTodayNumbers, ...closedTodayNumbers].filter(num => num > 0);
    const maxNumber = allTodayNumbers.length > 0 ? Math.max(...allTodayNumbers) : 0;

    return `Mesa ${maxNumber + 1}`;
}

export function createTable(branchId, initialItems = [], initialTotal = 0, transactions = []) {
    const tableName = getNextTableName(branchId, transactions);
    const newTable = new Table({
        id: `table_${Date.now()}`,
        branchId: branchId || '',
        name: tableName,
        items: initialItems,
        total: initialTotal || calculateItemsTotal(initialItems),
        status: 'open',
        createdAt: new Date().toISOString()
    });

    openTables = [newTable, ...openTables];
    saveLocalState(STORAGE_KEYS.openTables, openTables);

    if (db) {
        addDoc(collection(db, "dashboard_tables"), {
            branchId: newTable.branchId,
            name: newTable.name,
            items: newTable.items,
            total: newTable.total,
            status: newTable.status,
            createdAt: newTable.createdAt
        }).then(docRef => {
            newTable.id = docRef.id;
            saveLocalState(STORAGE_KEYS.openTables, openTables);
        }).catch(err => {
            console.warn("Error guardando mesa en Firebase:", err);
        });
    }

    return newTable;
}

export function updateTable(tableId, payload) {
    openTables = openTables.map(table => {
        if (table.id !== tableId) return table;
        const nextItems = payload.items ? payload.items : table.items;
        const nextTotal = typeof payload.total === 'number' ? payload.total : calculateItemsTotal(nextItems);
        return new Table({
            ...table,
            ...payload,
            items: nextItems,
            total: nextTotal
        });
    });

    saveLocalState(STORAGE_KEYS.openTables, openTables);

    if (db && !tableId.startsWith('table_')) {
        const docRef = doc(db, "dashboard_tables", tableId);
        updateDoc(docRef, payload).catch(err => console.warn("Error actualizando mesa en Firebase:", err));
    }

    return getTableById(tableId);
}

export function deleteTable(tableId) {
    openTables = openTables.filter(table => table.id !== tableId);
    saveLocalState(STORAGE_KEYS.openTables, openTables);

    if (db && !tableId.startsWith('table_')) {
        const docRef = doc(db, "dashboard_tables", tableId);
        deleteDoc(docRef).catch(err => console.warn("Error eliminando mesa de Firebase:", err));
    }
}

export async function syncTablesToCloud() {
    if (!db || isSyncingTables) return;

    isSyncingTables = true;
    try {
        const collectionRef = collection(db, "dashboard_tables");
        const existingSnapshot = await getDocs(collectionRef);
        const batch = writeBatch(db);

        existingSnapshot.forEach((docItem) => {
            batch.delete(docItem.ref);
        });

        openTables.forEach((table, index) => {
            if (table && table.status === 'open') {
                const docRef = doc(collection(db, "dashboard_tables"), table.id || `table_${index}`);
                batch.set(docRef, {
                    branchId: table.branchId || '',
                    name: table.name,
                    items: table.items,
                    total: table.total,
                    status: table.status,
                    createdAt: table.createdAt
                });
            }
        });

        await batch.commit();
    } catch (error) {
        console.warn("No se pudieron sincronizar las mesas:", error);
    } finally {
        isSyncingTables = false;
    }
}

export function subscribeOpenTables(callback) {
    if (!db) return;

    const tablesQuery = query(collection(db, "dashboard_tables"), orderBy("createdAt", "asc"));
    onSnapshot(tablesQuery, (snapshot) => {
        if (snapshot.empty) {
            openTables = [];
            saveLocalState(STORAGE_KEYS.openTables, openTables);
            if (typeof callback === 'function') callback(openTables);
            return;
        }

        openTables = normalizeOpenTables(snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
        })));
        saveLocalState(STORAGE_KEYS.openTables, openTables);
        if (typeof callback === 'function') callback(openTables);
    }, (error) => {
        console.warn("No se pudieron leer las mesas desde Firebase:", error);
    });
}
