import { formatMoney } from '../core/date-utils.js';
import { getCustomBranches, getStableBranchColor } from '../services/branches-service.js';

let charts = { main: null, category: null };

export function initCharts() {
    const mainChartEl = document.getElementById('mainChart');
    const catChartEl = document.getElementById('categoryChart');
    if (!mainChartEl || !catChartEl || typeof Chart === 'undefined') return;

    const ctxMain = mainChartEl.getContext('2d');
    const ctxCat = catChartEl.getContext('2d');

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    if (charts.main) charts.main.destroy();
    if (charts.category) charts.category.destroy();

    charts.main = new Chart(ctxMain, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { position: 'top' } }
        }
    });

    charts.category = new Chart(ctxCat, {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } },
            cutout: '75%'
        }
    });
}

export function updateCharts(data) {
    if (!charts.main || !charts.category) {
        initCharts();
    }
    if (!charts.main || !charts.category) return;

    const groupedByDay = {};
    (data || []).forEach(t => {
        let day = "N/A";
        try {
            if (t.date) {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    day = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
                }
            }
        } catch (e) { }

        if (!groupedByDay[day]) groupedByDay[day] = { inc: 0, exp: 0 };
        if (t.type === 'income') groupedByDay[day].inc += (Number(t.amount) || 0);
        else groupedByDay[day].exp += (Number(t.amount) || 0);
    });

    const labels = Object.keys(groupedByDay).sort();
    const incomes = labels.map(l => groupedByDay[l].inc);
    const expenses = labels.map(l => groupedByDay[l].exp);

    charts.main.data = {
        labels,
        datasets: [
            { label: 'Ingresos', data: incomes, backgroundColor: '#10b981', borderRadius: 4 },
            { label: 'Gastos', data: expenses, backgroundColor: '#ef4444', borderRadius: 4 }
        ]
    };
    charts.main.update();

    const totalInc = (data || []).filter(t => t.type === 'income').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalExp = (data || []).filter(t => t.type === 'expense').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const customBranches = getCustomBranches();

    const branchBreakdown = customBranches
        .map(branch => ({
            name: branch.name,
            color: getStableBranchColor(branch),
            total: (data || [])
                .filter(item => item.type === 'income' && item.zone === branch.name)
                .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
        }))
        .filter(item => item.total > 0);

    const statsContainer = document.getElementById('balance-stats-container');

    if (branchBreakdown.length === 0) {
        charts.category.data = { labels: ['Sin datos'], datasets: [{ data: [1], backgroundColor: ['#334155'], borderWidth: 0 }] };
        if (statsContainer) statsContainer.innerHTML = '';
    } else {
        charts.category.data = {
            labels: branchBreakdown.map(item => item.name),
            datasets: [{
                data: branchBreakdown.map(item => item.total),
                backgroundColor: branchBreakdown.map(item => item.color),
                borderWidth: 0
            }]
        };

        const diff = totalInc - totalExp;
        const diffText = diff >= 0 ? 'Ganancia Neta' : 'Pérdida';
        const diffClass = diff >= 0 ? 'profit' : 'loss';

        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="balance-stats">
                    <div class="balance-stat-item income">
                        <span class="label">Ventas Totales</span>
                        <span class="value">${formatMoney(totalInc)}</span>
                        <span style="font-size:0.8rem">${branchBreakdown.length} sucursales con ventas</span>
                    </div>
                    <div class="balance-stat-item expense">
                        <span class="label">Gastos</span>
                        <span class="value">${formatMoney(totalExp)}</span>
                        <span style="font-size:0.8rem">Total del periodo</span>
                    </div>
                </div>
                <div class="balance-result ${diffClass}">
                    ${diffText}: ${formatMoney(Math.abs(diff))}
                </div>
            `;
        }
    }
    charts.category.update();
}
