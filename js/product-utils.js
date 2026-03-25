export function groupProductsByCategory(products) {
    return products.reduce((accumulator, product) => {
        if (!accumulator[product.category]) accumulator[product.category] = [];
        accumulator[product.category].push(product);
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

    return [...products, { id: 'p_' + Date.now(), ...payload }];
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
