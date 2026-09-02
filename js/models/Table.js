export class Table {
    constructor({
        id = `table_${Date.now()}`,
        branchId = '',
        name = 'Mesa',
        items = [],
        total = 0,
        status = 'open',
        createdAt = new Date().toISOString()
    } = {}) {
        this.id = id;
        this.branchId = branchId;
        this.name = name;
        this.items = normalizeTableItems(items);
        this.total = typeof total === 'number' && total > 0 ? total : calculateItemsTotal(this.items);
        this.status = status;
        this.createdAt = createdAt;
    }
}

export function normalizeTableItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, itemIdx) => ({
        id: item.id || `item_${item.productId || 'p'}_${Date.now()}_${itemIdx}`,
        productId: item.productId || '',
        name: item.name || 'Producto',
        basePrice: typeof item.basePrice === 'number' ? item.basePrice : (Number(item.price) || 0),
        price: Number(item.price) || 0,
        qty: Number(item.qty) || 0,
        selectedModifiers: Array.isArray(item.selectedModifiers)
            ? item.selectedModifiers
            : (Array.isArray(item.modifiers) ? item.modifiers : []),
        modifierText: item.modifierText || '',
        modSignature: item.modSignature || ''
    })).filter(item => item.qty > 0);
}

export function calculateItemsTotal(items) {
    return (items || []).reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
}

export const getItemsTotal = calculateItemsTotal;

export function normalizeTable(table, index = 0) {
    return new Table({
        ...table,
        id: table?.id || `table_${Date.now()}_${index}`
    });
}

export function normalizeOpenTables(tables) {
    return (tables || [])
        .map((table, index) => normalizeTable(table, index))
        .filter(table => table.status === 'open');
}
