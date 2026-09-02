export class Product {
    constructor({
        id = `p_${Date.now()}`,
        name = '',
        price = 0,
        category = 'General',
        availableInBranches = [],
        modifiers = [],
        order = 0
    } = {}) {
        this.id = id;
        this.name = String(name || '').trim();
        this.price = Number(price) || 0;
        this.category = category || 'General';
        this.availableInBranches = Array.isArray(availableInBranches) ? availableInBranches.filter(Boolean) : [];
        this.modifiers = normalizeModifiers(modifiers);
        this.order = Number(order) || 0;
    }
}

export function normalizeModifiers(modifiers) {
    if (!Array.isArray(modifiers)) return [];
    return modifiers.map((group, gIdx) => ({
        id: group.id || `mod_${Date.now()}_${gIdx}`,
        name: String(group.name || '').trim(),
        type: group.type === 'multiple' ? 'multiple' : 'single',
        options: Array.isArray(group.options)
            ? group.options.map((opt, oIdx) => ({
                id: opt.id || `opt_${Date.now()}_${oIdx}`,
                name: String(typeof opt === 'string' ? opt : (opt.name || '')).trim(),
                price: Number(opt.price) || 0
            })).filter(opt => opt.name !== '')
            : []
    })).filter(group => group.name !== '' && group.options.length > 0);
}

export function normalizeProduct(product, index = 0) {
    return new Product({
        ...product,
        id: product?.id || `p_${index}_${Date.now()}`
    });
}

export function normalizeProducts(products) {
    return (products || []).map((product, index) => normalizeProduct(product, index));
}

export function groupProductsByCategory(products) {
    return (products || []).reduce((accumulator, product) => {
        const cat = product.category || 'General';
        if (!accumulator[cat]) accumulator[cat] = [];
        accumulator[cat].push(product);
        return accumulator;
    }, {});
}

export function upsertProduct(products, payload, editingProductId = null) {
    if (editingProductId) {
        return products.map(product => product.id === editingProductId
            ? { ...product, ...payload }
            : product
        );
    }

    return [...products, normalizeProduct({ id: 'p_' + Date.now(), ...payload })];
}

export function moveProductInList(products, index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= products.length) return products;

    const nextProducts = [...products];
    const temp = nextProducts[index];
    nextProducts[index] = nextProducts[newIndex];
    nextProducts[newIndex] = temp;
    return nextProducts;
}

export function removeProductById(products, id) {
    return products.filter(product => product.id !== id);
}
