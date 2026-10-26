import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';

// Rendimiento (F7b): en vivo solo se escuchan los últimos RECENT_DAYS días. Lo más viejo se pide
// una sola vez y bajo demanda (filtro "Año"/"Todo", rangos de fechas, semanas viejas del reporte).
// LocalStorage guarda solo ese periodo + las ventas pendientes de subir (temp_).
const RECENT_DAYS = 90;
const RECENT_CUTOFF = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECENT_DAYS);
})();
const RECENT_CUTOFF_ISO = RECENT_CUTOFF.toISOString();

let transactions = loadLocalState(STORAGE_KEYS.transactions, []);
let olderTransactions = [];
let fullHistoryLoaded = !db;
let fullHistoryPromise = null;
let onTransactionsChange = null;
let onStorageWarning = null;
let storageWarned = false;

const isTemp = (t) => typeof t.id === 'string' && t.id.startsWith('temp_');

export function getTransactions() {
    return transactions;
}

export function getRecentCutoff() {
    return RECENT_CUTOFF;
}

export function isFullHistoryLoaded() {
    return fullHistoryLoaded;
}

// ¿Hace falta el historial completo para ver desde esta fecha?
export function needsFullHistory(fromDate) {
    if (fullHistoryLoaded) return false;
    if (!fromDate) return true;
    const date = fromDate instanceof Date ? fromDate : new Date(fromDate);
    return isNaN(date.getTime()) || date < RECENT_CUTOFF;
}

export function setStorageWarningHandler(handler) {
    onStorageWarning = handler;
}

// Copia local: solo lo reciente y lo que falta por subir
function persist() {
    // Sin Firebase la copia local es la única: se guarda completa
    const toStore = !db ? transactions : transactions.filter(t => isTemp(t) || String(t.date || t.createdAt || '') >= RECENT_CUTOFF_ISO);
    const ok = saveLocalState(STORAGE_KEYS.transactions, toStore);
    if (!ok && !storageWarned) {
        storageWarned = true;
        if (typeof onStorageWarning === 'function') onStorageWarning();
    }
}

export function setTransactions(txs) {
    transactions = txs;
    persist();
}

function notify() {
    if (typeof onTransactionsChange === 'function') onTransactionsChange(transactions);
}

export function fetchTransactions(callback) {
    onTransactionsChange = callback;
    if (!db) {
        notify();
        return;
    }

    const q = query(collection(db, "transactions"), where("date", ">=", RECENT_CUTOFF_ISO), orderBy("date", "desc"));
    onSnapshot(q, (snapshot) => {
        const cloudTransactions = [];
        snapshot.forEach((docItem) => {
            cloudTransactions.push({ id: docItem.id, ...docItem.data() });
        });

        const cloudIds = new Set(cloudTransactions.map(t => t.id));
        const tempTransactions = transactions.filter(isTemp);
        transactions = [...tempTransactions, ...cloudTransactions, ...olderTransactions.filter(t => !cloudIds.has(t.id))];
        persist();
        notify();
    }, (error) => {
        console.warn("No se pudieron cargar transacciones de Firebase:", error);
        notify();
    });
}

// Pide una sola vez todo lo anterior a la ventana reciente
export function loadFullHistory() {
    if (fullHistoryLoaded) return Promise.resolve(transactions);
    if (fullHistoryPromise) return fullHistoryPromise;

    fullHistoryPromise = getDocs(query(collection(db, "transactions"), where("date", "<", RECENT_CUTOFF_ISO), orderBy("date", "desc")))
        .then(snapshot => {
            olderTransactions = snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
            const knownIds = new Set(transactions.map(t => t.id));
            transactions = [...transactions, ...olderTransactions.filter(t => !knownIds.has(t.id))];
            fullHistoryLoaded = true;
            notify();
            return transactions;
        })
        .catch(error => {
            console.warn("No se pudo cargar el historial completo:", error);
            fullHistoryPromise = null;
            throw error;
        });
    return fullHistoryPromise;
}

export async function saveTransaction(newTx) {
    if (!db) {
        const localTx = { ...newTx, id: `temp_${Date.now()}` };
        transactions = [localTx, ...transactions];
        persist();
        return localTx;
    }

    const docRef = await addDoc(collection(db, "transactions"), newTx);
    const savedTx = { ...newTx, id: docRef.id };
    transactions = [savedTx, ...transactions.filter(t => t.id !== savedTx.id)];
    persist();
    return savedTx;
}

export async function updateTransactionRecord(id, updatedData) {
    if (db && !id.startsWith('temp_')) {
        await updateDoc(doc(db, "transactions", id), updatedData);
    }

    transactions = transactions.map(t => t.id === id ? { ...t, ...updatedData, id } : t);
    olderTransactions = olderTransactions.map(t => t.id === id ? { ...t, ...updatedData, id } : t);
    persist();
    return transactions.find(t => t.id === id);
}

export async function deleteTransactionRecord(id) {
    if (db && !id.startsWith('temp_')) {
        await deleteDoc(doc(db, "transactions", id));
    }

    transactions = transactions.filter(t => t.id !== id);
    olderTransactions = olderTransactions.filter(t => t.id !== id);
    persist();
}

export function syncStrandedOfflineTransactions() {
    if (!db) return;
    const tempTxs = transactions.filter(isTemp);
    if (tempTxs.length === 0) return;

    tempTxs.forEach(async (tempTx) => {
        try {
            const { id, ...dataToUpload } = tempTx;
            const docRef = await addDoc(collection(db, "transactions"), dataToUpload);
            transactions = transactions.map(t => t.id === tempTx.id ? { ...dataToUpload, id: docRef.id } : t);
            persist();
        } catch (e) {
            console.warn("Fallo re-sincronización offline:", e);
        }
    });
}
