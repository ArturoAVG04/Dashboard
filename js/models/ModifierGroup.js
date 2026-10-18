import { normalizeText } from '../core/date-utils.js';
import { normalizeModifiers } from './Product.js';
import { normalizeStockUsage } from './Inventory.js';

// Modificadores compartidos: un grupo (ej. "Salsas") que se asigna a varios productos.
// type 'single' = elige exactamente 1; 'multiple' = elige varias (opcionalmente obligatorio y con máximo).
export function normalizeModifierGroup(group, index = 0) {
    const type = group?.type === 'multiple' ? 'multiple' : 'single';
    const maxSelect = Number(group?.maxSelect);
    return {
        ...group,
        id: group?.id || `modg_${Date.now()}_${index}`,
        name: String(group?.name || '').trim(),
        type,
        required: type === 'single' ? true : Boolean(group?.required),
        maxSelect: type === 'multiple' && Number.isFinite(maxSelect) && maxSelect > 0 ? Math.floor(maxSelect) : null,
        options: (Array.isArray(group?.options) ? group.options : [])
            .map((opt, oIdx) => ({
                ...(typeof opt === 'object' ? opt : {}),
                id: opt?.id || `opt_${Date.now()}_${index}_${oIdx}`,
                name: String(typeof opt === 'string' ? opt : (opt?.name || '')).trim(),
                price: Number(opt?.price) || 0,
                stockUsage: normalizeStockUsage(opt?.stockUsage)
            }))
            .filter(opt => opt.name),
        order: typeof group?.order === 'number' ? group.order : index
    };
}

export function normalizeModifierGroups(groups) {
    return (groups || [])
        .map((group, index) => normalizeModifierGroup(group, index))
        .filter(group => group.name && group.options.length > 0)
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

// Un producto usa el sistema nuevo si tiene el campo modifierGroupIds (aunque esté vacío).
export function usesSharedModifiers(product) {
    return Array.isArray(product?.modifierGroupIds);
}

export function hasLegacyModifiers(product) {
    return !usesSharedModifiers(product) && normalizeModifiers(product?.modifiers).length > 0;
}

// Grupos de modificadores que aplican a un producto (nuevo sistema o, si no, los del producto)
export function resolveProductModifierGroups(product, modifierGroups) {
    if (usesSharedModifiers(product)) {
        const byId = new Map((modifierGroups || []).map(group => [group.id, group]));
        return product.modifierGroupIds.map(id => byId.get(id)).filter(Boolean);
    }
    return normalizeModifiers(product?.modifiers);
}

export function modifierGroupSignature(group) {
    const options = (group?.options || []).map(opt => `${normalizeText(opt.name)}:${Number(opt.price) || 0}`).join(',');
    return `${normalizeText(group?.name)}|${group?.type === 'multiple' ? 'multiple' : 'single'}|${options}`;
}

function hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    return hash.toString(36);
}

// Plan para convertir los modificadores viejos (dentro de cada producto) en grupos compartidos.
// Grupos iguales (mismo nombre, tipo, opciones y precios) se fusionan en uno solo.
// Los ids son deterministas, así dos dispositivos que conviertan a la vez generan el mismo grupo.
// No modifica los datos viejos: solo indica qué grupos crear y qué modifierGroupIds asignar.
export function planLegacyModifierMigration(products, existingGroups) {
    const bySignature = new Map((existingGroups || []).map(group => [modifierGroupSignature(group), group]));
    const newGroups = [];
    const productUpdates = [];

    (products || []).forEach(product => {
        if (!hasLegacyModifiers(product)) return;

        const ids = normalizeModifiers(product.modifiers).map(legacyGroup => {
            const signature = modifierGroupSignature(legacyGroup);
            let group = bySignature.get(signature);
            if (!group) {
                group = normalizeModifierGroup({
                    id: `modg_${hashString(signature)}`,
                    name: legacyGroup.name,
                    type: legacyGroup.type,
                    required: legacyGroup.type === 'single',
                    options: legacyGroup.options.map(opt => ({ id: opt.id, name: opt.name, price: opt.price })),
                    order: (existingGroups || []).length + newGroups.length
                });
                bySignature.set(signature, group);
                newGroups.push(group);
            }
            return group.id;
        });

        productUpdates.push({ id: product.id, modifierGroupIds: [...new Set(ids)] });
    });

    return { newGroups, productUpdates };
}

export function describeModifierGroupRule(group) {
    if (group.type === 'single') return 'Elige 1';
    const parts = [group.required ? 'Elige al menos 1' : 'Opcional'];
    if (group.maxSelect) parts.push(`máx. ${group.maxSelect}`);
    return parts.join(' · ');
}
