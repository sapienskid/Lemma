import { ItemView, WorkspaceLeaf, ButtonComponent, Notice, setIcon } from 'obsidian';
import { VIEW_TYPE_DASHBOARD, VIEW_ICON_NAME, getErrorMessage } from '../data/constants';
import type { Card, Deck } from '../data/types';
import { ReviewModal } from './ReviewModal';
import { StatsModal } from './StatsModal';
import { CustomStudyModal } from './CustomStudyModal';
import { HelpModal } from './HelpModal';
import { BrowseModal } from './BrowseModal';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class DashboardView extends ItemView {
    private plugin: FSRSFlashcardsPlugin;
    constructor(leaf: WorkspaceLeaf, plugin: FSRSFlashcardsPlugin) {
        super(leaf);
        this.plugin = plugin;
    }
    getViewType(): string { return VIEW_TYPE_DASHBOARD; }
    getDisplayText(): string { return 'Lemma decks'; }
    getIcon(): string { return VIEW_ICON_NAME; }
    async onOpen() { this.render(); }

    render() {
        this.contentEl.empty();

        if (!this.plugin.dataManager.isDataLoaded()) {
            this.renderLoading();
            return;
        }

        this.renderHeader();
        this.renderDecks();
    }

    private renderLoading() {
        const container = this.contentEl.createDiv({ cls: 'fsrs-empty-state' });
        container.createEl('h2', { text: 'Loading decks...' });
        container.createEl('p', { text: 'Please wait while we scan your vault.' });
        new ButtonComponent(container)
            .setIcon('loader')
            .setDisabled(true)
            .buttonEl.addClass('loading-spinner');
    }

    private renderHeader() {
        const headerEl = this.contentEl.createDiv({ cls: 'fsrs-dashboard-header' });

        const headerTop = headerEl.createDiv({ cls: 'fsrs-header-top' });

        const titleSection = headerTop.createDiv({ cls: 'fsrs-title-section' });
        const logoIcon = titleSection.createDiv({ cls: 'fsrs-logo-icon' });
        setIcon(logoIcon, 'brain-circuit');
        titleSection.createEl('h2', { text: 'Lemma', cls: 'fsrs-title' });

        const actionsRow = headerEl.createDiv({ cls: 'fsrs-quick-actions' });

        const createDashBtn = (icon: string, text: string, onClick: () => void, isPrimary = false) => {
            const btn = new ButtonComponent(actionsRow)
                .setIcon(icon)
                .onClick(onClick);
            btn.buttonEl.createSpan({ text });
            if (isPrimary) btn.setCta();
            return btn;
        };

        const studyAllBtn = createDashBtn('play', 'Study all due', () => {
            const allDueCards = this.plugin.dataManager.getDecks()
                .flatMap((d: Deck) => this.plugin.dataManager.getReviewQueue(d.id))
                .filter((c: Card, i: number, arr: Card[]) => arr.indexOf(c) === i);
            if (allDueCards.length === 0) {
                new Notice('No cards due for review!');
                return;
            }
            new ReviewModal(this.app, this.plugin, allDueCards).open();
        }, true);
        const dueCount = this.plugin.dataManager.getDecks().reduce((acc: number, d: Deck) => acc + d.stats.due, 0);
        if (dueCount > 0) {
            studyAllBtn.buttonEl.createEl('span', { text: dueCount.toString(), cls: 'fsrs-action-badge' });
        }

        createDashBtn('bar-chart-2', 'Statistics', () => new StatsModal(this.app, this.plugin).open());

        createDashBtn('filter', 'Custom study', () => new CustomStudyModal(this.app, this.plugin).open());

        const iconRow = actionsRow.createDiv({ cls: 'fsrs-icon-row' });

        const helpBtn = iconRow.createEl('div', { cls: 'clickable-icon', attr: { 'aria-label': 'Help & guide' } });
        setIcon(helpBtn, 'help-circle');
        helpBtn.addEventListener('click', () => new HelpModal(this.app, this.plugin).open());

        const refreshBtn = iconRow.createEl('div', { cls: 'clickable-icon', attr: { 'aria-label': 'Refresh' } });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', () => {
            void (async () => {
                refreshBtn.addClass('is-spinning');
                await this.plugin.dataManager.buildIndex();
                this.render();
                refreshBtn.removeClass('is-spinning');
            })();
        });

        const pouchDB = this.plugin.dataManager.getPouchDB();
        if (this.plugin.settings.syncEnabled && pouchDB) {
            const syncBtn = iconRow.createEl('div', { cls: 'clickable-icon', attr: { 'aria-label': 'Sync' } });
            setIcon(syncBtn, 'cloud');
            syncBtn.addEventListener('click', () => {
                void (async () => {
                    if (pouchDB.isSyncing()) {
                        new Notice('Sync in progress...');
                        return;
                    }
                    syncBtn.addClass('is-busy');
                    try {
                        const syncTimeout = new Promise<never>((_, reject) => {
                            window.setTimeout(() => reject(new Error('Sync request timed out')), 15000);
                        });
                        await Promise.race([pouchDB.manualSync(), syncTimeout]);
                        new Notice('Sync completed!', 3000);
                    } catch (error: unknown) {
                        new Notice(`Sync failed: ${getErrorMessage(error)}`, 5000);
                    } finally {
                        syncBtn.removeClass('is-busy');
                        syncBtn.removeAttribute('disabled');
                    }
                })();
            });
        }

        const decks = this.plugin.dataManager.getDecks();
        const globalStats = decks.reduce((acc: { new: number; due: number; total: number }, deck: Deck) => {
            acc.new += deck.stats.new;
            acc.due += deck.stats.due;
            acc.total += deck.cardIds.size;
            return acc;
        }, { new: 0, due: 0, total: 0 });

        const statsEl = headerEl.createDiv({ cls: 'fsrs-stats-cards' });

        const createStatPill = (icon: string, value: string, label: string, variant: string) => {
            const pill = statsEl.createDiv({ cls: `fsrs-stat-pill fsrs-stat-pill-${variant}` });
            const iconEl = pill.createDiv();
            setIcon(iconEl, icon);
            pill.createEl('span', { text: value, cls: 'fsrs-stat-pill-value' });
            pill.createEl('span', { text: label });
        };

        createStatPill('layers', globalStats.total.toString(), 'total', 'neutral');
        createStatPill('clock', globalStats.due.toString(), 'due', 'due');
        createStatPill('sparkles', globalStats.new.toString(), 'new', 'new');
    }

    private renderDecks() {
        const decks = this.plugin.dataManager.getDecks();
        if (decks.length === 0) { this.renderEmptyState(); return; }

        const groupedDecks = this.groupDecksByFolder(decks);

        for (const [folderPath, folderDecks] of groupedDecks) {
            this.renderFolderGroup(folderPath, folderDecks);
        }
    }

    private groupDecksByFolder(decks: Deck[]): Map<string, Deck[]> {
        const groups = new Map<string, Deck[]>();

        for (const deck of decks) {
            const lastSlashIndex = deck.filePath.lastIndexOf('/');
            const folderPath = lastSlashIndex > 0 ? deck.filePath.substring(0, lastSlashIndex) : 'Root';

            if (!groups.has(folderPath)) {
                groups.set(folderPath, []);
            }
            groups.get(folderPath)!.push(deck);
        }

        return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    }

    private renderFolderGroup(folderPath: string, decks: Deck[]) {
        const folderContainer = this.contentEl.createDiv({ cls: 'fsrs-folder-group' });

        const folderHeader = folderContainer.createDiv({ cls: 'fsrs-folder-header' });
        folderHeader.setAttribute('role', 'button');
        folderHeader.setAttribute('tabindex', '0');
        folderHeader.setAttribute('aria-expanded', 'false');

        const chevronIcon = folderHeader.createDiv({ cls: 'fsrs-folder-chevron' });
        setIcon(chevronIcon, 'chevron-right');

        const folderIcon = folderHeader.createDiv({ cls: 'fsrs-folder-icon' });
        setIcon(folderIcon, 'folder-closed');

        const folderName = folderPath === 'Root' ? 'Root' : folderPath.substring(folderPath.lastIndexOf('/') + 1);
        folderHeader.createEl('span', { text: folderName, cls: 'fsrs-folder-name' });

        const dueCardsInFolder = decks.reduce((sum, deck) => sum + deck.stats.due, 0);

        const countContainer = folderHeader.createDiv({ cls: 'fsrs-folder-count-container' });

        if (dueCardsInFolder > 0) {
            countContainer.createEl('span', {
                text: `${dueCardsInFolder}`,
                cls: 'fsrs-folder-count fsrs-folder-due-count',
            });
        }
        countContainer.createEl('span', {
            text: `${decks.length}`,
            cls: 'fsrs-folder-count',
        });

        const decksContainer = folderContainer.createDiv({ cls: 'fsrs-folder-decks' });
        decksContainer.hide();

        let isCollapsed = true;
        folderHeader.addClass('is-collapsed');

        const toggleFolder = () => {
            isCollapsed = !isCollapsed;
            folderHeader.toggleClass('is-collapsed', isCollapsed);
            folderHeader.toggleClass('is-expanded', !isCollapsed);
            folderHeader.setAttribute('aria-expanded', (!isCollapsed).toString());
            if (isCollapsed) { decksContainer.hide(); } else { decksContainer.show(); }
            setIcon(chevronIcon, isCollapsed ? 'chevron-right' : 'chevron-down');
            setIcon(folderIcon, isCollapsed ? 'folder-closed' : 'folder-open');
        };

        folderHeader.addEventListener('click', toggleFolder);
        folderHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleFolder();
            }
        });

        for (const deck of decks) {
            this.renderDeckItem(decksContainer, deck);
        }
    }

    private renderDeckItem(container: HTMLElement, deck: Deck) {
        const hasDue = deck.stats.due > 0;

        const deckRow = container.createDiv({ cls: 'fsrs-deck-row' });

        deckRow.addEventListener('click', () => {
            void this.app.workspace.openLinkText(deck.filePath, deck.filePath);
        });

        const iconEl = deckRow.createDiv({ cls: 'fsrs-deck-row-icon' });
        setIcon(iconEl, hasDue ? 'file-clock' : 'file-text');
        if (hasDue) {
            iconEl.addClass('has-due');
        }

        deckRow.createEl('span', { text: deck.title, cls: 'fsrs-deck-row-title' });

        const statsEl = deckRow.createDiv({ cls: 'fsrs-deck-row-stats' });
        if (deck.stats.due > 0) {
            statsEl.createEl('span', {
                text: `${deck.stats.due}`,
                cls: 'fsrs-stat-due has-due',
            });
        }
        if (deck.stats.new > 0) {
            statsEl.createEl('span', { text: `${deck.stats.new}`, cls: 'fsrs-stat-new' });
        }

        const actionsEl = deckRow.createDiv({ cls: 'fsrs-deck-row-actions' });

        const studyBtn = actionsEl.createEl('button', {
            cls: `clickable-icon${hasDue ? '' : ' fsrs-deck-muted'}`,
            attr: { 'aria-label': hasDue ? `Study ${deck.stats.due} cards` : 'No cards due' },
        });
        setIcon(studyBtn, 'play');
        studyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const queue = this.plugin.dataManager.getReviewQueue(deck.id);
            if (queue.length === 0) {
                new Notice('No cards to review in this deck!');
                return;
            }
            new ReviewModal(this.app, this.plugin, queue, deck.title).open();
        });

        const cramBtn = actionsEl.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Cram all cards' },
        });
        setIcon(cramBtn, 'zap');
        cramBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cards = this.plugin.dataManager.getAllCardsForStudy(deck.id);
            if (cards.length === 0) {
                new Notice('No cards in this deck!');
                return;
            }
            new ReviewModal(this.app, this.plugin, cards, deck.title).open();
        });

        const browseBtn = actionsEl.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Browse cards' },
        });
        setIcon(browseBtn, 'list');
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cards = this.plugin.dataManager.getCardsByDeck(deck.id);
            if (cards.length === 0) {
                new Notice('This deck has no cards to browse.');
                return;
            }
            new BrowseModal(this.app, this.plugin, cards, deck.title).open();
        });
    }

    private renderEmptyState() {
        const emptyStateEl = this.contentEl.createDiv({ cls: 'fsrs-empty-state' });

        const iconContainer = emptyStateEl.createDiv({ cls: 'fsrs-empty-icon-container' });
        const iconEl = iconContainer.createDiv({ cls: 'fsrs-empty-icon' });
        setIcon(iconEl, 'sparkles');

        emptyStateEl.createEl('h3', { text: 'Ready to learn?', cls: 'fsrs-empty-title' });

        emptyStateEl.createEl('p', {
            text: `Create flashcards by adding the tag #${this.plugin.settings.deckTag} to any note.`,
            cls: 'fsrs-empty-desc',
        });

        const tipEl = emptyStateEl.createEl('div', { cls: 'fsrs-empty-tip' });
        const tipIcon = tipEl.createDiv({ cls: 'fsrs-tip-icon' });
        setIcon(tipIcon, 'lightbulb');
        tipEl.createSpan({ text: 'Pro tip: Use ---card--- to create flashcard blocks' });
    }
}
