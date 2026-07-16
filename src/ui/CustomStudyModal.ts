import { App, Modal, Notice, Setting } from 'obsidian';
import { isRecord, toStringArray } from '../data/constants';
import type { Card } from '../data/types';
import { ReviewModal } from './ReviewModal';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class CustomStudyModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private tags: string = '';
    private state: 'new' | 'due' | 'learning' | 'all' = 'due';
    private limit: number = 50;
    private unlimited: boolean = false;

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Custom study session');
        new Setting(this.contentEl).setName('Filter by tags').setDesc('Comma-separated, e.g., #calculus, #chapter1').addText(text => text.setValue(this.tags).onChange(val => this.tags = val));
        new Setting(this.contentEl).setName('Filter by card state').addDropdown((dropdown) => dropdown
            .addOption('due', 'Due')
            .addOption('new', 'New')
            .addOption('learning', 'Learning')
            .addOption('all', 'All cards (cram mode)')
            .setValue(this.state)
            .onChange((value) => {
                if (value === 'due' || value === 'new' || value === 'learning' || value === 'all') {
                    this.state = value;
                }
            }));
        new Setting(this.contentEl).setName('Card limit').setDesc('Set to 0 or enable unlimited for no limit').addText(text => text.setValue(this.limit.toString()).onChange(val => this.limit = parseInt(val) || 0));
        new Setting(this.contentEl).setName('Unlimited cards').setDesc('Ignore card limit - study all matching cards (for exam prep)').addToggle(toggle => toggle.setValue(this.unlimited).onChange(val => this.unlimited = val));
        new Setting(this.contentEl).addButton(btn => btn.setButtonText('Start studying').setCta().onClick(() => this.startSession()));
    }

    startSession() {
        const now = new Date();
        const allCards = this.plugin.dataManager.getAllCards();
        const requiredTags = this.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        let queue = allCards.filter((card: Card) => {
            const data = card.fsrsData;
            if (this.state !== 'all') {
                const cardState = !data ? 'new' : data.due <= now ? 'due' : 'learning';
                if (this.state !== cardState) return false;
            }
            if (requiredTags.length > 0) {
                const fileCache = this.app.metadataCache.getCache(card.filePath);
                const inlineTags = (fileCache?.tags ?? []).map((tag) => tag.tag.toLowerCase());
                const frontmatter = isRecord(fileCache?.frontmatter) ? fileCache.frontmatter : null;
                const frontmatterTags = frontmatter
                    ? toStringArray(frontmatter.tags).map((tag) => `#${tag.toLowerCase()}`)
                    : [];
                const fileTags = inlineTags.concat(frontmatterTags);
                return requiredTags.every(reqTag => fileTags.includes(reqTag));
            }
            return true;
        });

        if (!this.unlimited && this.limit > 0) {
            queue = queue.slice(0, this.limit);
        }

        if (queue.length === 0) { new Notice('No cards found matching your criteria.'); return; }
        this.close();
        new ReviewModal(this.app, this.plugin, queue).open();
    }
}
