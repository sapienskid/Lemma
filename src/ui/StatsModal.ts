import { App, Modal, setIcon } from 'obsidian';
import { Chart, registerables } from 'chart.js';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class StatsModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private chartInstances: Chart[] = [];

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Statistics');
        this.containerEl.addClass('fsrs-stats-modal');
        this.containerEl.addClass('fsrs-stats-modal-scroll');
        Chart.register(...registerables);

        const stats = this.plugin.dataManager.getDetailedStats();

        this.renderHeader(stats);
        this.renderRetentionCurve(stats);
        this.renderChartsRow(stats);
        this.renderHeatmap(stats);
        this.renderIntervalHistogram(stats);
        this.renderPerDeckChart(stats);
        this.renderActivityForecast(stats);
    }

    private renderHeader(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        const headerSection = this.contentEl.createDiv({ cls: 'fsrs-stats-header' });

        const createCard = (icon: string, value: string, label: string, variant: string) => {
            const card = headerSection.createDiv({ cls: `fsrs-stat-header-card fsrs-stat-${variant}` });
            const iconEl = card.createDiv({ cls: 'fsrs-stat-header-icon' });
            setIcon(iconEl, icon);
            card.createEl('div', { text: value, cls: 'fsrs-stat-header-value' });
            card.createEl('div', { text: label, cls: 'fsrs-stat-header-label' });
        };

        createCard('check-circle', stats.reviewsToday.toString(), 'Reviews today', 'success');
        createCard('calendar', stats.forecast.reduce((a: number, b: number) => a + b, 0).toString(), 'Due this week', 'warning');
        createCard('trending-up', stats.maturity.mature.toString(), 'Mature cards', 'info');
        createCard('award', (stats.maturity.mature + stats.maturity.young).toString(), 'Total learned', 'neutral');
    }

    private renderRetentionCurve(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        if (stats.retentionCurve.length < 2) return;

        const card = this.contentEl.createDiv({ cls: 'fsrs-chart-card' });
        const header = card.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(header.createDiv({ cls: 'fsrs-chart-icon' }), 'trending-up');
        header.createEl('h3', { text: 'Retention rate' });

        const wrapper = card.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const canvas = wrapper.createEl('canvas');

        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: stats.retentionCurve.map(r => r.date.slice(5)),
                datasets: [
                    {
                        label: 'Predicted',
                        data: stats.retentionCurve.map(r => r.predicted),
                        borderColor: 'var(--interactive-accent)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0.3,
                    },
                    {
                        label: 'Actual',
                        data: stats.retentionCurve.map(r => r.actual),
                        borderColor: 'var(--color-green)',
                        backgroundColor: 'rgba(var(--color-green-rgb), 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0,
                        max: 1,
                        ticks: { callback: (v) => `${Math.round(Number(v) * 100)}%` },
                        grid: { color: 'var(--background-modifier-border)' },
                    },
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
                },
            },
        });
        this.chartInstances.push(chart);
    }

    private renderChartsRow(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        const row = this.contentEl.createDiv({ cls: 'fsrs-charts-row' });

        // Maturity donut
        const donutCard = row.createDiv({ cls: 'fsrs-chart-card fsrs-chart-card-half' });
        const donutHeader = donutCard.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(donutHeader.createDiv({ cls: 'fsrs-chart-icon' }), 'pie-chart');
        donutHeader.createEl('h3', { text: 'Card maturity' });

        const donutWrapper = donutCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const donutCanvas = donutWrapper.createEl('canvas');
        const m = stats.maturity;
        const maturityColors = ['--color-red', '--color-orange', '--interactive-accent', '--color-green'];
        const maturityLabels = ['New', 'Learning', 'Young', 'Mature'];
        const maturityData = [m.new, m.learning, m.young, m.mature];

        const donutChart = new Chart(donutCanvas, {
            type: 'doughnut',
            data: {
                labels: maturityLabels,
                datasets: [{
                    data: maturityData,
                    backgroundColor: maturityColors.map(c => `var(${c})`),
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 8, font: { size: 11 } },
                    },
                },
            },
        });
        this.chartInstances.push(donutChart);

        // Interval distribution
        if (stats.intervalBuckets.length > 0) {
            const intervalCard = row.createDiv({ cls: 'fsrs-chart-card fsrs-chart-card-half' });
            const intervalHeader = intervalCard.createDiv({ cls: 'fsrs-chart-header' });
            setIcon(intervalHeader.createDiv({ cls: 'fsrs-chart-icon' }), 'clock');
            intervalHeader.createEl('h3', { text: 'Review intervals' });

            const intervalWrapper = intervalCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
            const intervalCanvas = intervalWrapper.createEl('canvas');

            const intervalChart = new Chart(intervalCanvas, {
                type: 'bar',
                data: {
                    labels: stats.intervalBuckets.map(b => b.label),
                    datasets: [{
                        label: 'Reviews',
                        data: stats.intervalBuckets.map(b => b.count),
                        backgroundColor: 'var(--interactive-accent)',
                        borderRadius: 3,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    scales: {
                        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                        y: { grid: { display: false } },
                    },
                    plugins: { legend: { display: false } },
                },
            });
            this.chartInstances.push(intervalChart);
        }
    }

    private renderHeatmap(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        const card = this.contentEl.createDiv({ cls: 'fsrs-chart-card' });
        const header = card.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(header.createDiv({ cls: 'fsrs-chart-icon' }), 'calendar');
        header.createEl('h3', { text: '12-month activity' });

        const heatmapEl = card.createDiv({ cls: 'fsrs-heatmap' });

        // Group by week
        const weeks: { date: string; count: number }[][] = [];
        let currentWeek: { date: string; count: number }[] = [];

        for (const day of stats.heatmapData) {
            const d = new Date(day.date);
            const dayOfWeek = d.getDay();
            if (dayOfWeek === 0 && currentWeek.length > 0) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
            currentWeek.push(day);
        }
        if (currentWeek.length > 0) weeks.push(currentWeek);

        const maxCount = Math.max(...stats.heatmapData.map(d => d.count), 1);

        for (const week of weeks) {
            const weekRow = heatmapEl.createDiv({ cls: 'fsrs-heatmap-week' });
            for (const day of week) {
                const intensity = day.count > 0 ? Math.min(Math.ceil((day.count / maxCount) * 4), 4) : 0;
                weekRow.createEl('div', {
                    cls: `fsrs-heatmap-cell fsrs-heatmap-l${intensity}`,
                    attr: { title: `${day.date}: ${day.count} reviews` },
                });
            }
        }
    }

    private renderIntervalHistogram(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        // Rendered in renderChartsRow as half-width
    }

    private renderPerDeckChart(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        if (stats.perDeckStats.length === 0) return;

        const MAX_VISIBLE_DECKS = 15;
        const sorted = [...stats.perDeckStats].sort((a, b) => (b.new + b.due + b.learning) - (a.new + a.due + a.learning));
        const visible = sorted.slice(0, MAX_VISIBLE_DECKS);

        let labels: string[];
        let newData: number[];
        let dueData: number[];
        let learningData: number[];

        if (sorted.length <= MAX_VISIBLE_DECKS) {
            labels = visible.map(d => d.name.length > 20 ? d.name.slice(0, 20) + '…' : d.name);
            newData = visible.map(d => d.new);
            dueData = visible.map(d => d.due);
            learningData = visible.map(d => d.learning);
        } else {
            const rest = sorted.slice(MAX_VISIBLE_DECKS);
            labels = [
                ...visible.map(d => d.name.length > 20 ? d.name.slice(0, 20) + '…' : d.name),
                `Other (${rest.length})`,
            ];
            newData = [...visible.map(d => d.new), rest.reduce((s, d) => s + d.new, 0)];
            dueData = [...visible.map(d => d.due), rest.reduce((s, d) => s + d.due, 0)];
            learningData = [...visible.map(d => d.learning), rest.reduce((s, d) => s + d.learning, 0)];
        }

        const card = this.contentEl.createDiv({ cls: 'fsrs-chart-card' });
        const header = card.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(header.createDiv({ cls: 'fsrs-chart-icon' }), 'layers');
        header.createEl('h3', { text: `Per-deck breakdown (${stats.perDeckStats.length} decks)` });

        const wrapper = card.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const canvas = wrapper.createEl('canvas');

        const chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'New', data: newData, backgroundColor: 'var(--color-red)', borderRadius: 2 },
                    { label: 'Learning', data: learningData, backgroundColor: 'var(--color-orange)', borderRadius: 2 },
                    { label: 'Due', data: dueData, backgroundColor: 'var(--interactive-accent)', borderRadius: 2 },
                ],
            },
            options: {
                indexAxis: labels.length > 8 ? 'y' : 'x',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                    y: { stacked: true, grid: { display: false } },
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
                },
            },
        });
        this.chartInstances.push(chart);
    }

    private renderActivityForecast(stats: ReturnType<FSRSFlashcardsPlugin['dataManager']['getDetailedStats']>) {
        const chartsSection = this.contentEl.createDiv({ cls: 'fsrs-charts-row' });

        // Activity
        const activityCard = chartsSection.createDiv({ cls: 'fsrs-chart-card fsrs-chart-card-half' });
        const activityHeader = activityCard.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(activityHeader.createDiv({ cls: 'fsrs-chart-icon' }), 'activity');
        activityHeader.createEl('h3', { text: '30-day activity' });

        const activityWrapper = activityCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const activityCanvas = activityWrapper.createEl('canvas');
        const activityLabels = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (29 - i));
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });

        const activityChart = new Chart(activityCanvas, {
            type: 'line',
            data: {
                labels: activityLabels,
                datasets: [{
                    label: 'Reviews',
                    data: stats.activity,
                    borderColor: 'var(--interactive-accent)',
                    backgroundColor: 'rgba(var(--interactive-accent-rgb), 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
                },
                plugins: { legend: { display: false } },
            },
        });
        this.chartInstances.push(activityChart);

        // Forecast
        const forecastCard = chartsSection.createDiv({ cls: 'fsrs-chart-card fsrs-chart-card-half' });
        const forecastHeader = forecastCard.createDiv({ cls: 'fsrs-chart-header' });
        setIcon(forecastHeader.createDiv({ cls: 'fsrs-chart-icon' }), 'calendar');
        forecastHeader.createEl('h3', { text: '7-day forecast' });

        const forecastWrapper = forecastCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const forecastCanvas = forecastWrapper.createEl('canvas');
        const forecastLabels = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() + i);
            return d.toLocaleDateString(undefined, { weekday: 'short' });
        });

        const forecastChart = new Chart(forecastCanvas, {
            type: 'bar',
            data: {
                labels: forecastLabels,
                datasets: [{
                    label: 'Due',
                    data: stats.forecast,
                    backgroundColor: 'var(--color-orange)',
                    borderRadius: 4,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                    x: { grid: { display: false } },
                },
                plugins: { legend: { display: false } },
            },
        });
        this.chartInstances.push(forecastChart);
    }

    onClose() {
        this.chartInstances.forEach(chart => chart.destroy());
        this.contentEl.empty();
    }
}
