import { formatMoney } from '../core/date-utils.js';

export function formatExportDate(dateValue) {
    if (!dateValue) return 'Sin fecha';
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function buildExportSummary(data, filterLabel = 'Resumen', topSellerStats = []) {
    let ingresos = 0;
    let gastos = 0;

    (data || []).forEach(item => {
        if (item.type === 'income') ingresos += (Number(item.amount) || 0);
        else gastos += (Number(item.amount) || 0);
    });

    const recentRows = [...(data || [])]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 6)
        .map(item => `
            <tr>
                <td>${formatExportDate(item.date)}</td>
                <td>${item.type === 'income' ? 'Ingreso' : 'Gasto'}</td>
                <td>${item.desc || 'Sin descripcion'}</td>
                <td style="text-align:right; color:${item.type === 'income' ? '#047857' : '#b91c1c'}; font-weight:700;">
                    ${item.type === 'income' ? '+' : '-'}${formatMoney(item.amount)}
                </td>
            </tr>
        `)
        .join('');

    const topSellerRows = (topSellerStats || [])
        .slice(0, 6)
        .map(([, stats]) => `
            <tr>
                <td>${stats.label}</td>
                <td style="text-align:right;">${stats.qty}</td>
                <td style="text-align:right; font-weight:700;">${formatMoney(stats.total)}</td>
            </tr>
        `)
        .join('');

    const wrapper = document.createElement('div');
    wrapper.className = 'export-summary-canvas';
    wrapper.innerHTML = `
        <div class="export-summary-sheet">
            <div class="export-summary-header">
                <div>
                    <div class="export-kicker">La Barra</div>
                    <h2>Resumen del negocio</h2>
                    <p>${filterLabel}</p>
                </div>
                <div class="export-stamp">
                    <span>Generado</span>
                    <strong>${new Date().toLocaleDateString('es-MX')}</strong>
                </div>
            </div>
            <div class="export-summary-grid">
                <div class="export-stat income">
                    <span>Ventas</span>
                    <strong>${formatMoney(ingresos)}</strong>
                </div>
                <div class="export-stat expense">
                    <span>Gastos</span>
                    <strong>${formatMoney(gastos)}</strong>
                </div>
                <div class="export-stat profit">
                    <span>Ganancia neta</span>
                    <strong>${formatMoney(ingresos - gastos)}</strong>
                </div>
            </div>
            <div class="export-columns">
                <section class="export-panel">
                    <h3>Movimientos recientes</h3>
                    <table class="export-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Descripcion</th>
                                <th style="text-align:right;">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentRows || '<tr><td colspan="4" style="text-align:center; color:#64748b;">Sin movimientos en este periodo</td></tr>'}
                        </tbody>
                    </table>
                </section>
                <section class="export-panel">
                    <h3>Productos vendidos</h3>
                    <table class="export-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th style="text-align:right;">Cantidad</th>
                                <th style="text-align:right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topSellerRows || '<tr><td colspan="3" style="text-align:center; color:#64748b;">Sin productos vendidos</td></tr>'}
                        </tbody>
                    </table>
                </section>
            </div>
        </div>
    `;

    return wrapper;
}

export function downloadCSV(data, filterName = 'periodo', notify) {
    if (!data || data.length === 0) {
        if (typeof notify === 'function') notify("No hay datos en este periodo para exportar");
        return;
    }

    let csvContent = "\uFEFFFecha,Tipo,Monto,Categoria,Zona,Descripcion\n";

    data.forEach(t => {
        let type = t.type === 'income' ? 'Ingreso' : 'Gasto';
        let date = "Desconocida";
        try { if (t.date) date = new Date(t.date).toLocaleDateString('es-ES'); } catch (e) { }

        let desc = '"' + (t.desc || '').replace(/"/g, '""') + '"';
        let cat = '"' + (t.category || '').replace(/"/g, '""') + '"';
        let zone = '"' + (t.zone || '').replace(/"/g, '""') + '"';

        csvContent += `${date},${type},${t.amount},${cat},${zone},${desc}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `Respaldo_${filterName}_${dStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof notify === 'function') notify("Respaldo descargado");
}

export function downloadImageSummary(data, filterLabel = 'Resumen', filterName = 'periodo', topSellerStats = [], notify) {
    if (typeof html2canvas === 'undefined') {
        if (typeof notify === 'function') notify("Librería de captura no disponible");
        return;
    }
    const summaryNode = buildExportSummary(data, filterLabel, topSellerStats);
    if (typeof notify === 'function') notify("Generando captura... por favor espera");
    setTimeout(async () => {
        try {
            document.body.appendChild(summaryNode);
            const canvas = await html2canvas(summaryNode, {
                backgroundColor: '#f8fafc',
                scale: 2,
                useCORS: true
            });
            summaryNode.remove();
            const link = document.createElement('a');
            const dStr = new Date().toISOString().slice(0, 10);
            link.download = `Resumen_Barra_${filterName}_${dStr}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            if (typeof notify === 'function') notify("Resumen visual descargado");
        } catch (e) {
            summaryNode.remove();
            console.error(e);
            if (typeof notify === 'function') notify("Error al generar la imagen");
        }
    }, 600);
}
