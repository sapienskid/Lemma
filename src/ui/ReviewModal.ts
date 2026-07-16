import { App, Modal, ButtonComponent, Component, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { Rating } from 'ts-fsrs';
import type { Card } from '../data/types';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

type SwipeDirection = 'left' | 'right' | 'up' | 'down' | null;
const SWIPE_THRESHOLD = 60;

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
    private typeinContainer: HTMLElement;
    private typeinInput: HTMLInputElement;
    private typeinFeedback: HTMLElement;
    private typeinCheckBtn: ButtonComponent;

    private gestureStartX = 0;
    private gestureStartY = 0;
    private gestureCurrentX = 0;
    private gestureCurrentY = 0;
    private isGesturing = false;
    private boundHandlers: Array<{ target: EventTarget; type: string; handler: EventListener }> = [];

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
        for (const { target, type, handler } of this.boundHandlers) {
            target.removeEventListener(type, handler);
        }
        this.boundHandlers = [];
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

        const contextEl = this.cardContainer.createDiv({ cls: 'fsrs-card-context' });
        if (card.context) {
            contextEl.setText(card.context);
        } else {
            contextEl.addClass('fsrs-card-context-hidden');
        }

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

        this.typeinContainer = container.createDiv({ cls: 'fsrs-typein-container' });
        this.typeinContainer.hide();

        this.typeinInput = this.typeinContainer.createEl('input', {
            cls: 'fsrs-typein-input',
            attr: { type: 'text', placeholder: 'Type your answer...', autocomplete: 'off', spellcheck: 'false' },
        });
        this.typeinFeedback = this.typeinContainer.createDiv({ cls: 'fsrs-typein-feedback' });
        this.typeinFeedback.hide();

        this.typeinCheckBtn = new ButtonComponent(this.typeinContainer)
            .setButtonText('Check')
            .setCta()
            .onClick(() => {
                const card = this.getCurrentCard();
                const typed = this.typeinInput.value.trim();
                const correct = card.back.trim();
                if (!typed) return;

                const exactMatch = typed.toLowerCase() === correct.toLowerCase();
                const keywordMatch = !exactMatch && correct.toLowerCase().split(/\s+/).some(word =>
                    word.length > 3 && typed.toLowerCase().includes(word.toLowerCase())
                );

                this.typeinFeedback.empty();
                this.typeinFeedback.show();
                this.typeinInput.disabled = true;
                this.typeinCheckBtn.setDisabled(true);

                if (exactMatch) {
                    this.typeinFeedback.createEl('span', { text: 'Correct', cls: 'fsrs-typein-correct' });
                    this.typeinFeedback.createEl('p', { text: `Answer: ${correct}`, cls: 'fsrs-typein-answer' });
                    this.handleRating(Rating.Good);
                } else if (keywordMatch) {
                    this.typeinFeedback.createEl('span', { text: 'Close match', cls: 'fsrs-typein-partial' });
                    this.typeinFeedback.createEl('p', { text: `Correct answer: ${correct}`, cls: 'fsrs-typein-answer' });
                    this.controlsContainer.show();
                    this.showAnswerButton.buttonEl.hide();
                } else {
                    this.typeinFeedback.createEl('span', { text: 'Not correct', cls: 'fsrs-typein-wrong' });
                    this.typeinFeedback.createEl('p', { text: `Correct answer: ${correct}`, cls: 'fsrs-typein-answer' });
                    this.controlsContainer.show();
                    this.showAnswerButton.buttonEl.hide();
                }
            });
        this.typeinCheckBtn.buttonEl.addClass('fsrs-typein-check-btn');

        const addHandler = (target: EventTarget, type: string, handler: EventListener) => {
            target.addEventListener(type, handler);
            this.boundHandlers.push({ target, type, handler });
        };
        addHandler(this.cardContainer, 'pointerdown', (e: Event) => this.onGestureStart(e as PointerEvent));
        addHandler(this.cardContainer, 'pointermove', (e: Event) => this.onGestureMove(e as PointerEvent));
        addHandler(this.cardContainer, 'pointerup', (e: Event) => this.onGestureEnd(e as PointerEvent));
        addHandler(this.cardContainer, 'pointerleave', (e: Event) => this.onGestureEnd(e as PointerEvent));
        this.cardContainer.addClass('fsrs-no-touch-action');
    }

    private onGestureStart(e: PointerEvent) {
        this.isGesturing = true;
        this.gestureStartX = e.clientX;
        this.gestureStartY = e.clientY;
        this.gestureCurrentX = e.clientX;
        this.gestureCurrentY = e.clientY;
    }

    private onGestureMove(e: PointerEvent) {
        if (!this.isGesturing) return;
        this.gestureCurrentX = e.clientX;
        this.gestureCurrentY = e.clientY;

        const dx = this.gestureCurrentX - this.gestureStartX;
        const dy = this.gestureCurrentY - this.gestureStartY;

        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            this.cardContainer.setCssProps({
                '--fsrs-swipe-dx': `${dx * 0.4}px`,
                '--fsrs-swipe-dy': `${dy * 0.2}px`,
                '--fsrs-swipe-rot': `${dx * 0.02}deg`,
            });
            const direction = this.getSwipeDirection(dx, dy);
            this.cardContainer.removeClass('fsrs-swipe-left', 'fsrs-swipe-right', 'fsrs-swipe-up', 'fsrs-swipe-down');
            if (direction) {
                this.cardContainer.addClass(`fsrs-swipe-${direction}`);
            }
        }
    }

    private onGestureEnd(_e: PointerEvent) {
        if (!this.isGesturing) return;
        this.isGesturing = false;

        const dx = this.gestureCurrentX - this.gestureStartX;
        const dy = this.gestureCurrentY - this.gestureStartY;
        const direction = this.getSwipeDirection(dx, dy);

        this.cardContainer.setCssProps({ '--fsrs-swipe-dx': '', '--fsrs-swipe-dy': '', '--fsrs-swipe-rot': '' });
        this.cardContainer.removeClass('fsrs-swipe-left', 'fsrs-swipe-right', 'fsrs-swipe-up', 'fsrs-swipe-down');

        if (!direction || this.state !== 'answer') return;

        const ratingMap: Record<string, Rating> = {
            left: Rating.Again,
            down: Rating.Hard,
            right: Rating.Good,
            up: Rating.Easy,
        };

        const rating = ratingMap[direction];
        if (rating !== undefined) {
            this.handleRating(rating);
        }
    }

    private getSwipeDirection(dx: number, dy: number): SwipeDirection {
        if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return null;

        if (Math.abs(dx) > Math.abs(dy)) {
            return dx < 0 ? 'left' : 'right';
        } else {
            return dy < 0 ? 'up' : 'down';
        }
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

        const contextEl = this.cardContainer.querySelector('.fsrs-card-context') as HTMLElement;
        if (contextEl) {
            if (card.context) {
                contextEl.setText(card.context);
                contextEl.removeClass('fsrs-card-context-hidden');
            } else {
                contextEl.addClass('fsrs-card-context-hidden');
            }
        }

        await MarkdownRenderer.render(this.app, card.front, this.frontEl, card.filePath, this.renderComponent);
        await MarkdownRenderer.render(this.app, card.back, this.backEl, card.filePath, this.renderComponent);

        if (card.type === 'typein') {
            this.showAnswerButton.buttonEl.hide();
            this.typeinContainer.show();
            this.typeinInput.value = '';
            this.typeinInput.disabled = false;
            this.typeinCheckBtn.setDisabled(false);
            this.typeinFeedback.empty();
            this.typeinFeedback.hide();
            this.typeinInput.focus();
        } else {
            this.showAnswerButton.buttonEl.show();
            this.typeinContainer.hide();
        }
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
