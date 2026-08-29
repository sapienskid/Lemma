import { App, Modal, Notice, Setting } from 'obsidian';
import { buildSequences, computeLossForWeights, optimize, type OptimizerResult } from '../data/FsrsOptimizer';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class OptimizerModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private result: OptimizerResult | null = null;
    private isRunning = false;
    private currentWeights: readonly number[];

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
        this.currentWeights = plugin.settings.fsrsParams.w;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('FSRS weight optimizer');
        this.containerEl.addClass('fsrs-optimizer-modal');

        const reviewHistory = this.plugin.dataManager.getReviewHistory();
        const sequences = buildSequences(reviewHistory);
        const totalReviews = reviewHistory.length;
        const cardsWithHistory = sequences.length;
        const avgReviewsPerCard = cardsWithHistory > 0
            ? (totalReviews / cardsWithHistory).toFixed(1)
            : '0';

        const overviewEl = this.contentEl.createDiv({ cls: 'fsrs-optimizer-overview' });
        overviewEl.createEl('p', {
            text: `Dataset: ${totalReviews} reviews across ${cardsWithHistory} cards (avg ${avgReviewsPerCard}/card)`,
        });
        overviewEl.createEl('p', {
            text: cardsWithHistory < 5
                ? 'Need at least 5 cards with review history to optimize.'
                : 'The optimizer will tune the 19 FSRS weights to match your memory patterns. This may take a few seconds.',
            cls: cardsWithHistory < 5 ? 'mod-warning' : '',
        });

        const weightsContainer = this.contentEl.createDiv({ cls: 'fsrs-optimizer-weights' });
        weightsContainer.createEl('h4', { text: 'Current weights' });
        this.renderWeightTable(weightsContainer, this.currentWeights);

        const resultContainer = this.contentEl.createDiv({ cls: 'fsrs-optimizer-result' });
        resultContainer.hide();

        const statusEl = this.contentEl.createDiv({ cls: 'fsrs-optimizer-status' });

        const actionsEl = this.contentEl.createDiv({ cls: 'fsrs-optimizer-actions' });

        new Setting(actionsEl)
            .addButton(btn => btn
                .setButtonText('Run optimization')
                .setCta()
                .setDisabled(cardsWithHistory < 5 || this.isRunning)
                .onClick(() => this.runOptimization(sequences, resultContainer, statusEl, weightsContainer)))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    private renderWeightTable(container: HTMLElement, weights: readonly number[]) {
        const table = container.createEl('table', { cls: 'fsrs-optimizer-table' });
        const headerRow = table.createEl('tr');
        headerRow.createEl('th', { text: 'Index' });
        headerRow.createEl('th', { text: 'Value' });

        for (let i = 0; i < weights.length; i++) {
            const row = table.createEl('tr');
            row.createEl('td', { text: `w[${i}]` });
            row.createEl('td', { text: weights[i].toFixed(4) });
        }
    }

    private async runOptimization(
        sequences: ReturnType<typeof buildSequences>,
        resultContainer: HTMLElement,
        statusEl: HTMLElement,
        weightsContainer: HTMLElement,
    ) {
        this.isRunning = true;
        statusEl.setText('Running optimization...');
        statusEl.addClass('fsrs-optimizer-status-running');

        const { request_retention, maximum_interval } = this.plugin.settings.fsrsParams;

        await new Promise(resolve => window.setTimeout(resolve, 50));

        try {
            const onProgress = (r: OptimizerResult) => {
                statusEl.setText(`Epoch ${r.epoch}/30 — loss: ${r.loss.toFixed(4)}`);
            };

            this.result = optimize(sequences, this.currentWeights, request_retention, maximum_interval, {
                populationSize: 20,
                generations: 30,
                mutationRate: 0.8,
                gamma: 0.01,
                onProgress,
            });

            this.showResults(resultContainer, statusEl);
        } catch (error) {
            statusEl.setText(`Optimization failed: ${error}`);
            statusEl.removeClass('fsrs-optimizer-status-running');
            statusEl.addClass('mod-warning');
        } finally {
            this.isRunning = false;
        }
    }

    private showResults(
        resultContainer: HTMLElement,
        statusEl: HTMLElement,
    ) {
        if (!this.result) return;

        statusEl.setText(`Done! Final loss: ${this.result.loss.toFixed(4)}`);
        statusEl.removeClass('fsrs-optimizer-status-running');

        resultContainer.empty();
        resultContainer.show();

        resultContainer.createEl('h4', { text: 'Optimized weights' });
        this.renderWeightTable(resultContainer, this.result.weights);

        // Compute current loss for comparison
        const reviewHistory = this.plugin.dataManager.getReviewHistory();
        const sequences = buildSequences(reviewHistory);
        const { request_retention, maximum_interval } = this.plugin.settings.fsrsParams;
        const currentLoss = sequences.length >= 5
            ? computeLossForWeights([...this.currentWeights], sequences, request_retention, maximum_interval, 0.01)
            : null;

        if (currentLoss !== null) {
            const comparisonContainer = resultContainer.createDiv({ cls: 'fsrs-optimizer-comparison' });
            comparisonContainer.createEl('h4', { text: 'Comparison' });
            comparisonContainer.createEl('p', {
                text: `Current weights loss: ${currentLoss.toFixed(4)} → Optimized: ${this.result.loss.toFixed(4)}`,
            });
            const improvement = ((currentLoss - this.result.loss) / currentLoss * 100).toFixed(1);
            comparisonContainer.createEl('p', {
                text: `Improvement: ${improvement}%`,
                cls: parseFloat(improvement) > 0 ? 'fsrs-optimizer-positive' : '',
            });
        }

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('Apply weights')
                .setCta()
                .onClick(async () => {
                    if (!this.result) return;
                    this.plugin.settings.fsrsParams.w = [...this.result.weights];
                    await this.plugin.saveSettings();
                    this.plugin.dataManager.updateFsrsParameters(this.plugin.settings.fsrsParams);
                    new Notice('Optimized FSRS weights applied!');
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Discard')
                .onClick(() => this.close()));
    }

    onClose() {
        this.contentEl.empty();
    }
}
