import { db } from '../config/firebase-config.js';
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { diffById } from '../core/collection-diff.js';

const BATCH_LIMIT = 450; // Firestore permite 500 operaciones por lote

// Guarda en Firestore solo los documentos que cambiaron entre `previous` y `next`.
// Usa merge para conservar campos que esta versión de la app no conozca.
// Nunca borra la colección completa: solo los documentos que se quitaron de la lista.
export async function commitListChanges(collectionName, previous, next, toData) {
    const { upserts, deletes } = diffById(previous, next, toData);
    if (!db || (upserts.length === 0 && deletes.length === 0)) return { upserts, deletes };

    const operations = [
        ...upserts.map(({ id, data }) => batch => batch.set(doc(db, collectionName, id), data, { merge: true })),
        ...deletes.map(id => batch => batch.delete(doc(db, collectionName, id)))
    ];

    try {
        for (let start = 0; start < operations.length; start += BATCH_LIMIT) {
            const batch = writeBatch(db);
            operations.slice(start, start + BATCH_LIMIT).forEach(apply => apply(batch));
            await batch.commit();
        }
    } catch (error) {
        console.warn(`No se pudieron guardar los cambios en ${collectionName}:`, error);
    }
    return { upserts, deletes };
}

// Sube la lista local a una colección vacía (primer uso). No borra nada.
export function uploadList(collectionName, items, toData) {
    return commitListChanges(collectionName, [], items, toData);
}
