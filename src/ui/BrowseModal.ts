import { App, Modal, ButtonComponent, Component, MarkdownRenderer } from 'obsidian';
import type { Card } from '../data/types';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class BrowseModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private cards: Card[];
    private deckName: string;
    private currentCardIndex = 0;

    private cardContainer: HTMLElement;
    private frontEl: HTMLElement;
    private backEl: HTMLElement;
    private answerContainer: HTMLElement;
    private prevButton: ButtonComponent;
    private nextButton: ButtonComponent;
    private renderComponent: Component = new Component();

    constructor(app: App, plugin: FSRSFlashcardsPlugin, cards: Card[], deckName?: string) {
        super(app);
        this.plugin = plugin;
        this.cards = cards;
        this.deckName = deckName || 'Unknown Deck';
    }

    onOpen() {
        this.renderComponent = new Component();
        this.containerEl.addClass('fsrs-review-modal-immersive');
        this.contentEl.empty();
        this.titleEl.setText(`Browsing: ${this.deckName}`);
        this.setupUI();
        void this.displayCurrentCard();
        this.scope.register([], 'keydown', (evt: KeyboardEvent) => this.handleKeyPress(evt));
    }

    private setupUI() {
        const container = this.contentEl.createDiv({ cls: 'fsrs-review-container' });
        container.addClass('fsrs-browse-container');

        const leftControl = container.createDiv();
        this.prevButton = new ButtonComponent(leftControl)
            .setIcon('arrow-left')
            .setTooltip('Previous card (left arrow)')
            .onClick(() => this.showPrevCard());

        const cardWrapper = container.createDiv();
        cardWrapper.addClass('fsrs-browse-card-wrapper');

        this.cardContainer = cardWrapper.createDiv({ cls: 'fsrs-review-card' });
        this.cardContainer.style.setProperty('font-size', `${this.plugin.settings.fontSize}px`);
        this.frontEl = this.cardContainer.createDiv({ cls: 'fsrs-card-front' });
        this.answerContainer = this.cardContainer.createDiv({ cls: 'fsrs-card-answer' });
        this.answerContainer.createEl('hr');
        this.backEl = this.answerContainer.createDiv({ cls: 'fsrs-card-back' });

        const rightControl = container.createDiv();
        this.nextButton = new ButtonComponent(rightControl)
            .setIcon('arrow-right')
            .setTooltip('Next card (right arrow)')
            .onClick(() => this.showNextCard());
    }

    private async displayCurrentCard() {
        const card = this.cards[this.currentCardIndex];
        this.titleEl.setText(`Browsing (${this.currentCardIndex + 1}/${this.cards.length})`);

        this.frontEl.empty();
        this.backEl.empty();
        await MarkdownRenderer.render(this.app, card.front, this.frontEl, card.filePath, this.renderComponent);
        await MarkdownRenderer.render(this.app, card.back, this.backEl, card.filePath, this.renderComponent);

        this.updateNavButtons();
    }

    private showPrevCard() {
        if (this.currentCardIndex > 0) {
            this.currentCardIndex--;
            void this.displayCurrentCard();
        }
    }

    private showNextCard() {
        if (this.currentCardIndex < this.cards.length - 1) {
            this.currentCardIndex++;
            void this.displayCurrentCard();
        }
    }

    private updateNavButtons() {
        this.prevButton.setDisabled(this.currentCardIndex === 0);
        this.nextButton.setDisabled(this.currentCardIndex === this.cards.length - 1);
    }

    private handleKeyPress(evt: KeyboardEvent) {
        evt.preventDefault();
        switch (evt.key) {
            case 'ArrowLeft':
                this.showPrevCard();
                break;
            case 'ArrowRight':
                this.showNextCard();
                break;
        }
    }

    onClose() {
        this.renderComponent.unload();
        this.contentEl.empty();
    }
}
