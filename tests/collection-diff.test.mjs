import test from 'node:test';
import assert from 'node:assert/strict';
import { diffById } from '../js/core/collection-diff.js';
import { normalizeProduct } from '../js/models/Product.js';

const toData = (item, index) => ({ name: item.name, order: typeof item.order === 'number' ? item.order : index });

test('sin cambios no escribe nada', () => {
    const list = [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }];
    assert.deepEqual(diffById(list, list.map(x => ({ ...x })), toData), { upserts: [], deletes: [] });
});

test('editar uno solo escribe ese documento', () => {
    const before = [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }];
    const after = [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B2', order: 1 }];
    const diff = diffById(before, after, toData);
    assert.deepEqual(diff.upserts, [{ id: 'b', data: { name: 'B2', order: 1 } }]);
    assert.deepEqual(diff.deletes, []);
});

test('eliminar uno solo borra ese documento', () => {
    const before = [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }];
    const after = [{ id: 'a', name: 'A', order: 0 }];
    assert.deepEqual(diffById(before, after, toData), { upserts: [], deletes: ['b'] });
});

test('agregar uno solo escribe el nuevo', () => {
    const before = [{ id: 'a', name: 'A', order: 0 }];
    const after = [...before, { id: 'c', name: 'C', order: 1 }];
    assert.deepEqual(diffById(before, after, toData).upserts.map(u => u.id), ['c']);
});

test('reordenar escribe solo los que cambiaron de posición', () => {
    const before = [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }, { id: 'c', name: 'C', order: 2 }];
    const after = [{ id: 'b', name: 'B', order: 0 }, { id: 'a', name: 'A', order: 1 }, { id: 'c', name: 'C', order: 2 }];
    assert.deepEqual(diffById(before, after, toData).upserts.map(u => u.id).sort(), ['a', 'b']);
});

test('un elemento que no estaba en la lista anterior nunca se borra (otro dispositivo lo agregó)', () => {
    const before = [{ id: 'a', name: 'A', order: 0 }];
    const after = [{ id: 'a', name: 'A', order: 0 }];
    // "x" existe en la nube pero no en la lista local: no aparece en deletes
    assert.deepEqual(diffById(before, after, toData).deletes, []);
});

test('elementos sin nombre no se guardan', () => {
    assert.deepEqual(diffById([], [{ id: 'z', name: '' }], toData).upserts, []);
});

test('el producto conserva campos que la app aún no conoce', () => {
    const product = normalizeProduct({ id: 'p1', name: 'Burrito', price: 60, stockUsage: [{ itemId: 'inv_burrito', qty: 2 }] });
    assert.deepEqual(product.stockUsage, [{ itemId: 'inv_burrito', qty: 2 }]);
    assert.equal(product.price, 60);
});

test('orden por sucursal: respeta productOrder y deja al final los nuevos en orden general', async () => {
    const { sortProductsForBranch } = await import('../js/models/Product.js');
    const products = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }, { id: 'd', order: 3 }];
    assert.deepEqual(sortProductsForBranch(products, { productOrder: ['c', 'a'] }).map(p => p.id), ['c', 'a', 'b', 'd']);
    assert.deepEqual(sortProductsForBranch(products, {}).map(p => p.id), ['a', 'b', 'c', 'd']);
    assert.deepEqual(sortProductsForBranch(products, { productOrder: ['zz', 'd'] }).map(p => p.id), ['d', 'a', 'b', 'c']);
});
