import { App, Modal, setIcon } from 'obsidian';
import { Chart, registerables } from 'chart.js';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class StatsModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private chartInstances: Array<Chart<'line' | 'bar', number[], string>> = [];

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Statistics');
        this.containerEl.addClass('fsrs-stats-modal');
        Chart.register(...registerables);

        const stats = this.plugin.dataManager.getStats();

        const headerSection = this.contentEl.createDiv({ cls: 'fsrs-stats-header' });

        const createHeaderCard = (icon: string, value: string, label: string, variant: string) => {
            const card = headerSection.createDiv({ cls: `fsrs-stat-header-card fsrs-stat-${variant}` });
            const iconEl = card.createDiv({ cls: 'fsrs-stat-header-icon' });
            setIcon(iconEl, icon);
            card.createEl('div', { text: value, cls: 'fsrs-stat-header-value' });
            card.createEl('div', { text: label, cls: 'fsrs-stat-header-label' });
        };

        createHeaderCard('check-circle', stats.reviewsToday.toString(), 'Reviews today', 'success');
        createHeaderCard('calendar', stats.forecast.reduce((a: number, b: number) => a + b, 0).toString(), 'Due this week', 'warning');
        createHeaderCard('trending-up', stats.maturity.mature.toString(), 'Mature cards', 'info');
        createHeaderCard('award', (stats.maturity.mature + stats.maturity.young).toString(), 'Total learned', 'neutral');

        const chartsSection = this.contentEl.createDiv({ cls: 'fsrs-stats-charts' });

        const activityCard = chartsSection.createDiv({ cls: 'fsrs-chart-card' });
        const activityHeader = activityCard.createDiv({ cls: 'fsrs-chart-header' });
        const activityIcon = activityHeader.createDiv({ cls: 'fsrs-chart-icon' });
        setIcon(activityIcon, 'activity');
        activityHeader.createEl('h3', { text: '30-day activity' });

        const activityCanvasWrapper = activityCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const activityCanvas = activityCanvasWrapper.createEl('canvas', { cls: 'fsrs-chart-canvas' });
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
                    x: { grid: { display: false } },
                },
                plugins: { legend: { display: false } },
            },
        });
        this.chartInstances.push(activityChart);

        const forecastCard = chartsSection.createDiv({ cls: 'fsrs-chart-card' });
        const forecastHeader = forecastCard.createDiv({ cls: 'fsrs-chart-header' });
        const forecastIcon = forecastHeader.createDiv({ cls: 'fsrs-chart-icon' });
        setIcon(forecastIcon, 'calendar');
        forecastHeader.createEl('h3', { text: '7-day forecast' });

        const forecastCanvasWrapper = forecastCard.createDiv({ cls: 'fsrs-chart-canvas-wrapper' });
        const forecastCanvas = forecastCanvasWrapper.createEl('canvas', { cls: 'fsrs-chart-canvas' });
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
