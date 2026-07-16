import { App, Modal, ButtonComponent, Component, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { Rating } from 'ts-fsrs';
import type { Card } from '../data/types';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class ReviewModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private queue: Card[];
    private deckName: string | null;
    private currentCardIndex = 0;
    private state: 'question' | 'answer' = 'question';
    private cardContainer: HTMLElement;
    private frontEl: HTMLElement;
    private backEl: HTMLElement;
    private answerContainer: HTMLElement;
    private controlsContainer: HTMLElement;
    private showAnswerButton: ButtonComponent;
    private renderComponent: Component = new Component();

    constructor(app: App, plugin: FSRSFlashcardsPlugin, queue: Card[], deckName?: string) {
        super(app);
        this.plugin = plugin;
        this.queue = queue;
        this.deckName = deckName || null;
    }

    onOpen() {
        this.renderComponent = new Component();
        this.containerEl.addClass('fsrs-review-modal-immersive');
        const deckPrefix = this.deckName ? this.deckName : 'Reviewing';
        this.titleEl.empty();
        this.titleEl.createSpan({ text: deckPrefix });
        this.titleEl.createSpan({ text: `${this.currentCardIndex + 1}/${this.queue.length}`, cls: 'fsrs-counter-badge' });
        this.setupUI();
        void this.showNextCard();
        this.scope.register([], 'keydown', (evt: KeyboardEvent) => this.handleKeyPress(evt));
    }

    onClose() {
        this.renderComponent.unload();
        this.contentEl.empty();
        this.plugin.refreshDashboardView();
    }

    private setupUI() {
        const card = this.getCurrentCard();
        this.modalEl.find('.modal-title').addEventListener('click', () => {
            const data = card.fsrsData;
            if (!data) { new Notice('This is a new card.'); return; }
            const info = `Stability: ${data.stability.toFixed(2)}\nDifficulty: ${data.difficulty.toFixed(2)}\nReps: ${data.reps}\nLapses: ${data.lapses}\nDue: ${data.due.toLocaleDateString()}`;
            new Notice(info, 10000);
        });
        this.modalEl.find('.modal-title').addClass('fsrs-card-info-title');

        const headerControls = this.modalEl.querySelector('.modal-header-controls');
        if (headerControls) {
            const editBtn = headerControls.createDiv({ cls: 'clickable-icon' });
            setIcon(editBtn, 'pencil');
            editBtn.setAttribute('aria-label', 'Edit this card');
            editBtn.addEventListener('click', () => {
                void this.app.workspace.openLinkText(card.filePath, card.filePath);
                this.close();
            });
            headerControls.prepend(editBtn);
        }

        const container = this.contentEl.createDiv({ cls: 'fsrs-review-container' });

        this.cardContainer = container.createDiv({ cls: 'fsrs-review-card' });
        this.cardContainer.style.setProperty('font-size', `${this.plugin.settings.fontSize}px`);

        this.frontEl = this.cardContainer.createDiv({ cls: 'fsrs-card-front' });
        this.answerContainer = this.cardContainer.createDiv({ cls: 'fsrs-card-answer' });
        this.answerContainer.hide();
        this.answerContainer.createEl('hr');
        this.backEl = this.answerContainer.createDiv({ cls: 'fsrs-card-back' });

        const bottomControlsContainer = container.createDiv({ cls: 'fsrs-bottom-controls' });

        this.showAnswerButton = new ButtonComponent(bottomControlsContainer)
            .setButtonText('Show answer')
            .setCta()
            .onClick(() => this.showAnswer());
        this.showAnswerButton.buttonEl.addClass('fsrs-show-answer-btn');

        this.controlsContainer = bottomControlsContainer.createDiv({ cls: 'fsrs-review-controls' });
        this.controlsContainer.hide();
    }

    private createControlButtons() {
        this.controlsContainer.empty();
        this.controlsContainer.show();
        const card = this.getCurrentCard();
        const intervals = this.plugin.dataManager.getNextReviewIntervals(card);

        const ratings: Array<{ text: string; rating: Exclude<Rating, Rating.Manual>; cls: string }> = [
            { text: 'Again', rating: Rating.Again, cls: 'fsrs-rating-again' },
            { text: 'Hard', rating: Rating.Hard, cls: 'fsrs-rating-hard' },
            { text: 'Good', rating: Rating.Good, cls: 'fsrs-rating-good' },
            { text: 'Easy', rating: Rating.Easy, cls: 'fsrs-rating-easy' },
        ];

        for (const { text, rating, cls } of ratings) {
            const btn = new ButtonComponent(this.controlsContainer)
                .onClick(() => this.handleRating(rating));
            btn.buttonEl.addClass(cls);
            btn.buttonEl.createSpan({ text, cls: 'fsrs-rating-text' });
            btn.buttonEl.createEl('small', { text: intervals[rating], cls: 'fsrs-interval-hint' });
        }
    }

    private async showNextCard() {
        if (this.currentCardIndex >= this.queue.length) { this.showCompletionScreen(); return; }

        this.answerContainer.hide();
        this.controlsContainer.hide();

        this.state = 'question';
        const card = this.getCurrentCard();
        const deckPrefix = this.deckName ? this.deckName : 'Reviewing';
        this.titleEl.empty();
        this.titleEl.createSpan({ text: deckPrefix });
        this.titleEl.createSpan({ text: `${this.currentCardIndex + 1}/${this.queue.length}`, cls: 'fsrs-counter-badge' });

        this.frontEl.empty();
        this.backEl.empty();
        await MarkdownRenderer.render(this.app, card.front, this.frontEl, card.filePath, this.renderComponent);
        await MarkdownRenderer.render(this.app, card.back, this.backEl, card.filePath, this.renderComponent);

        this.showAnswerButton.buttonEl.show();
    }

    private showAnswer() {
        if (this.state === 'answer') return;
        this.createControlButtons();
        this.state = 'answer';
        this.showAnswerButton.buttonEl.hide();
        this.controlsContainer.show();
        this.answerContainer.show();
    }

    private handleRating(rating: Rating) {
        this.plugin.dataManager.updateCard(this.getCurrentCard(), rating);
        this.currentCardIndex++;
        void this.showNextCard();
    }

    private showCompletionScreen() {
        this.contentEl.empty();
        this.titleEl.setText('Session complete!');
        const container = this.contentEl.createDiv({ cls: 'fsrs-completion-screen' });
        container.createEl('h2', { text: 'Great work!' });
        container.createEl('p', { text: `You have completed ${this.queue.length} cards.` });
        new ButtonComponent(container).setButtonText('Return to dashboard').setCta().onClick(() => this.close());
    }

    private handleKeyPress(evt: KeyboardEvent) {
        if (evt.key === 'Escape') {
            this.close();
            return;
        }

        if (this.state === 'question') {
            if (evt.key === ' ' || evt.key === 'Enter') {
                evt.preventDefault();
                this.showAnswer();
            }
            return;
        }

        if (this.state === 'answer') {
            switch (evt.key) {
                case '1':
                    evt.preventDefault();
                    this.handleRating(Rating.Again);
                    break;
                case '2':
                    evt.preventDefault();
                    this.handleRating(Rating.Hard);
                    break;
                case '3':
                    evt.preventDefault();
                    this.handleRating(Rating.Good);
                    break;
                case '4':
                    evt.preventDefault();
                    this.handleRating(Rating.Easy);
                    break;
            }
        }
    }

    private getCurrentCard(): Card { return this.queue[this.currentCardIndex]; }
}
