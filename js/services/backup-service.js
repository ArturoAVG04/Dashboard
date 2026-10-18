import { db } from '../config/firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState } from '../config/storage.js';

// Colecciones de Firestore incluidas en el respaldo. Agregar aquí cada colección nueva.
export const BACKUP_COLLECTIONS = [
    'transactions',
    'dashboard_products',
    'dashboard_categories',
    'dashboard_expense_tags',
    'dashboard_branches',
    'dashboard_tables',
    'dashboard_expense_groups',
    'dashboard_modifier_groups',
    'inventory_items',
    'daily_sessions'
];

// Solo lectura: no escribe nada en Firebase.
export async function buildFullBackup() {
    const backup = {
        app: 'Dashboard La Barra',
        backupVersion: 1,
        generatedAt: new Date().toISOString(),
        source: db ? 'firebase' : 'local',
        summary: {},
        collections: {},
        localStorage: {}
    };

    if (db) {
        for (const name of BACKUP_COLLECTIONS) {
            try {
                const snapshot = await getDocs(collection(db, name));
                backup.collections[name] = snapshot.docs.map(docItem => ({ id: docItem.id, data: docItem.data() }));
                backup.summary[name] = { count: snapshot.size, fromCache: snapshot.metadata.fromCache };
            } catch (error) {
                console.warn(`No se pudo respaldar la colección ${name}:`, error);
                backup.collections[name] = [];
                backup.summary[name] = { count: 0, error: error?.message || String(error) };
            }
        }
    }

    Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
        backup.localStorage[key] = loadLocalState(storageKey, null);
    });

    if (!db) {
        backup.summary.localTransactions = { count: (backup.localStorage.transactions || []).length };
    }

    return backup;
}
