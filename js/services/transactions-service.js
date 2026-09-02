import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { isSameLocalDate } from '../core/date-utils.js';

let transactions = loadLocalState(STORAGE_KEYS.transactions, []);

export function getTransactions() {
    return transactions;
}

export function setTransactions(txs) {
    transactions = txs;
    saveLocalState(STORAGE_KEYS.transactions, transactions);
}

export function fetchTransactions(callback) {
    if (!db) {
        if (typeof callback === 'function') callback(transactions);
        return;
    }

    const q = query(collection(db, "transactions"), orderBy("date", "desc"));
    onSnapshot(q, (snapshot) => {
        const cloudTransactions = [];
        snapshot.forEach((docItem) => {
            cloudTransactions.push({ id: docItem.id, ...docItem.data() });
        });

        const tempTransactions = transactions.filter(t => typeof t.id === 'string' && t.id.startsWith('temp_'));
        transactions = [...tempTransactions, ...cloudTransactions];
        saveLocalState(STORAGE_KEYS.transactions, transactions);

        if (typeof callback === 'function') callback(transactions);
    }, (error) => {
        console.warn("No se pudieron cargar transacciones de Firebase:", error);
        if (typeof callback === 'function') callback(transactions);
    });
}

export async function saveTransaction(newTx) {
    if (!db) {
        const localTx = { ...newTx, id: `temp_${Date.now()}` };
        transactions = [localTx, ...transactions];
        saveLocalState(STORAGE_KEYS.transactions, transactions);
        return localTx;
    }

    const docRef = await addDoc(collection(db, "transactions"), newTx);
    const savedTx = { ...newTx, id: docRef.id };
    transactions = [savedTx, ...transactions.filter(t => t.id !== savedTx.id)];
    saveLocalState(STORAGE_KEYS.transactions, transactions);
    return savedTx;
}

export async function updateTransactionRecord(id, updatedData) {
    if (db && !id.startsWith('temp_')) {
        await updateDoc(doc(db, "transactions", id), updatedData);
    }

    transactions = transactions.map(t => t.id === id ? { ...t, ...updatedData, id } : t);
    saveLocalState(STORAGE_KEYS.transactions, transactions);
    return transactions.find(t => t.id === id);
}

export async function deleteTransactionRecord(id) {
    if (db && !id.startsWith('temp_')) {
        await deleteDoc(doc(db, "transactions", id));
    }

    transactions = transactions.filter(t => t.id !== id);
    saveLocalState(STORAGE_KEYS.transactions, transactions);
}

export function syncStrandedOfflineTransactions() {
    if (!db) return;
    const tempTxs = transactions.filter(t => typeof t.id === 'string' && t.id.startsWith('temp_'));
    if (tempTxs.length === 0) return;

    tempTxs.forEach(async (tempTx) => {
        try {
            const { id, ...dataToUpload } = tempTx;
            const docRef = await addDoc(collection(db, "transactions"), dataToUpload);
            transactions = transactions.map(t => t.id === tempTx.id ? { ...dataToUpload, id: docRef.id } : t);
            saveLocalState(STORAGE_KEYS.transactions, transactions);
        } catch (e) {
            console.warn("Fallo re-sincronización offline:", e);
        }
    });
}
