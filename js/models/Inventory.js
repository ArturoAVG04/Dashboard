// Inventario por sucursal: cada artículo (lo que se lleva físicamente, ej. "Burrito Base") pertenece a una
// sucursal y define qué productos del menú lo consumen y cuántas unidades descuenta cada uno.
//   item.consumers = [{ type: 'product', productId, qty }, { type: 'option', groupId, optionId, qty }]
// Ejemplo: "1 Burrito" → qty 1, "2 Burritos" → qty 2.

export const INVENTORY_UNITS = [
    { value: 'pza', label: 'Pieza' },
    { value: 'kg', label: 'Kilo' },
    { value: 'L', label: 'Litro' },
    { value: 'paq', label: 'Paquete' }
];

function roundQty(value) {
    return Math.round(value * 1000) / 1000;
}

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

// Lista { itemId, qty } limpia: sin vacíos, cantidades > 0 y un renglón por artículo
export function normalizeStockUsage(usage) {
    if (!Array.isArray(usage)) return [];
    const totals = new Map();
    usage.forEach(entry => {
        const itemId = entry?.itemId;
        const qty = Number(entry?.qty);
        if (!itemId || !Number.isFinite(qty) || qty <= 0) return;
        totals.set(itemId, roundQty((totals.get(itemId) || 0) + qty));
    });
    return [...totals].map(([itemId, qty]) => ({ itemId, qty }));
}

function consumerKey(consumer) {
    return consumer.type === 'option' ? `option:${consumer.groupId}:${consumer.optionId}` : `product:${consumer.productId}`;
}

export function normalizeConsumers(consumers) {
    if (!Array.isArray(consumers)) return [];
    const byKey = new Map();
    consumers.forEach(entry => {
        const qty = Number(entry?.qty);
        if (!Number.isFinite(qty) || qty <= 0) return;
        let consumer = null;
        if (entry.type === 'option' && entry.groupId && entry.optionId) {
            consumer = { type: 'option', groupId: entry.groupId, optionId: entry.optionId, qty: roundQty(qty) };
        } else if (entry.productId) {
            consumer = { type: 'product', productId: entry.productId, qty: roundQty(qty) };
        }
        if (consumer) byKey.set(consumerKey(consumer), consumer);
    });
    return [...byKey.values()];
}

export function normalizeInventoryItems(items) {
    return (items || [])
        .map((item, index) => {
            const unitCost = Number(item.unitCost);
            return {
                ...item,
                id: item.id || `inv_${Date.now()}_${index}`,
                branchId: item.branchId || null,
                name: String(item.name || '').trim(),
                unit: item.unit || 'pza',
                unitCost: item.unitCost === null || item.unitCost === '' || item.unitCost === undefined || !Number.isFinite(unitCost) || unitCost < 0 ? null : unitCost,
                active: item.active !== false,
                consumers: normalizeConsumers(item.consumers),
                order: typeof item.order === 'number' ? item.order : index
            };
        })
        .filter(item => item.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export function getBranchItems(items, branchId) {
    return (items || []).filter(item => item.branchId && item.branchId === branchId);
}

// Qué descuenta un producto en una sucursal: [{ itemId, qty }]
export function getProductUsage(productId, branchItems) {
    return normalizeStockUsage((branchItems || []).flatMap(item => item.consumers
        .filter(consumer => consumer.type === 'product' && consumer.productId === productId)
        .map(consumer => ({ itemId: item.id, qty: consumer.qty }))));
}

export function getOptionUsage(groupId, optionId, branchItems) {
    return normalizeStockUsage((branchItems || []).flatMap(item => item.consumers
        .filter(consumer => consumer.type === 'option' && consumer.groupId === groupId && consumer.optionId === optionId)
        .map(consumer => ({ itemId: item.id, qty: consumer.qty }))));
}

// Consumo total de inventario de una venta con los artículos de su sucursal.
// saleItems: [{ productId, qty, selectedModifiers: [{ groupId, optionId }] }]
export function computeStockConsumption(saleItems, branchItems) {
    const totals = new Map();
    const add = (usage, multiplier) => usage.forEach(({ itemId, qty }) => {
        totals.set(itemId, roundQty((totals.get(itemId) || 0) + qty * multiplier));
    });

    (saleItems || []).forEach(saleItem => {
        const qty = Number(saleItem.qty) || 0;
        if (qty <= 0) return;
        add(getProductUsage(saleItem.productId, branchItems), qty);
        const selected = Array.isArray(saleItem.selectedModifiers) ? saleItem.selectedModifiers : (saleItem.modifiers || []);
        selected.forEach(modifier => {
            if (modifier.groupId && modifier.optionId) add(getOptionUsage(modifier.groupId, modifier.optionId, branchItems), qty);
        });
    });

    return [...totals].filter(([, qty]) => qty > 0).map(([itemId, qty]) => ({ itemId, qty }));
}

// Costo de un producto en una sucursal según el costo por unidad de los artículos que consume.
export function computeProductUnitCost(productId, branchItems) {
    const usage = getProductUsage(productId, branchItems);
    if (usage.length === 0) return null;
    const itemsById = new Map((branchItems || []).map(item => [item.id, item]));
    let cost = 0;
    let complete = true;
    usage.forEach(({ itemId, qty }) => {
        const unitCost = itemsById.get(itemId)?.unitCost;
        if (typeof unitCost === 'number') cost += unitCost * qty;
        else complete = false;
    });
    return { cost: roundMoney(cost), complete };
}

// Parte del precio de un producto que corresponde a un artículo (si el producto consume varios
// artículos, el precio se reparte según las unidades de cada uno).
function itemShareOfProduct(productId, itemId, branchItems) {
    const usage = getProductUsage(productId, branchItems);
    const total = usage.reduce((sum, entry) => sum + entry.qty, 0);
    const own = usage.find(entry => entry.itemId === itemId)?.qty || 0;
    return total > 0 ? own / total : 0;
}

// Precio medio por unidad de un artículo.
// - Con historial: ingreso real de los productos que lo consumen ÷ unidades vendidas (pondera la mezcla real,
//   ej. si casi siempre se vende la promo, el precio medio se acerca al de la promo).
// - Sin historial: media simple del precio por unidad de cada producto (ej. $40/1 y $80/2 → $40).
export function computeItemUnitPrice(item, products, branchItems, { transactions = [], branchId = null, since = null } = {}) {
    const productsById = new Map((products || []).map(product => [product.id, product]));
    const productConsumers = (item?.consumers || []).filter(c => c.type === 'product' && productsById.has(c.productId));
    if (productConsumers.length === 0) return null;

    const perProduct = productConsumers.map(consumer => {
        const product = productsById.get(consumer.productId);
        const share = itemShareOfProduct(consumer.productId, item.id, branchItems);
        return {
            productId: consumer.productId,
            name: product.name,
            price: Number(product.price) || 0,
            qty: consumer.qty,
            unitPrice: roundMoney(((Number(product.price) || 0) * share) / consumer.qty)
        };
    });
    const simpleMean = roundMoney(perProduct.reduce((sum, entry) => sum + entry.unitPrice, 0) / perProduct.length);

    let units = 0;
    let revenue = 0;
    const consumerQty = new Map(productConsumers.map(c => [c.productId, c.qty]));
    const sinceTime = since ? new Date(since).getTime() : null;
    (transactions || []).forEach(tx => {
        if (tx.type !== 'income' || (branchId && tx.branchId !== branchId && tx.branch !== branchId)) return;
        if (sinceTime && new Date(tx.date || tx.createdAt || 0).getTime() < sinceTime) return;
        (tx.itemsSoldArray || []).forEach(line => {
            const qtyPerSale = consumerQty.get(line.productId);
            if (!qtyPerSale) return;
            const lineQty = Number(line.qty) || 0;
            const lineTotal = Number(line.total) || (Number(line.price) || 0) * lineQty;
            units += qtyPerSale * lineQty;
            revenue += lineTotal * itemShareOfProduct(line.productId, item.id, branchItems);
        });
    });

    const weighted = units >= 1 ? roundMoney(revenue / units) : null;
    return {
        unitPrice: weighted ?? simpleMean,
        basis: weighted !== null ? 'history' : 'menu',
        unitsSold: roundQty(units),
        simpleMean,
        perProduct
    };
}

// Convierte artículos del esquema anterior (sin sucursal, consumo guardado en cada producto/opción)
// al esquema por sucursal. No modifica productos ni opciones: solo arma los consumers del artículo.
export function planLegacyInventoryMigration(items, products, modifierGroups, branchId) {
    return (items || [])
        .filter(item => !item.branchId)
        .map(item => {
            const consumers = [];
            (products || []).forEach(product => {
                normalizeStockUsage(product.stockUsage)
                    .filter(entry => entry.itemId === item.id)
                    .forEach(entry => consumers.push({ type: 'product', productId: product.id, qty: entry.qty }));
            });
            (modifierGroups || []).forEach(group => {
                (group.options || []).forEach(option => {
                    normalizeStockUsage(option.stockUsage)
                        .filter(entry => entry.itemId === item.id)
                        .forEach(entry => consumers.push({ type: 'option', groupId: group.id, optionId: option.id, qty: entry.qty }));
                });
            });
            return { ...item, branchId, consumers: normalizeConsumers([...(item.consumers || []), ...consumers]) };
        });
}
