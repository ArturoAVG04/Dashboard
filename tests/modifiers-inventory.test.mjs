import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeModifierGroup,
    resolveProductModifierGroups,
    hasLegacyModifiers,
    planLegacyModifierMigration,
    describeModifierGroupRule
} from '../js/models/ModifierGroup.js';
import {
    normalizeStockUsage,
    computeStockConsumption,
    computeProductUnitCost,
    normalizeInventoryItems,
    getProductUsage,
    computeItemUnitPrice,
    planLegacyInventoryMigration
} from '../js/models/Inventory.js';

const salsas = { id: 'mod_a', name: 'Salsas', type: 'single', options: [{ id: 'o1', name: 'BBQ', price: 0 }, { id: 'o2', name: 'Búfalo', price: 5 }] };

test('migración: grupos iguales en varios productos se fusionan en uno', () => {
    const products = [
        { id: 'p1', name: 'Alitas', modifiers: [salsas] },
        { id: 'p2', name: 'Boneless', modifiers: [{ ...salsas, id: 'mod_b' }] },
        { id: 'p3', name: 'Refresco', modifiers: [] }
    ];
    const plan = planLegacyModifierMigration(products, []);
    assert.equal(plan.newGroups.length, 1);
    assert.equal(plan.productUpdates.length, 2);
    assert.deepEqual(plan.productUpdates[0].modifierGroupIds, plan.productUpdates[1].modifierGroupIds);
    assert.equal(plan.newGroups[0].options[1].price, 5);
});

test('migración: precio distinto = grupo distinto; ids deterministas', () => {
    const products = [
        { id: 'p1', name: 'Alitas', modifiers: [salsas] },
        { id: 'p2', name: 'Boneless', modifiers: [{ ...salsas, options: [{ name: 'BBQ', price: 0 }, { name: 'Búfalo', price: 10 }] }] }
    ];
    const a = planLegacyModifierMigration(products, []);
    const b = planLegacyModifierMigration(products, []);
    assert.equal(a.newGroups.length, 2);
    assert.deepEqual(a.newGroups.map(g => g.id), b.newGroups.map(g => g.id));
});

test('migración: reutiliza un grupo compartido que ya existe y omite productos ya migrados', () => {
    const existing = [normalizeModifierGroup({ ...salsas, id: 'modg_existente' })];
    const products = [
        { id: 'p1', name: 'Alitas', modifiers: [salsas] },
        { id: 'p2', name: 'Boneless', modifiers: [salsas], modifierGroupIds: [] }
    ];
    const plan = planLegacyModifierMigration(products, existing);
    assert.equal(plan.newGroups.length, 0);
    assert.deepEqual(plan.productUpdates, [{ id: 'p1', modifierGroupIds: ['modg_existente'] }]);
});

test('resolver: sistema nuevo usa grupos compartidos; viejo usa los del producto', () => {
    const groups = [normalizeModifierGroup({ ...salsas, id: 'g1' })];
    assert.equal(resolveProductModifierGroups({ modifierGroupIds: ['g1', 'borrado'] }, groups).length, 1);
    assert.equal(resolveProductModifierGroups({ modifiers: [salsas] }, groups)[0].name, 'Salsas');
    assert.equal(hasLegacyModifiers({ modifiers: [salsas] }), true);
    assert.equal(hasLegacyModifiers({ modifiers: [salsas], modifierGroupIds: [] }), false);
});

test('reglas de grupo', () => {
    assert.equal(describeModifierGroupRule(normalizeModifierGroup(salsas)), 'Elige 1');
    const extras = normalizeModifierGroup({ name: 'Extras', type: 'multiple', required: false, maxSelect: 2, options: [{ name: 'Queso' }] });
    assert.equal(describeModifierGroupRule(extras), 'Opcional · máx. 2');
    assert.equal(normalizeModifierGroup({ name: 'X', type: 'single', maxSelect: 3, options: [{ name: 'a' }] }).maxSelect, null);
});

test('stockUsage: limpia vacíos y une repetidos', () => {
    assert.deepEqual(normalizeStockUsage([{ itemId: 'b', qty: 1 }, { itemId: 'b', qty: '1' }, { itemId: '', qty: 3 }, { itemId: 'h', qty: 0 }]), [{ itemId: 'b', qty: 2 }]);
});

const branchItems = normalizeInventoryItems([
    { id: 'inv_burrito', branchId: 'uni', name: 'Burrito Base', unitCost: 20, consumers: [
        { type: 'product', productId: 'burrito', qty: 1 },
        { type: 'product', productId: 'promo', qty: 2 },
        { type: 'product', productId: 'combo', qty: 1 },
        { type: 'option', groupId: 'g', optionId: 'extra', qty: 1 },
        { type: 'product', productId: 'refresco', qty: 0 }
    ] },
    { id: 'inv_burger', branchId: 'uni', name: 'Hamburguesa', consumers: [{ type: 'product', productId: 'combo', qty: 1 }] }
]);
const menu = [
    { id: 'burrito', name: '1 Burrito', price: 40 },
    { id: 'promo', name: '2 Burritos', price: 70 },
    { id: 'combo', name: 'Combo', price: 120 },
    { id: 'refresco', name: 'Refresco', price: 25 }
];

test('consumo desde el artículo: 1 burrito + 1 promo de 2 = 3 (ejemplo del usuario)', () => {
    const consumption = computeStockConsumption([{ productId: 'burrito', qty: 1 }, { productId: 'promo', qty: 1 }, { productId: 'refresco', qty: 4 }], branchItems);
    assert.deepEqual(consumption, [{ itemId: 'inv_burrito', qty: 3 }]);
});

test('consumo: cantidad multiplica, combos y opciones de modificador', () => {
    const consumption = computeStockConsumption([{ productId: 'combo', qty: 2, selectedModifiers: [{ groupId: 'g', optionId: 'extra' }] }], branchItems)
        .sort((a, b) => a.itemId.localeCompare(b.itemId));
    assert.deepEqual(consumption, [{ itemId: 'inv_burger', qty: 2 }, { itemId: 'inv_burrito', qty: 4 }]);
});

test('el inventario es por sucursal: otra sucursal no descuenta', () => {
    assert.deepEqual(computeStockConsumption([{ productId: 'burrito', qty: 1 }], []), []);
    assert.deepEqual(getProductUsage('promo', branchItems), [{ itemId: 'inv_burrito', qty: 2 }]);
});

test('costo del producto y aviso si falta costo', () => {
    assert.deepEqual(computeProductUnitCost('promo', branchItems), { cost: 40, complete: true });
    assert.equal(computeProductUnitCost('combo', branchItems).complete, false);
    assert.equal(computeProductUnitCost('refresco', branchItems), null);
});

test('precio medio por pieza: media simple sin historial', () => {
    const items = normalizeInventoryItems([{ id: 'b', branchId: 'uni', name: 'Burrito', consumers: [{ productId: 'burrito', qty: 1 }, { productId: 'promo', qty: 2 }] }]);
    const result = computeItemUnitPrice(items[0], menu, items);
    assert.equal(result.basis, 'menu');
    assert.equal(result.unitPrice, 37.5); // (40 + 35) / 2
});

test('precio medio por pieza: ponderado por lo que realmente se vendió', () => {
    const items = normalizeInventoryItems([{ id: 'b', branchId: 'uni', name: 'Burrito', consumers: [{ productId: 'burrito', qty: 1 }, { productId: 'promo', qty: 2 }] }]);
    const txs = [
        { type: 'income', branchId: 'uni', itemsSoldArray: [{ productId: 'promo', qty: 3, total: 210 }] },
        { type: 'income', branchId: 'uni', itemsSoldArray: [{ productId: 'burrito', qty: 2, total: 80 }] },
        { type: 'income', branchId: 'otra', itemsSoldArray: [{ productId: 'burrito', qty: 50, total: 2000 }] }
    ];
    const result = computeItemUnitPrice(items[0], menu, items, { transactions: txs, branchId: 'uni' });
    assert.equal(result.basis, 'history');
    assert.equal(result.unitsSold, 8);
    assert.equal(result.unitPrice, 36.25); // (210 + 80) / 8
});

test('precio medio en combos reparte el precio entre artículos', () => {
    const result = computeItemUnitPrice(branchItems.find(i => i.id === 'inv_burger'), menu, branchItems);
    assert.equal(result.unitPrice, 60); // combo $120 consume 1 burrito + 1 hamburguesa
});

test('migración del esquema anterior arma los consumers desde productos y opciones', () => {
    const legacyItems = [{ id: 'old', name: 'Burrito' }, { id: 'ya', name: 'X', branchId: 'presa' }];
    const products = [{ id: 'burrito', stockUsage: [{ itemId: 'old', qty: 1 }] }, { id: 'promo', stockUsage: [{ itemId: 'old', qty: 2 }] }];
    const groups = [{ id: 'g', options: [{ id: 'extra', stockUsage: [{ itemId: 'old', qty: 1 }] }] }];
    const migrated = planLegacyInventoryMigration(legacyItems, products, groups, 'uni');
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].branchId, 'uni');
    assert.equal(migrated[0].consumers.length, 3);
});
