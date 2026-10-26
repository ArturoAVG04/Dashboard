import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { INITIAL_ZONES, BRANCH_COLOR_PALETTE } from '../config/constants.js';
import { normalizeText } from '../core/date-utils.js';
import { commitListChanges, uploadList } from './firestore-sync.js';
import { normalizeSchedule } from '../models/BranchConfig.js';

const BRANCHES_COLLECTION = 'dashboard_branches';

let customBranches = sortNamedListAlphabetically(normalizeNamedList(loadLocalState(STORAGE_KEYS.branches, INITIAL_ZONES), 'branch'));
let branchColorMap = loadLocalState(STORAGE_KEYS.branchColors, {});

export function normalizeNamedList(items, prefix) {
    return (items || []).map((item, index) => {
        if (typeof item === 'string') {
            return {
                id: `${prefix}_${index}_${item.toLowerCase().replace(/\s+/g, '_')}`,
                name: item,
                order: index,
                ...(prefix === 'branch' ? { useTables: false } : {})
            };
        }

        // Se conservan todos los campos del documento (p. ej. configuración nueva de sucursal)
        const normalizedItem = {
            ...item,
            id: item.id || `${prefix}_${index}_${(item.name || '').toLowerCase().replace(/\s+/g, '_')}`,
            name: item.name || '',
            order: typeof item.order === 'number' ? item.order : index
        };

        if (prefix === 'branch') {
            normalizedItem.useTables = Boolean(item.useTables);
        }

        return normalizedItem;
    }).filter(item => item.name);
}

export function sortNamedListAlphabetically(items) {
    return [...items]
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
        .map((item, index) => ({ ...item, order: index }));
}

export function hasDuplicateName(items, name, ignoreId = null) {
    const normalizedName = normalizeText(name);
    return items.some(item => item.id !== ignoreId && normalizeText(item.name) === normalizedName);
}

export function getCustomBranches() {
    return customBranches;
}

export function getBranchById(branchId) {
    return customBranches.find(branch => branch.id === branchId) || null;
}

export function getBranchNameById(branchId) {
    return getBranchById(branchId)?.name || '';
}

export function productAvailableInBranch(product, branchId) {
    if (!product || !branchId) return true;
    if (!Array.isArray(product.availableInBranches) || product.availableInBranches.length === 0) {
        return true;
    }

    const branch = getBranchById(branchId);
    const branchName = branch ? branch.name : '';

    return product.availableInBranches.some(b => {
        if (!b) return false;
        return b === branchId || (branchName && b === branchName) || (branch && b === branch.id);
    });
}

export function getBranchColorKey(branch) {
    return branch?.id || `branch:${normalizeText(branch?.name || '')}`;
}

export function createGeneratedBranchColor(index) {
    const hue = (index * 47) % 360;
    return `hsl(${hue}, 72%, 52%)`;
}

export function getStableBranchColor(branch) {
    const key = getBranchColorKey(branch);
    if (!key) return '#334155';
    if (branchColorMap[key]) return branchColorMap[key];

    const usedColors = new Set(Object.values(branchColorMap));
    const paletteColor = BRANCH_COLOR_PALETTE.find(color => !usedColors.has(color));
    branchColorMap[key] = paletteColor || createGeneratedBranchColor(usedColors.size);
    saveLocalState(STORAGE_KEYS.branchColors, branchColorMap);
    return branchColorMap[key];
}

// Campos que la app guarda en Firestore. Los campos extra del documento se conservan (merge).
export function branchToDoc(branch, index) {
    return {
        name: branch.name,
        useTables: Boolean(branch.useTables),
        order: typeof branch.order === 'number' ? branch.order : index,
        // Configuración de jornadas (F5). En sucursales sin configurar estos valores por defecto
        // coinciden con los de la lista anterior, así que no se escriben hasta que se editan.
        isEvent: Boolean(branch.isEvent),
        sessionsEnabled: Boolean(branch.sessionsEnabled),
        inventoryEnabled: Boolean(branch.inventoryEnabled),
        openMode: branch.openMode === 'schedule' ? 'schedule' : 'manual',
        schedule: normalizeSchedule(branch.schedule),
        // Orden propio de productos en esta sucursal
        productOrder: Array.isArray(branch.productOrder) ? branch.productOrder : []
    };
}

// Reemplaza la lista local y guarda en Firestore solo las sucursales que cambiaron
export function commitBranches(branches) {
    const previous = customBranches;
    customBranches = branches;
    saveLocalState(STORAGE_KEYS.branches, customBranches);
    return commitListChanges(BRANCHES_COLLECTION, previous, customBranches, branchToDoc);
}

export function subscribeBranches(callback) {
    if (!db) return;

    const branchesQuery = query(collection(db, BRANCHES_COLLECTION), orderBy("order", "asc"));
    onSnapshot(branchesQuery, async (snapshot) => {
        if (snapshot.empty) {
            await uploadList(BRANCHES_COLLECTION, customBranches, branchToDoc);
            return;
        }

        customBranches = sortNamedListAlphabetically(normalizeNamedList(snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
        })), 'branch'));
        saveLocalState(STORAGE_KEYS.branches, customBranches);
        if (typeof callback === 'function') callback(customBranches);
    }, (error) => {
        console.warn("No se pudieron leer las sucursales desde Firebase:", error);
    });
}
