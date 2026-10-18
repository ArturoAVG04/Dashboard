// Calcula qué documentos cambiaron entre dos versiones de una lista (por id).
// - upserts: nuevos o con datos distintos ({ id, data })
// - deletes: ids que estaban antes y ya no están
// toData(item, index) define los campos que la app guarda en Firestore.
export function diffById(previous, next, toData) {
    const previousData = new Map();
    (previous || []).forEach((item, index) => {
        if (item?.id) previousData.set(item.id, JSON.stringify(toData(item, index)));
    });

    const nextIds = new Set();
    const upserts = [];
    (next || []).forEach((item, index) => {
        if (!item?.id || !item.name) return;
        nextIds.add(item.id);
        const data = toData(item, index);
        if (previousData.get(item.id) !== JSON.stringify(data)) {
            upserts.push({ id: item.id, data });
        }
    });

    const deletes = [...previousData.keys()].filter(id => !nextIds.has(id));
    return { upserts, deletes };
}
