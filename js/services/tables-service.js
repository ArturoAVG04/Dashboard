import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy, doc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { isSameLocalDate } from '../core/date-utils.js';
import { normalizeOpenTables, calculateItemsTotal, Table, countTodayTables, nextTableName } from '../models/Table.js';

let openTables = normalizeOpenTables(loadLocalState(STORAGE_KEYS.openTables, []));

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

export function getTodayTablesCount(branchId, transactions = [], since = null) {
    return countTodayTables(openTables, transactions, branchId, since);
}

// Siguiente número de mesa del día: continúa aunque las anteriores ya se hayan cobrado
export function getNextTableName(branchId, transactions = [], since = null) {
    return nextTableName(openTables, transactions, branchId, since);
}

export function createTable(branchId, initialItems = [], initialTotal = 0, transactions = [], since = null) {
    const tableName = getNextTableName(branchId, transactions, since);
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
