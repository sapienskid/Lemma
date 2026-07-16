import { App, Modal, Notice, Setting } from 'obsidian';
import { State } from 'ts-fsrs';
import type { Card } from '../data/types';
import { getErrorMessage } from '../data/constants';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class ResetProgressModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private confirmText: string = '';

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Reset all card progress');

        const warningContainer = this.contentEl.createDiv({ cls: 'fsrs-reset-warning' });
        warningContainer.addClass('setting-item-heading');

        warningContainer.createEl('h3', {
            text: 'Warning: this action cannot be undone.',
            cls: 'mod-warning',
        });

        warningContainer.createEl('p', {
            text: 'This will permanently delete all your review history and card progress:',
        });

        const consequences = warningContainer.createEl('ul');
        consequences.createEl('li', { text: 'All cards will be reset to "new" status' });
        consequences.createEl('li', { text: 'All review history will be deleted' });
        consequences.createEl('li', { text: 'All FSRS scheduling data will be cleared' });
        consequences.createEl('li', { text: 'You will start from scratch with every card' });

        const statsContainer = this.contentEl.createDiv({ cls: 'fsrs-reset-stats' });

        const allCards = this.plugin.dataManager.getAllCards();
        const cardsWithProgress = allCards.filter((card: Card) => card.fsrsData && card.fsrsData.state !== State.New).length;

        statsContainer.createEl('h4', { text: 'Current data:' });
        const statsList = statsContainer.createEl('ul');
        statsList.createEl('li', { text: `Total cards: ${allCards.length}` });
        statsList.createEl('li', { text: `Cards with progress: ${cardsWithProgress}` });

        new Setting(this.contentEl)
            .setName('Type "delete" to confirm')
            .setDesc('This confirmation prevents accidental data loss')
            .addText(text => text
                .setPlaceholder('Delete')
                .onChange(val => this.confirmText = val));

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Delete all progress')
                .setWarning()
                .onClick(async () => {
                    if (this.confirmText.trim().toLowerCase() !== 'delete') {
                        new Notice('Type "delete" to confirm', 3000);
                        return;
                    }
                    await this.resetAllProgress();
                }));
    }

    private async resetAllProgress() {
        try {
            new Notice('Deleting all card progress...', 0);

            await this.plugin.dataManager.resetAllProgress();

            this.plugin.refreshDashboardView();

            this.close();
            new Notice('All card progress has been reset. All cards are now "new".', 5000);
        } catch (error) {
            console.error('Failed to reset progress:', error);
            new Notice(`Failed to reset: ${getErrorMessage(error)}`, 5000);
        }
    }
}
