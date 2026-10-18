import { formatMoney, getLocalDateInputValue } from '../core/date-utils.js';
import { getCustomBranches, getStableBranchColor } from '../services/branches-service.js';

let charts = { main: null, category: null };

const CHART_COLORS = {
    income: '#10b981',
    expense: '#ef4444',
    grid: 'rgba(148, 163, 184, 0.12)',
    text: '#9aa6b8',
    empty: '#24324d'
};

const moneyTooltip = {
    callbacks: {
        label: (context) => ` ${context.dataset.label || context.label}: ${formatMoney(context.parsed.y ?? context.parsed)}`
    }
};

export function initCharts() {
    const mainChartEl = document.getElementById('mainChart');
    const catChartEl = document.getElementById('categoryChart');
    if (!mainChartEl || !catChartEl || typeof Chart === 'undefined') return;

    Chart.defaults.color = CHART_COLORS.text;
    Chart.defaults.font.family = 'Inter';
    Chart.defaults.plugins.tooltip.backgroundColor = '#0b1220';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(148, 163, 184, 0.25)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;

    if (charts.main) charts.main.destroy();
    if (charts.category) charts.category.destroy();

    charts.main = new Chart(mainChartEl.getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: CHART_COLORS.grid },
                    border: { display: false },
                    ticks: { callback: (value) => `$${Number(value).toLocaleString('es-MX')}` }
                },
                x: { grid: { display: false }, border: { display: false } }
            },
            plugins: {
                legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8 } },
                tooltip: moneyTooltip
            }
        }
    });

    charts.category = new Chart(catChartEl.getContext('2d'), {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                // La leyenda se muestra en la lista de sucursales debajo de la gráfica
                legend: { display: false },
                tooltip: { callbacks: { label: (context) => ` ${context.label}: ${formatMoney(context.parsed)}` } }
            },
            cutout: '72%'
        }
    });
}

function belongsToBranch(transaction, branch) {
    return transaction.branchId === branch.id || transaction.branch === branch.id || transaction.zone === branch.name;
}

export function updateCharts(data) {
    if (!charts.main || !charts.category) {
        initCharts();
    }
    if (!charts.main || !charts.category) return;

    // Agrupa por día local (YYYY-MM-DD) para ordenar cronológicamente aunque cambie el mes
    const groupedByDay = {};
    (data || []).forEach(t => {
        const date = t.date ? new Date(t.date) : null;
        if (!date || isNaN(date.getTime())) return;
        const key = getLocalDateInputValue(date);
        if (!groupedByDay[key]) groupedByDay[key] = { inc: 0, exp: 0 };
        if (t.type === 'income') groupedByDay[key].inc += (Number(t.amount) || 0);
        else groupedByDay[key].exp += (Number(t.amount) || 0);
    });

    const keys = Object.keys(groupedByDay).sort();
    const labels = keys.map(key => {
        const [, month, day] = key.split('-');
        return `${day}/${month}`;
    });

    charts.main.data = {
        labels,
        datasets: [
            { label: 'Ventas', data: keys.map(key => groupedByDay[key].inc), backgroundColor: CHART_COLORS.income, borderRadius: 6, maxBarThickness: 36 },
            { label: 'Gastos', data: keys.map(key => groupedByDay[key].exp), backgroundColor: CHART_COLORS.expense, borderRadius: 6, maxBarThickness: 36 }
        ]
    };
    charts.main.update();

    const branchBreakdown = getCustomBranches()
        .map(branch => ({
            name: branch.name,
            color: getStableBranchColor(branch),
            total: (data || [])
                .filter(item => item.type === 'income' && belongsToBranch(item, branch))
                .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
        }))
        .filter(item => item.total > 0);

    const statsContainer = document.getElementById('balance-stats-container');
    if (statsContainer) statsContainer.innerHTML = '';

    if (branchBreakdown.length === 0) {
        charts.category.data = { labels: ['Sin ventas'], datasets: [{ data: [1], backgroundColor: [CHART_COLORS.empty], borderWidth: 0 }] };
        charts.category.options.plugins.tooltip.enabled = false;
    } else {
        charts.category.data = {
            labels: branchBreakdown.map(item => item.name),
            datasets: [{
                data: branchBreakdown.map(item => item.total),
                backgroundColor: branchBreakdown.map(item => item.color),
                borderWidth: 0,
                hoverOffset: 6
            }]
        };
        charts.category.options.plugins.tooltip.enabled = true;
    }
    charts.category.update();
}
