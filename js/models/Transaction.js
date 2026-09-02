export class IncomeTransaction {
    constructor({
        id = `tx_${Date.now()}`,
        amount = 0,
        desc = 'Venta',
        category = 'Venta',
        branch = '',
        branchId = '',
        zone = '',
        tableName = null,
        source = 'sale',
        itemsSoldArray = [],
        date = new Date().toISOString(),
        createdAt = new Date().toISOString()
    } = {}) {
        this.id = id;
        this.type = 'income';
        this.amount = Number(amount) || 0;
        this.desc = desc;
        this.category = category;
        this.branch = branch || branchId;
        this.branchId = branchId || branch;
        this.zone = zone || branch || branchId;
        this.tableName = tableName;
        this.source = source;
        this.itemsSoldArray = itemsSoldArray;
        this.date = date;
        this.createdAt = createdAt;
    }
}

export class ExpenseTransaction {
    constructor({
        id = `tx_${Date.now()}`,
        amount = 0,
        desc = 'Gasto',
        category = 'Gastos (General)',
        zone = '',
        date = new Date().toISOString(),
        createdAt = new Date().toISOString()
    } = {}) {
        this.id = id;
        this.type = 'expense';
        this.amount = Number(amount) || 0;
        this.desc = desc;
        this.category = category;
        this.zone = zone;
        this.itemsSoldArray = [];
        this.date = date;
        this.createdAt = createdAt;
    }
}
