import {
    App,
    ButtonComponent,
    Component,
    Editor,
    ItemView,
    MarkdownRenderer,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    WorkspaceLeaf,
    debounce,
    setIcon
} from 'obsidian';
import { FSRS, generatorParameters, Rating, State, Card as FSRSCard } from 'ts-fsrs';
import * as CryptoJS from 'crypto-js';
import { Chart, registerables } from 'chart.js';
import { PouchDBManager } from './src/database/PouchDBManager';
import { DataMigration, type LegacyPluginData } from './src/database/DataMigration';

// --- CONSTANTS ---
const VIEW_TYPE_DASHBOARD = 'fsrs-dashboard-view';
const VIEW_ICON_NAME = 'book-open';
const STATUS_ICON_NAME = 'brain-circuit';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (isRecord(error) && typeof error.message === 'string') {
        return error.message;
    }

    return String(error);
}

function getDocsWritten(info: unknown): number {
    if (!isRecord(info)) {
        return 0;
    }
    const change = info.change;
    if (!isRecord(change) || typeof change.docs_written !== 'number') {
        return 0;
    }
    return change.docs_written;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
}

function getDocCount(info: unknown): number {
    if (!isRecord(info) || typeof info.doc_count !== 'number') {
        return 0;
    }
    return info.doc_count;
}

function isLikelyCorsOrNetworkErrorMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('failed to fetch')
        || normalized.includes('cors')
        || normalized.includes('network');
}

function sanitizeCredentialForUrl(value: string): string {
    // Preserve already-valid percent escapes and encode stray '%' to prevent URIError in PouchDB parsing.
    return value.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
}


function generateBlockId(length: number = 6): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `fsrs-${result}`;
}

// --- DATA INTERFACES ---

interface FSRSParameters { request_retention: number; maximum_interval: number; w: readonly number[]; }
interface FSRSSettings { 
    deckTag: string; 
    newCardsPerDay: number; 
    reviewsPerDay: number; 
    fontSize: number; 
    fsrsParams: FSRSParameters;
    // Sync settings
    syncEnabled: boolean;
    syncUrl: string;
    syncDbName: string;
    syncUsername: string;
    syncPassword: string;
    usePouchDB: boolean;
}
const DEFAULT_SETTINGS: FSRSSettings = { 
    deckTag: 'flashcards', 
    newCardsPerDay: 20, 
    reviewsPerDay: 200, 
    fontSize: 18, 
    fsrsParams: generatorParameters(),
    syncEnabled: false,
    syncUrl: '',
    syncDbName: 'lemma',
    syncUsername: '',
    syncPassword: '',
    usePouchDB: true
};

type CardType = 'basic' | 'cloze';
interface CardData {
    id: string;
    deckId: string;
    filePath: string;
    type: CardType;
    originalText: string;
    front: string;
    back: string;
}
type FSRSData = FSRSCard;
interface Card extends CardData { fsrsData?: FSRSData; }
interface Deck {
    id: string;
    title: string;
    filePath: string;
    cardIds: Set<string>;
    stats: { new: number; due: number; learning: number; };
}
interface ReviewLog { cardId: string; timestamp: number; rating: Rating; }
interface PluginData { settings: FSRSSettings; cardData: Record<string, FSRSData>; reviewHistory: ReviewLog[]; }

// --- DATA MANAGER ---

class DataManager {
    private plugin: FSRSFlashcardsPlugin;
    private fsrs: FSRS;
    private decks: Map<string, Deck> = new Map();
    private cards: Map<string, Card> = new Map();
    private fsrsDataStore: Record<string, FSRSData> = {};
    private reviewHistory: ReviewLog[] = [];
    private pouchDB: PouchDBManager | null = null;
    private migrationCompleted: boolean = false;
    private isLoaded: boolean = false;

    constructor(plugin: FSRSFlashcardsPlugin) { 
        this.plugin = plugin; 
        this.fsrs = new FSRS(plugin.settings.fsrsParams);
        if (plugin.settings.usePouchDB) {
            this.pouchDB = new PouchDBManager('lemma_local');
        }
    }

    getPouchDB(): PouchDBManager | null {
        return this.pouchDB;
    }
    
    async initializeSync() {
        if (this.plugin.settings.syncEnabled && 
            this.plugin.settings.syncUrl && 
            this.pouchDB) {
            try {
                // Build authenticated URL if credentials are provided
                const syncUrl = this.buildAuthenticatedUrl(
                    this.plugin.settings.syncUrl,
                    this.plugin.settings.syncDbName,
                    this.plugin.settings.syncUsername,
                    this.plugin.settings.syncPassword
                );
                console.debug('Initializing sync with:', this.sanitizeUrl(syncUrl));
                
                // Setup sync event handlers
                this.pouchDB.onSyncChange((info) => {
                    const docsWritten = getDocsWritten(info);
                    console.debug('Synced changes:', info);
                    if (docsWritten > 0) {
                        new Notice(`Synced ${docsWritten} changes`, 2000);
                    }
                });
                
                this.pouchDB.onSyncError((err) => {
                    const message = getErrorMessage(err);
                    console.error('Sync error:', err);
                    new Notice(`Sync error: ${message}`, 5000);

                    if (isLikelyCorsOrNetworkErrorMessage(message)) {
                        new Notice('Sync stopped. Check cors settings and sync URL.', 7000);
                        void this.pouchDB?.stopSync().catch((stopError: unknown) => {
                            console.error('Failed to stop sync after network/CORS error:', stopError);
                        });
                    }
                });
                
                this.pouchDB.onSyncActive(() => {
                    console.debug('Sync active');
                });
                
                this.pouchDB.onSyncPaused((err) => {
                    if (err) {
                        console.warn('Sync paused with error:', err);
                    }
                });
                
                await this.pouchDB.setupSync(syncUrl);
                new Notice('Sync initialized successfully');
            } catch (error) {
                console.error('Failed to initialize sync:', error);
                new Notice(`Sync initialization failed: ${getErrorMessage(error)}`);
            }
        }
    }
    
    private buildAuthenticatedUrl(url: string, dbName: string, username: string, password: string): string {
        try {
            const urlObj = new URL(url.trim());
            const cleanDbName = dbName.trim().replace(/^\/+|\/+$/g, '');
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            if (cleanDbName) {
                const lastSegment = pathSegments[pathSegments.length - 1];
                if (lastSegment !== cleanDbName) {
                    pathSegments.push(cleanDbName);
                }
            }

            urlObj.pathname = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/';

            if (username) {
                urlObj.username = sanitizeCredentialForUrl(username);
            }
            if (password) {
                urlObj.password = sanitizeCredentialForUrl(password);
            }

            return urlObj.toString();
        } catch (error) {
            console.error('Failed to build authenticated URL:', error);
            return url;
        }
    }
    
    private sanitizeUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            if (urlObj.password) {
                urlObj.password = '***';
            }
            return urlObj.toString();
        } catch {
            return url;
        }
    }
    
    async stopSync() {
        if (this.pouchDB) {
            await this.pouchDB.stopSync();
        }
    }
    async load() {
        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            await this.loadFromPouchDB();
        } else {
            await this.loadFromLegacyJSON();
        }
        await this.buildIndex();
        this.isLoaded = true;
    }

    isDataLoaded() {
        return this.isLoaded;
    }

    private async loadFromPouchDB() {
        if (!this.pouchDB) return;
        
        console.debug('Loading data from PouchDB...');
        
        // Load card states
        this.fsrsDataStore = await this.pouchDB.getAllCardStates();
        
        // Load review history
        this.reviewHistory = await this.pouchDB.getReviewHistory();
        
        console.debug(`Loaded ${Object.keys(this.fsrsDataStore).length} cards and ${this.reviewHistory.length} reviews from PouchDB`);
    }

    private async loadFromLegacyJSON() {
        console.debug('Loading data from legacy JSON...');
        const data = (await this.plugin.loadData()) as PluginData | null;
        const cardData = data?.cardData || {};
        for (const cardId in cardData) { 
            const card = cardData[cardId]; 
            if (card.due) card.due = new Date(card.due); 
            if (card.last_review) card.last_review = new Date(card.last_review); 
        }
        this.fsrsDataStore = cardData;
        this.reviewHistory = data?.reviewHistory || [];
    }
    async save() { 
        // Always save settings to data.json
        await this.plugin.saveData({ 
            settings: this.plugin.settings, 
            cardData: this.plugin.settings.usePouchDB ? {} : this.fsrsDataStore,
            reviewHistory: this.plugin.settings.usePouchDB ? [] : this.reviewHistory
        });
    }
    updateFsrsParameters(params: FSRSParameters) { this.fsrs = new FSRS(params); }
    async buildIndex() {
        console.debug("FSRS: Building index...");
        this.decks.clear(); 
        this.cards.clear();
        // Note: We preserve fsrsDataStore to retain review history
        // Stale entries will be cleaned up naturally since their cards no longer exist
        for (const file of this.plugin.app.vault.getMarkdownFiles()) { await this.updateFile(file); }
        this.recalculateAllDeckStats();
        console.debug(`FSRS: Index complete. Found ${this.decks.size} decks and ${this.cards.size} cards.`);
    }
    private getDeckId(path: string): string { return CryptoJS.SHA256(path).toString(); }
    async updateFile(file: TFile) {
        const deckId = this.getDeckId(file.path);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const deckTag = `#${this.plugin.settings.deckTag}`;
        const frontmatter = isRecord(cache?.frontmatter) ? cache.frontmatter : null;
        const frontmatterTags = frontmatter ? toStringArray(frontmatter.tags) : [];
        const isDeck = (cache?.tags?.some((tag) => tag.tag === deckTag) ?? false) || frontmatterTags.includes(this.plugin.settings.deckTag);
        this.removeDeck(deckId, false);
        if (!isDeck) return;

        const title = frontmatter && typeof frontmatter.title === 'string' ? frontmatter.title : file.basename;
        const newDeck: Deck = { id: deckId, title, filePath: file.path, cardIds: new Set(), stats: { new: 0, due: 0, learning: 0 } };
        const content = await this.plugin.app.vault.read(file);

        // Basic Cards
        const basicCardsRaw = content.split(/---\s*card\s*---/i).slice(1);
        for (const cardRaw of basicCardsRaw) {
            const parts = cardRaw.split(/\n---\n/);
            if (parts.length < 2) continue;

            const frontPart = parts[0];
            const backPart = parts.slice(1).join('\n---\n');

            const blockIdMatch = frontPart.match(/\^([a-zA-Z0-9-]+)\s*$/m);
            let cardId: string;
            let front = frontPart.trim();

            if (blockIdMatch) {
                // Namespace the cardId with deckId to prevent collisions across decks
                // This ensures cards with same block ID in different files are unique
                cardId = `${deckId}::${blockIdMatch[1]}`;
                front = frontPart.replace(/\^([a-zA-Z0-9-]+)\s*$/m, '').trim();
            } else {
                cardId = CryptoJS.SHA256(file.path + '::' + front).toString();
            }

            const back = backPart.trim();
            if (!front || !back) continue;

            const card: Card = { id: cardId, deckId, filePath: file.path, type: 'basic', originalText: cardRaw, front, back, fsrsData: this.fsrsDataStore[cardId] };
            this.cards.set(cardId, card); newDeck.cardIds.add(cardId);
        }

        // Cloze Deletion Cards
        const paragraphs = content.split(/\n\s*\n/);
        for (const paragraph of paragraphs) {
            const clozeRegex = /==c(\d+)::(.*?)==/gs;
            const clozes = [...paragraph.matchAll(clozeRegex)];

            if (clozes.length === 0) continue;

            const blockIdMatch = paragraph.match(/\^([a-zA-Z0-9-]+)\s*$/);

            clozes.forEach(cloze => {
                const clozeNum = cloze[1];
                const originalCloze = cloze[0];

                let cardId: string;
                if (blockIdMatch) {
                    // Namespace with deckId to prevent collisions across decks
                    cardId = `${deckId}::${blockIdMatch[1]}-${clozeNum}`;
                } else {
                    cardId = CryptoJS.SHA256(`${file.path}::${paragraph}::${clozeNum}`).toString();
                }

                const front = paragraph.replace(originalCloze, '[...]');
                const back = paragraph.replace(/==c\d+::(.*?)==/g, '$1');

                const card: Card = { id: cardId, deckId, filePath: file.path, type: 'cloze', originalText: paragraph, front, back, fsrsData: this.fsrsDataStore[cardId] };
                this.cards.set(cardId, card);
                newDeck.cardIds.add(cardId);
            });
        }

        if (newDeck.cardIds.size > 0) this.decks.set(deckId, newDeck);
    }
    removeDeck(deckId: string, fullDelete: boolean = true) { 
        const deck = this.decks.get(deckId); 
        if (deck) { 
            deck.cardIds.forEach(cardId => { 
                this.cards.delete(cardId); 
                // Always delete from fsrsDataStore to prevent orphaned references
                delete this.fsrsDataStore[cardId]; 
            }); 
            this.decks.delete(deckId); 
            if (fullDelete) void this.save(); 
        } 
    }
    async renameDeck(file: TFile, oldPath: string) {
        const oldDeckId = this.getDeckId(oldPath);
        this.removeDeck(oldDeckId, false);
        await this.updateFile(file);
        await this.save();
    }
    recalculateAllDeckStats() { 
        const now = new Date(); 
        for (const deck of this.decks.values()) { 
            deck.stats = { new: 0, due: 0, learning: 0 }; 
            for (const cardId of deck.cardIds) { 
                // Get the card to verify it exists and check its current deck
                const card = this.cards.get(cardId);
                if (!card || card.deckId !== deck.id) continue; // Skip if card doesn't exist or doesn't belong to this deck
                
                const fsrsData = this.fsrsDataStore[cardId]; 
                if (!fsrsData || fsrsData.state === State.New) { 
                    deck.stats.new++; 
                } else { 
                    if (fsrsData.state === State.Learning || fsrsData.state === State.Relearning) deck.stats.learning++; 
                    if (fsrsData.due <= now) deck.stats.due++; 
                } 
            } 
        } 
    }
    getDecks(): Deck[] { return Array.from(this.decks.values()).sort((a, b) => a.title.localeCompare(b.title)); }
    getAllCards(): Card[] { return Array.from(this.cards.values()); }
    getCardsByDeck(deckId: string): Card[] {
        const deck = this.decks.get(deckId);
        if (!deck) return [];
        return Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => {
                // Only include cards that exist and belong to this deck
                return card !== undefined && card !== null && card.deckId === deckId;
            });
    }
    getReviewQueue(deckId: string): Card[] { 
        const deck = this.decks.get(deckId); 
        if (!deck) return []; 
        const now = new Date(); 
        const allCards = Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => card !== undefined && card !== null && card.deckId === deckId);
        const dueCards = allCards.filter(c => c.fsrsData && c.fsrsData.state !== State.New && c.fsrsData.due <= now).sort((a, b) => a.fsrsData!.due.getTime() - b.fsrsData!.due.getTime()); 
        const newCards = allCards.filter(c => !c.fsrsData || c.fsrsData.state === State.New); 
        return [...dueCards.slice(0, this.plugin.settings.reviewsPerDay), ...newCards.slice(0, this.plugin.settings.newCardsPerDay)]; 
    }
    getAllCardsForStudy(deckId: string): Card[] { 
        const deck = this.decks.get(deckId); 
        if (!deck) return []; 
        const now = new Date(); 
        const allCards = Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => card !== undefined && card !== null && card.deckId === deckId);
        const dueCards = allCards.filter(c => c.fsrsData && c.fsrsData.state !== State.New && c.fsrsData.due <= now).sort((a, b) => a.fsrsData!.due.getTime() - b.fsrsData!.due.getTime()); 
        const newCards = allCards.filter(c => !c.fsrsData || c.fsrsData.state === State.New); 
        return [...dueCards, ...newCards]; 
    }
    updateCard(card: Card, rating: Rating) { 
        const now = new Date(); 
        const fsrsCard = card.fsrsData || { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: State.New, learning_steps: 0 }; 
        const scheduling_cards = this.fsrs.repeat(fsrsCard, now); 
        const newFsrsData = scheduling_cards[rating as Exclude<Rating, Rating.Manual>].card; 
        this.fsrsDataStore[card.id] = newFsrsData; 
        card.fsrsData = newFsrsData; 
        
        const reviewLog = { cardId: card.id, timestamp: now.getTime(), rating };
        this.reviewHistory.push(reviewLog);
        
        // Save immediately to PouchDB if enabled
        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            // Ensure we use the correct deckId from the card object
            this.pouchDB.saveCardState(card.id, card.deckId, card.filePath, newFsrsData).catch(err => 
                console.error('Failed to save card state:', err)
            );
            this.pouchDB.addReviewLog(card.id, now.getTime(), rating).catch(err => 
                console.error('Failed to save review log:', err)
            );
        } else {
            void this.save();
        }
    }
    getNextReviewIntervals(card: Card): Record<Exclude<Rating, Rating.Manual>, string> { const now = new Date(); const fsrsCard = card.fsrsData || { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: State.New, learning_steps: 0 }; const scheduling_cards = this.fsrs.repeat(fsrsCard, now); const formatInterval = (days: number): string => { if (days < 1) return "<1d"; if (days < 30) return `${Math.round(days)}d`; if (days < 365) return `${(days / 30).toFixed(1)}m`; return `${(days / 365).toFixed(1)}y`; }; return { [Rating.Again]: formatInterval(scheduling_cards[Rating.Again].card.scheduled_days), [Rating.Hard]: formatInterval(scheduling_cards[Rating.Hard].card.scheduled_days), [Rating.Good]: formatInterval(scheduling_cards[Rating.Good].card.scheduled_days), [Rating.Easy]: formatInterval(scheduling_cards[Rating.Easy].card.scheduled_days), }; }
    getStats() {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const reviewsToday = this.reviewHistory.filter((log) => log.timestamp >= todayStart);
        const activity: number[] = Array.from({ length: 30 }, () => 0);

        this.reviewHistory.forEach((log) => {
            const daysAgo = Math.floor((now.getTime() - log.timestamp) / (1000 * 60 * 60 * 24));
            if (daysAgo < 30) {
                activity[29 - daysAgo]++;
            }
        });

        const forecast: number[] = Array.from({ length: 7 }, () => 0);
        let mature = 0;
        let learning = 0;
        let young = 0;
        let total = 0;

        for (const card of this.cards.values()) {
            const data = this.fsrsDataStore[card.id];
            if (!data) {
                continue;
            }

            total++;

            if (data.due <= now) {
                const daysForward = Math.floor((data.due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                if (daysForward < 7 && daysForward >= 0) {
                    forecast[daysForward]++;
                }
            }

            if (data.stability >= 21) {
                mature++;
            } else if (data.state === State.Review) {
                young++;
            } else {
                learning++;
            }
        }

        return {
            reviewsToday: reviewsToday.length,
            activity,
            forecast,
            maturity: {
                mature,
                young,
                learning,
                new: this.cards.size - total
            }
        };
    }
    
    async resetAllProgress(): Promise<void> {
        console.debug('Nuclear option: Resetting all card progress...');
        
        // Clear from memory
        this.fsrsDataStore = {};
        this.reviewHistory = [];
        
        // Clear from cards in memory
        for (const card of this.cards.values()) {
            card.fsrsData = undefined;
        }
        
        // Clear from PouchDB if enabled
        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            console.debug('Clearing PouchDB card states and review logs...');
            await this.pouchDB.destroy();
            // Recreate the database
            const { PouchDBManager } = await import('./src/database/PouchDBManager');
            this.pouchDB = new PouchDBManager('lemma_local');
            // Re-initialize sync if it was enabled
            if (this.plugin.settings.syncEnabled) {
                await this.initializeSync();
            }
        }
        
        // Clear from legacy JSON storage
        await this.save();
        
        // Recalculate stats to show all cards as "New"
        this.recalculateAllDeckStats();
        
        console.debug('All progress has been reset');
    }
}

// --- UI: DASHBOARD VIEW ---
class DashboardView extends ItemView {
    private plugin: FSRSFlashcardsPlugin; constructor(leaf: WorkspaceLeaf, plugin: FSRSFlashcardsPlugin) { super(leaf); this.plugin = plugin; }
    getViewType(): string { return VIEW_TYPE_DASHBOARD; } getDisplayText(): string { return 'Lemma decks'; } getIcon(): string { return VIEW_ICON_NAME; }
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
        // Modern sleek header
        const headerEl = this.contentEl.createDiv({ cls: 'fsrs-dashboard-header' });
        
        // Title and actions in one row
        const headerTop = headerEl.createDiv({ cls: 'fsrs-header-top' });
        
        // Logo/Title section
        const titleSection = headerTop.createDiv({ cls: 'fsrs-title-section' });
        const logoIcon = titleSection.createDiv({ cls: 'fsrs-logo-icon' });
        setIcon(logoIcon, 'brain-circuit');
        titleSection.createEl('h2', { text: 'Lemma', cls: 'fsrs-title' });
        
        // Quick actions row
        const actionsRow = headerEl.createDiv({ cls: 'fsrs-quick-actions' });
        
        // Helper: create a native dashboard button with icon + text
        const createDashBtn = (icon: string, text: string, onClick: () => void, isPrimary = false) => {
            const btn = new ButtonComponent(actionsRow)
                .setIcon(icon)
                .onClick(onClick);
            btn.buttonEl.createSpan({ text });
            if (isPrimary) btn.setCta();
            return btn;
        };
        
        // Study All button (primary)
        const studyAllBtn = createDashBtn('play', 'Study all due', () => {
            const allDueCards = this.plugin.dataManager.getDecks()
                .flatMap(d => this.plugin.dataManager.getReviewQueue(d.id))
                .filter((c, i, arr) => arr.indexOf(c) === i);
            if (allDueCards.length === 0) {
                new Notice('No cards due for review!');
                return;
            }
            new ReviewModal(this.app, this.plugin, allDueCards).open();
        }, true);
        const dueCount = this.plugin.dataManager.getDecks().reduce((acc, d) => acc + d.stats.due, 0);
        if (dueCount > 0) {
            studyAllBtn.buttonEl.createEl('span', { text: dueCount.toString(), cls: 'fsrs-action-badge' });
        }
        
        // Stats button
        createDashBtn('bar-chart-2', 'Statistics', () => new StatsModal(this.app, this.plugin).open());
        
        // Custom study button
        createDashBtn('filter', 'Custom study', () => new CustomStudyModal(this.app, this.plugin).open());
        
        // Icon buttons row (same flex group as action buttons)
        const iconRow = actionsRow.createDiv({ cls: 'fsrs-icon-row' });
        
        // Help button
        const helpBtn = iconRow.createEl('div', { cls: 'clickable-icon', attr: { 'aria-label': 'Help & guide' } });
        setIcon(helpBtn, 'help-circle');
        helpBtn.addEventListener('click', () => new HelpModal(this.app, this.plugin).open());

        // Refresh button
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
        
        // Sync button if enabled
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
        
        // Stats pills
        const decks = this.plugin.dataManager.getDecks();
        const globalStats = decks.reduce((acc, deck) => { 
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
        
        // Group decks by folder
        const groupedDecks = this.groupDecksByFolder(decks);
        
        // Render each folder group
        for (const [folderPath, folderDecks] of groupedDecks) {
            this.renderFolderGroup(folderPath, folderDecks);
        }
    }
    
    private groupDecksByFolder(decks: Deck[]): Map<string, Deck[]> {
        const groups = new Map<string, Deck[]>();
        
        for (const deck of decks) {
            // Get the folder path (directory containing the deck file)
            const lastSlashIndex = deck.filePath.lastIndexOf('/');
            const folderPath = lastSlashIndex > 0 ? deck.filePath.substring(0, lastSlashIndex) : 'Root';
            
            if (!groups.has(folderPath)) {
                groups.set(folderPath, []);
            }
            groups.get(folderPath)!.push(deck);
        }
        
        // Sort folders alphabetically
        return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    }
    
    private renderFolderGroup(folderPath: string, decks: Deck[]) {
        // Modern folder container
        const folderContainer = this.contentEl.createDiv({ cls: 'fsrs-folder-group' });
        
        // Folder header - sleek modern design
        const folderHeader = folderContainer.createDiv({ cls: 'fsrs-folder-header' });
        folderHeader.setAttribute('role', 'button');
        folderHeader.setAttribute('tabindex', '0');
        folderHeader.setAttribute('aria-expanded', 'false');
        
        // Chevron icon for expand/collapse
        const chevronIcon = folderHeader.createDiv({ cls: 'fsrs-folder-chevron' });
        setIcon(chevronIcon, 'chevron-right');
        
        // Folder icon
        const folderIcon = folderHeader.createDiv({ cls: 'fsrs-folder-icon' });
        setIcon(folderIcon, 'folder-closed');
        
        // Folder name
        const folderName = folderPath === 'Root' ? 'Root' : folderPath.substring(folderPath.lastIndexOf('/') + 1);
        folderHeader.createEl('span', { text: folderName, cls: 'fsrs-folder-name' });
        
        // Deck count badge with total cards info
        const dueCardsInFolder = decks.reduce((sum, deck) => sum + deck.stats.due, 0);
        
        const countContainer = folderHeader.createDiv({ cls: 'fsrs-folder-count-container' });
        
        if (dueCardsInFolder > 0) {
            countContainer.createEl('span', { 
                text: `${dueCardsInFolder}`, 
                cls: 'fsrs-folder-count fsrs-folder-due-count' 
            });
        }
        countContainer.createEl('span', { 
            text: `${decks.length}`, 
            cls: 'fsrs-folder-count' 
        });
        
        // Container for decks (collapsible)
        const decksContainer = folderContainer.createDiv({ cls: 'fsrs-folder-decks' });
        decksContainer.hide();
        
        // Toggle collapse/expand (default to collapsed)
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
        
        // Render decks in this folder
        for (const deck of decks) {
            this.renderDeckItem(decksContainer, deck);
        }
    }
    
    private renderDeckItem(container: HTMLElement, deck: Deck) {
        const hasDue = deck.stats.due > 0;
        
        // Flat deck row (nav-item style)
        const deckRow = container.createDiv({ cls: 'fsrs-deck-row' });
        
        // Click to open deck note
        deckRow.addEventListener('click', () => {
            void this.app.workspace.openLinkText(deck.filePath, deck.filePath);
        });
        
        // File icon
        const iconEl = deckRow.createDiv({ cls: 'fsrs-deck-row-icon' });
        setIcon(iconEl, hasDue ? 'file-clock' : 'file-text');
        if (hasDue) {
            iconEl.addClass('has-due');
        }
        
        // Title
        deckRow.createEl('span', { text: deck.title, cls: 'fsrs-deck-row-title' });
        
        // Stats
        const statsEl = deckRow.createDiv({ cls: 'fsrs-deck-row-stats' });
        if (deck.stats.due > 0) {
            statsEl.createEl('span', { 
                text: `${deck.stats.due}`, 
                cls: 'fsrs-stat-due has-due' 
            });
        }
        if (deck.stats.new > 0) {
            statsEl.createEl('span', { text: `${deck.stats.new}`, cls: 'fsrs-stat-new' });
        }
        
        // Action buttons (inline, revealed on hover)
        const actionsEl = deckRow.createDiv({ cls: 'fsrs-deck-row-actions' });
        
        // Study button
        const studyBtn = actionsEl.createEl('button', { 
            cls: `clickable-icon${hasDue ? '' : ' fsrs-deck-muted'}`,
            attr: { 'aria-label': hasDue ? `Study ${deck.stats.due} cards` : 'No cards due' }
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
        
        // Cram button
        const cramBtn = actionsEl.createEl('button', { 
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Cram all cards' }
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
        
        // Browse button
        const browseBtn = actionsEl.createEl('button', { 
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Browse cards' }
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
        
        // Large icon
        const iconContainer = emptyStateEl.createDiv({ cls: 'fsrs-empty-icon-container' });
        const iconEl = iconContainer.createDiv({ cls: 'fsrs-empty-icon' });
        setIcon(iconEl, 'sparkles');
        
        // Title
        emptyStateEl.createEl('h3', { text: 'Ready to learn?', cls: 'fsrs-empty-title' });
        
        // Description
        emptyStateEl.createEl('p', { 
            text: `Create flashcards by adding the tag #${this.plugin.settings.deckTag} to any note.`,
            cls: 'fsrs-empty-desc'
        });
        
        // Quick tip
        const tipEl = emptyStateEl.createEl('div', { cls: 'fsrs-empty-tip' });
        const tipIcon = tipEl.createDiv({ cls: 'fsrs-tip-icon' });
        setIcon(tipIcon, 'lightbulb');
        tipEl.createSpan({ text: 'Pro tip: Use ---card--- to create flashcard blocks' });
    }
}

// --- UI: BROWSE MODAL ---
class BrowseModal extends Modal {
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

// --- UI: REVIEW MODAL ---
class ReviewModal extends Modal {
    private plugin: FSRSFlashcardsPlugin; private queue: Card[]; private deckName: string | null; private currentCardIndex = 0; private state: 'question' | 'answer' = 'question'; private cardContainer: HTMLElement; private frontEl: HTMLElement; private backEl: HTMLElement; private answerContainer: HTMLElement; private controlsContainer: HTMLElement; private showAnswerButton: ButtonComponent; private renderComponent: Component = new Component();
    constructor(app: App, plugin: FSRSFlashcardsPlugin, queue: Card[], deckName?: string) { super(app); this.plugin = plugin; this.queue = queue; this.deckName = deckName || null; }
    onOpen() {
        this.renderComponent = new Component();
        this.containerEl.addClass('fsrs-review-modal-immersive');
        this.contentEl.empty();
        const deckPrefix = this.deckName ? `${this.deckName} • ` : '';
        this.titleEl.setText(`${deckPrefix}Reviewing (${this.currentCardIndex + 1}/${this.queue.length})`);
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
            if (!data) { new Notice("This is a new card."); return; }
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

        // Hide old answer / controls before swapping content to avoid flash of old back
        this.answerContainer.hide();
        this.controlsContainer.hide();

        this.state = 'question';
        const card = this.getCurrentCard();
        const deckPrefix = this.deckName ? `${this.deckName} • ` : '';
        this.titleEl.setText(`${deckPrefix}Reviewing (${this.currentCardIndex + 1}/${this.queue.length})`);

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
        // Handle Escape to close
        if (evt.key === 'Escape') {
            this.close();
            return;
        }
        
        // Handle Space/Enter to show answer
        if (this.state === 'question') {
            if (evt.key === ' ' || evt.key === 'Enter') {
                evt.preventDefault();
                this.showAnswer();
            }
            return;
        }
        
        // Handle rating keys when answer is shown
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

// --- UI: STATS MODAL ---
class StatsModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private chartInstances: Array<Chart<'line' | 'bar', number[], string>> = [];

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText("Statistics");
        this.containerEl.addClass('fsrs-stats-modal');
        Chart.register(...registerables);

        const stats = this.plugin.dataManager.getStats();

        // Header stats cards
        const headerSection = this.contentEl.createDiv({ cls: 'fsrs-stats-header' });
        
        const createHeaderCard = (icon: string, value: string, label: string, variant: string) => {
            const card = headerSection.createDiv({ cls: `fsrs-stat-header-card fsrs-stat-${variant}` });
            const iconEl = card.createDiv({ cls: 'fsrs-stat-header-icon' });
            setIcon(iconEl, icon);
            card.createEl('div', { text: value, cls: 'fsrs-stat-header-value' });
            card.createEl('div', { text: label, cls: 'fsrs-stat-header-label' });
        };
        
        createHeaderCard('check-circle', stats.reviewsToday.toString(), 'Reviews today', 'success');
        createHeaderCard('calendar', stats.forecast.reduce((a, b) => a + b, 0).toString(), 'Due this week', 'warning');
        createHeaderCard('trending-up', stats.maturity.mature.toString(), 'Mature cards', 'info');
        createHeaderCard('award', (stats.maturity.mature + stats.maturity.young).toString(), 'Total learned', 'neutral');

        // Charts section
        const chartsSection = this.contentEl.createDiv({ cls: 'fsrs-stats-charts' });
        
        // Activity Chart
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
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
        this.chartInstances.push(activityChart);

        // Forecast Chart
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
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'var(--background-modifier-border)' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
        this.chartInstances.push(forecastChart);
    }

    onClose() {
        this.chartInstances.forEach(chart => chart.destroy());
        this.contentEl.empty();
    }
}

// --- UI: HELP MODAL ---
class HelpModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;

    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Help & guide');
        this.containerEl.addClass('fsrs-help-modal');

        const header = this.contentEl.createDiv({ cls: 'fsrs-help-header' });
        header.createEl('h2', { text: 'Lemma' });
        header.createEl('p', { text: `v${this.plugin.manifest.version} — A spaced-repetition flashcard plugin powered by the FSRS algorithm.` });

        this.renderSection('Creating Decks', [
            `Add the tag #${this.plugin.settings.deckTag} to any note to make it a deck.`,
            'You can change the tag in plugin settings.',
            'Each note with the deck tag becomes a separate deck.'
        ], [
            `Use frontmatter: tags: [${this.plugin.settings.deckTag}]`,
            `Or inline: # My Note #${this.plugin.settings.deckTag}`
        ]);

        this.renderSection('Card Formats', [
            'Basic cards have a front (question) and back (answer).',
            'Cloze deletion cards hide specific words within a sentence.',
            'Use the command palette to insert a card template.'
        ], [
            'Basic: ---card--- ^id / Front / --- / Back',
            'Cloze: ==c1::hidden text==',
            'Use block IDs (^unique-id) to preserve review history when editing.'
        ]);

        this.renderSection('Review Hotkeys', [], [
            ['Space / Enter', 'Show answer'],
            ['1', 'Again'],
            ['2', 'Hard'],
            ['3', 'Good'],
            ['4', 'Easy'],
            ['Esc', 'Exit review session']
        ]);

        this.renderSection('Tips', [
            'Use Custom Study to filter by tags or card state.',
            'Enable PouchDB for better performance with large collections.',
            'Use Sync to keep your data across devices via CouchDB.',
            'Full documentation is available in the plugin settings (About section).'
        ], []);
    }

    private renderSection(title: string, paragraphs: string[], items: string[] | string[][]) {
        const section = this.contentEl.createDiv({ cls: 'fsrs-help-section' });
        section.createEl('h3', { text: title });

        for (const p of paragraphs) {
            section.createEl('p', { text: p });
        }

        if (items.length > 0) {
            if (Array.isArray(items[0])) {
                const grid = section.createDiv({ cls: 'fsrs-help-shortcuts' });
                for (const [key, desc] of items as string[][]) {
                    grid.createEl('span', { cls: 'fsrs-help-key', text: key });
                    grid.createEl('span', { text: desc });
                }
            } else {
                const ul = section.createEl('ul');
                for (const item of items as string[]) {
                    ul.createEl('li', { text: item });
                }
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- UI: CUSTOM STUDY MODAL ---
class CustomStudyModal extends Modal {
    private plugin: FSRSFlashcardsPlugin; private tags: string = ""; private state: "new" | "due" | "learning" | "all" = "due"; private limit: number = 50; private unlimited: boolean = false;
    constructor(app: App, plugin: FSRSFlashcardsPlugin) { super(app); this.plugin = plugin; }
    onOpen() {
        this.contentEl.empty(); this.titleEl.setText("Custom study session");
        new Setting(this.contentEl).setName("Filter by tags").setDesc("Comma-separated, e.g., #calculus, #chapter1").addText(text => text.setValue(this.tags).onChange(val => this.tags = val));
        new Setting(this.contentEl).setName("Filter by card state").addDropdown((dropdown) => dropdown
            .addOption("due", "Due")
            .addOption("new", "New")
            .addOption("learning", "Learning")
            .addOption("all", "All cards (cram mode)")
            .setValue(this.state)
            .onChange((value) => {
                if (value === "due" || value === "new" || value === "learning" || value === "all") {
                    this.state = value;
                }
            }));
        new Setting(this.contentEl).setName("Card limit").setDesc("Set to 0 or enable unlimited for no limit").addText(text => text.setValue(this.limit.toString()).onChange(val => this.limit = parseInt(val) || 0));
        new Setting(this.contentEl).setName("Unlimited cards").setDesc("Ignore card limit - study all matching cards (for exam prep)").addToggle(toggle => toggle.setValue(this.unlimited).onChange(val => this.unlimited = val));
        new Setting(this.contentEl).addButton(btn => btn.setButtonText("Start studying").setCta().onClick(() => this.startSession()));
    }
    startSession() {
        const now = new Date();
        const allCards = this.plugin.dataManager.getAllCards();
        const requiredTags = this.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        let queue = allCards.filter(card => {
            const data = card.fsrsData;
            if (this.state !== "all") {
                const cardState = !data ? "new" : data.due <= now ? "due" : "learning";
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

        if (queue.length === 0) { new Notice("No cards found matching your criteria."); return; }
        this.close();
        new ReviewModal(this.app, this.plugin, queue).open();
    }
}

// --- UI: RESET PROGRESS MODAL (Nuclear Option) ---
class ResetProgressModal extends Modal {
    private plugin: FSRSFlashcardsPlugin;
    private confirmText: string = "";
    
    constructor(app: App, plugin: FSRSFlashcardsPlugin) { 
        super(app); 
        this.plugin = plugin; 
    }
    
    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Reset all card progress');
        
        // Warning message
        const warningContainer = this.contentEl.createDiv({ cls: 'fsrs-reset-warning' });
        warningContainer.addClass('setting-item-heading');
        
        warningContainer.createEl('h3', { 
            text: 'Warning: this action cannot be undone.',
            cls: 'mod-warning'
        });
        
        warningContainer.createEl('p', { 
            text: 'This will permanently delete all your review history and card progress:' 
        });
        
        const consequences = warningContainer.createEl('ul');
        consequences.createEl('li', { text: 'All cards will be reset to "new" status' });
        consequences.createEl('li', { text: 'All review history will be deleted' });
        consequences.createEl('li', { text: 'All FSRS scheduling data will be cleared' });
        consequences.createEl('li', { text: 'You will start from scratch with every card' });
        
        // Stats display
        const statsContainer = this.contentEl.createDiv({ cls: 'fsrs-reset-stats' });
        
        const allCards = this.plugin.dataManager.getAllCards();
        const cardsWithProgress = allCards.filter((card) => card.fsrsData && card.fsrsData.state !== State.New).length;
        
        statsContainer.createEl('h4', { text: 'Current data:' });
        const statsList = statsContainer.createEl('ul');
        statsList.createEl('li', { text: `Total cards: ${allCards.length}` });
        statsList.createEl('li', { text: `Cards with progress: ${cardsWithProgress}` });
        
        // Confirmation input
        new Setting(this.contentEl)
            .setName('Type "delete" to confirm')
            .setDesc('This confirmation prevents accidental data loss')
            .addText(text => text
                .setPlaceholder('Delete')
                .onChange(val => this.confirmText = val));
        
        // Buttons
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
            
            // Clear from DataManager
            await this.plugin.dataManager.resetAllProgress();
            
            // Refresh the dashboard
            this.plugin.refreshDashboardView();
            
            this.close();
            new Notice('All card progress has been reset. All cards are now "new".', 5000);
        } catch (error) {
            console.error('Failed to reset progress:', error);
            new Notice(`Failed to reset: ${getErrorMessage(error)}`, 5000);
        }
    }
}

// --- UI: SETTINGS TAB ---
class FSRSSettingsTab extends PluginSettingTab {
    plugin: FSRSFlashcardsPlugin; constructor(app: App, plugin: FSRSFlashcardsPlugin) { super(app, plugin); this.plugin = plugin; }
    display(): void { 
        const { containerEl } = this; 
        containerEl.empty(); 
        
        // Database
        new Setting(containerEl).setName("Database").setHeading();
        
        new Setting(containerEl)
            .setName('Use PouchDB (IndexedDB)')
            .setDesc('Use PouchDB for local storage instead of JSON files. Better performance for large collections (10k+ cards).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.usePouchDB)
                .onChange(async (value) => {
                    this.plugin.settings.usePouchDB = value;
                    await this.plugin.saveSettings();
                    new Notice('Please reload Obsidian for this change to take effect');
                }));
        
        new Setting(containerEl)
            .setName('Migrate to PouchDB')
            .setDesc('Convert your existing data.json to PouchDB format (requires PouchDB to be enabled).')
            .setDisabled(!this.plugin.settings.usePouchDB)
            .addButton(btn => btn
                .setButtonText('Migrate now')
                .setCta()
                .onClick(async () => {
                    await this.migrateData();
                }));
        
        // Sync
        new Setting(containerEl).setName("Sync").setHeading();
        
        new Setting(containerEl)
            .setName('Enable sync')
            .setDesc('Sync your flashcard data with a CouchDB server')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.syncEnabled = value;
                    await this.plugin.saveSettings();

                    const pouchDB = this.plugin.dataManager.getPouchDB();
                    if (value && pouchDB) {
                        await this.setupSync();
                    } else if (!value && pouchDB) {
                        await pouchDB.stopSync();
                        new Notice('Sync disabled');
                    }
                }));
        
        new Setting(containerEl)
            .setName('CouchDB server URL')
            .setDesc('Your CouchDB server URL (e.g., https://your-server.com:5984/lemma)')
            .addText(text => text
                .setPlaceholder('https://your-server.com:5984/lemma')
                .setValue(this.plugin.settings.syncUrl)
                .onChange(async (value) => {
                    this.plugin.settings.syncUrl = value.trim();
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Database name')
            .setDesc('The name of the database on your CouchDB server')
            .addText(text => text
                .setPlaceholder('Lemma')
                .setValue(this.plugin.settings.syncDbName)
                .onChange(async (value) => {
                    this.plugin.settings.syncDbName = value.trim() || 'lemma';
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Username')
            .setDesc('CouchDB username for authentication')
            .addText(text => text
                .setPlaceholder('Admin')
                .setValue(this.plugin.settings.syncUsername)
                .onChange(async (value) => {
                    this.plugin.settings.syncUsername = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Password')
            .setDesc('CouchDB password (stored securely)')
            .addText(text => {
                text.setPlaceholder('Enter password')
                    .setValue(this.plugin.settings.syncPassword)
                    .onChange(async (value) => {
                        this.plugin.settings.syncPassword = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
                return text;
            });

        new Setting(containerEl)
            .setName('Test sync')
            .setDesc('Validate connection and run a one-time sync check from settings')
            .setDisabled(!this.plugin.settings.usePouchDB)
            .addButton((btn) => btn
                .setButtonText('Run test')
                .onClick(async () => {
                    await this.testSyncConnection();
                }));
        
        if (this.plugin.settings.syncEnabled && this.plugin.dataManager.getPouchDB()) {
            new Setting(containerEl)
                .setName('Sync status')
                .setDesc('Check your current sync status')
                .addButton(btn => btn
                    .setButtonText('Check status')
                    .onClick(async () => {
                        const pouchDB = this.plugin.dataManager.getPouchDB();
                        if (pouchDB) {
                            const status = await pouchDB.getSyncStatus();
                            const info = await pouchDB.getDatabaseInfo();
                            const docCount = getDocCount(info);
                            new Notice(`Sync status: ${status.enabled ? 'Active' : 'Inactive'}\nDocs: ${docCount}\nLast sync: ${status.lastSyncTime || 'Never'}`, 10000);
                        }
                    }));
        }
        
        new Setting(containerEl)
            .setName('Deck tag')
            .setDesc('The tag used to identify deck files (for example, "flashcards" for #flashcards).')
            .addText((text) => text
                .setPlaceholder('Flashcards')
                .setValue(this.plugin.settings.deckTag)
                .onChange(async (value) => {
                    this.plugin.settings.deckTag = value.trim();
                    await this.plugin.saveSettings();
                    await this.plugin.dataManager.buildIndex();
                    this.plugin.refreshDashboardView();
                }));

        new Setting(containerEl).setName('Global review defaults').setHeading();

        new Setting(containerEl)
            .setName('Max new cards per day')
            .setDesc('Applies to all decks.')
            .addText((text) => text
                .setValue(this.plugin.settings.newCardsPerDay.toString())
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.newCardsPerDay = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Max reviews per day')
            .setDesc('Applies to all decks.')
            .addText((text) => text
                .setValue(this.plugin.settings.reviewsPerDay.toString())
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.reviewsPerDay = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl).setName('Appearance').setHeading();

        new Setting(containerEl)
            .setName('Review font size')
            .addSlider((slider) => slider
                .setLimits(12, 32, 1)
                .setValue(this.plugin.settings.fontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.fontSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('FSRS parameters').setHeading();
        containerEl.createEl('p', {
            text: 'These settings control the scheduling algorithm. Change them only if you know what you are doing.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Reset FSRS parameters')
            .setDesc('Reset to FSRS defaults.')
            .addButton((btn) => btn
                .setButtonText('Reset')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.fsrsParams = generatorParameters();
                    await this.plugin.saveSettings();
                    this.plugin.dataManager.updateFsrsParameters(this.plugin.settings.fsrsParams);
                    this.display();
                }));

        new Setting(containerEl)
            .setName('Request retention')
            .setDesc('The desired retention rate (0.7 to 0.99).')
            .addText((text) => text
                .setValue(this.plugin.settings.fsrsParams.request_retention.toString())
                .onChange(async (value) => {
                    const num = parseFloat(value);
                    if (!isNaN(num) && num > 0 && num < 1) {
                        this.plugin.settings.fsrsParams.request_retention = num;
                        await this.plugin.saveSettings();
                        this.plugin.dataManager.updateFsrsParameters(this.plugin.settings.fsrsParams);
                    }
                }));

        new Setting(containerEl)
            .setName('Maximum interval')
            .setDesc('The maximum number of days between reviews.')
            .addText((text) => text
                .setValue(this.plugin.settings.fsrsParams.maximum_interval.toString())
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.fsrsParams.maximum_interval = num;
                        await this.plugin.saveSettings();
                        this.plugin.dataManager.updateFsrsParameters(this.plugin.settings.fsrsParams);
                    }
                }));

        new Setting(containerEl)
            .setName('FSRS weights')
            .setDesc('Comma-separated FSRS weights (17 values).')
            .addTextArea((text) => {
                text.setValue(this.plugin.settings.fsrsParams.w.join(', '))
                    .onChange(async (value) => {
                        try {
                            const weights = value.split(',').map((entry) => parseFloat(entry.trim()));
                            if (weights.length === 17 && weights.every((weight) => !isNaN(weight))) {
                                this.plugin.settings.fsrsParams.w = weights;
                                await this.plugin.saveSettings();
                                this.plugin.dataManager.updateFsrsParameters(this.plugin.settings.fsrsParams);
                            }
                        } catch (error: unknown) {
                            console.error('Invalid FSRS weights format', error);
                        }
                    });
                text.inputEl.rows = 5;
                text.inputEl.addClass('fsrs-weights-textarea');
            });

        new Setting(containerEl).setName('About').setHeading();

        new Setting(containerEl)
            .setName('Lemma')
            .setDesc(`v${this.plugin.manifest.version} by Sapienskid — FSRS-based spaced repetition flashcards.`);

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('Quick reference')
                .setCta()
                .onClick(() => new HelpModal(this.app, this.plugin).open()))
            .addButton(btn => btn
                .setButtonText('Report issue')
                .onClick(() => window.open('https://github.com/sapienskid/Lemma/issues', '_blank')));
    }
    
    async migrateData() {
        const pouchDB = this.plugin.dataManager.getPouchDB();
        if (!pouchDB) {
            new Notice('PouchDB is not enabled');
            return;
        }
        
        try {
            new Notice('Starting migration... This may take a while for large collections.');
            
            // Load legacy data
            const legacyData = (await this.plugin.loadData()) as LegacyPluginData | null;
            if (!legacyData) {
                new Notice('No legacy data found to migrate');
                return;
            }
            
            // Build deck mapping
            const deckMapping: Record<string, { deckId: string; filePath: string }> = {};
            for (const card of this.plugin.dataManager.getAllCards()) {
                deckMapping[card.id] = {
                    deckId: card.deckId,
                    filePath: card.filePath
                };
            }
            
            // Perform migration
            const migration = new DataMigration(pouchDB);
            await migration.migrateFromLegacy(legacyData, deckMapping);
            
            // Verify migration
            const verification = await migration.verifyMigration(legacyData);
            
            if (verification.success) {
                new Notice(`Migration successful! Migrated ${verification.stats.migratedCards} cards and ${verification.stats.migratedLogs} reviews.`);
                this.plugin.settings.usePouchDB = true;
                await this.plugin.saveSettings();
                this.display();
            } else {
                new Notice(`Migration completed with errors: ${verification.errors.join(', ')}`, 10000);
            }
            
        } catch (error) {
            console.error('Migration failed:', error);
            new Notice(`Migration failed: ${getErrorMessage(error)}`);
        }
    }
    
    async setupSync() {
        const pouchDB = this.plugin.dataManager.getPouchDB();
        if (!pouchDB) {
            new Notice('PouchDB is not enabled');
            return;
        }
        
        if (!this.plugin.settings.syncUrl) {
            new Notice('Please enter a CouchDB server URL first');
            return;
        }
        
        if (!this.plugin.settings.syncUsername || !this.plugin.settings.syncPassword) {
            new Notice('Please enter both username and password');
            return;
        }
        
        try {
            new Notice('Setting up sync...');
            const syncUrl = this.buildAuthenticatedUrl(
                this.plugin.settings.syncUrl,
                this.plugin.settings.syncDbName,
                this.plugin.settings.syncUsername,
                this.plugin.settings.syncPassword
            );
            await pouchDB.setupSync(syncUrl);
            new Notice('Sync enabled successfully!');
        } catch (error) {
            console.error('Sync setup failed:', error);
            new Notice(`Sync setup failed: ${getErrorMessage(error)}`);
            this.plugin.settings.syncEnabled = false;
            await this.plugin.saveSettings();
        }
    }

    async testSyncConnection() {
        const pouchDB = this.plugin.dataManager.getPouchDB();
        if (!pouchDB) {
            new Notice('PouchDB is not enabled');
            return;
        }

        if (!this.plugin.settings.syncUrl) {
            new Notice('Please enter a CouchDB server URL first');
            return;
        }

        try {
            new Notice('Testing sync connection...');
            const syncUrl = this.buildAuthenticatedUrl(
                this.plugin.settings.syncUrl,
                this.plugin.settings.syncDbName,
                this.plugin.settings.syncUsername,
                this.plugin.settings.syncPassword
            );

            const { remoteInfo, localInfo } = await pouchDB.testConnection(syncUrl);
            const localDocCount = getDocCount(localInfo);
            const remoteDocCount = getDocCount(remoteInfo);

            let syncMessage = 'Connection check only (sync is disabled).';
            if (this.plugin.settings.syncEnabled) {
                await pouchDB.setupSync(syncUrl);
                await pouchDB.manualSync();
                syncMessage = 'Manual sync check passed.';
            }

            new Notice(
                `Sync test passed.\nLocal docs: ${localDocCount}\nRemote docs: ${remoteDocCount}\n${syncMessage}`,
                10000
            );
        } catch (error) {
            console.error('Sync test failed:', error);
            new Notice(`Sync test failed: ${getErrorMessage(error)}`, 8000);
        }
    }
    
    private buildAuthenticatedUrl(url: string, dbName: string, username: string, password: string): string {
        try {
            const urlObj = new URL(url.trim());
            const cleanDbName = dbName.trim().replace(/^\/+|\/+$/g, '');
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);

            if (cleanDbName) {
                const lastSegment = pathSegments[pathSegments.length - 1];
                if (lastSegment !== cleanDbName) {
                    pathSegments.push(cleanDbName);
                }
            }

            urlObj.pathname = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/';

            if (username) {
                urlObj.username = sanitizeCredentialForUrl(username);
            }
            if (password) {
                urlObj.password = sanitizeCredentialForUrl(password);
            }

            return urlObj.toString();
        } catch (error) {
            console.error('Failed to build authenticated URL:', error);
            return url;
        }
    }
}

// --- MAIN PLUGIN CLASS ---
export default class FSRSFlashcardsPlugin extends Plugin {
    settings: FSRSSettings; dataManager: DataManager;
    async onload() {
        console.debug('Loading Lemma plugin');
        this.addStyle();
        await this.loadSettings();
        this.dataManager = new DataManager(this);
        
        this.app.workspace.onLayoutReady(async () => {
            await this.dataManager.load();
            
            // Initialize sync if enabled
            await this.dataManager.initializeSync();
            
            this.refreshDashboardView();
        });
        
        this.addSettingTab(new FSRSSettingsTab(this.app, this));
        this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
        const statusButton = this.addStatusBarItem();
        statusButton.addClass('lemma-status-button');
        statusButton.setAttribute('aria-label', 'Open Lemma dashboard');
        statusButton.setAttribute('title', 'Open Lemma dashboard');
        const statusIcon = statusButton.createSpan({ cls: 'lemma-status-icon' });
        setIcon(statusIcon, STATUS_ICON_NAME);
        statusButton.createSpan({ text: 'Lemma', cls: 'lemma-status-label' });
        statusButton.addEventListener('click', () => {
            void this.activateView();
        });
        this.addCommand({ id: 'add-fsrs-flashcard', name: 'Add a new flashcard', editorCallback: (editor: Editor) => { const blockId = generateBlockId(); const template = `\n\n---card--- ^${blockId}\n\n---\n\n`; const cursor = editor.getCursor(); editor.replaceRange(template, cursor); editor.setCursor({ line: cursor.line + 3, ch: 0 }); } });
        this.addCommand({
            id: 'open-fsrs-dashboard',
            name: 'Open dashboard',
            callback: () => {
                void this.activateView();
            }
        });
        
        // Add sync commands
        if (this.settings.usePouchDB) {
            this.addCommand({
                id: 'sync-now',
                name: 'Sync now',
                callback: async () => {
                    if (!this.settings.syncEnabled) {
                        new Notice('Sync is not enabled. Enable it in settings.');
                        return;
                    }
                    if (!this.settings.syncUrl) {
                        new Notice('Sync URL not configured. Set it in settings.');
                        return;
                    }
                    new Notice('Syncing...');
                    await this.dataManager.initializeSync();
                }
            });
            
            this.addCommand({
                id: 'check-sync-status',
                name: 'Check sync status',
                callback: async () => {
                    const pouchDB = this.dataManager.getPouchDB();
                    if (!pouchDB) {
                        new Notice('PouchDB is not enabled');
                        return;
                    }
                    const status = await pouchDB.getSyncStatus();
                    const info = await pouchDB.getDatabaseInfo();
                    const docCount = getDocCount(info);
                    new Notice(`Sync status:\n${status.enabled ? '✓ Active' : '✗ Inactive'}\nURL: ${status.remoteUrl || 'Not set'}\nDocuments: ${docCount}\nLast sync: ${status.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString() : 'Never'}`, 10000);
                }
            });
        }
        
        // Nuclear option: Reset all card progress
        this.addCommand({
            id: 'reset-all-card-progress',
            name: 'Reset all card progress (nuclear option)',
            callback: async () => {
                new ResetProgressModal(this.app, this).open();
            }
        });
        
        const debouncedRefresh = debounce(() => { this.dataManager.recalculateAllDeckStats(); this.refreshDashboardView(); }, 500, true);
        const updateAndRefresh = async (file: TFile) => { await this.dataManager.updateFile(file); debouncedRefresh(); };
        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof TFile) {
                void updateAndRefresh(file);
            }
        }));
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file instanceof TFile) {
                void updateAndRefresh(file);
            }
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile) {
                this.dataManager.removeDeck(this.dataManager['getDeckId'](file.path));
                debouncedRefresh();
            }
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) {
                void this.dataManager.renameDeck(file, oldPath).then(() => {
                    debouncedRefresh();
                });
            }
        }));
        
        // Refresh dashboard view to ensure sync button appears if enabled
        this.refreshDashboardView();
    }
    onunload() {
        // Stop sync gracefully.
        void this.dataManager.stopSync().catch((error: unknown) => {
            console.error('Failed to stop sync during unload:', error);
        });

        this.removeStyle();
    }
    addStyle() {
        // Styles are loaded from styles.css by Obsidian.
    }
    removeStyle() {
    }
    async loadSettings() {
        const data = (await this.loadData()) as PluginData | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.settings.fsrsParams = Object.assign({}, DEFAULT_SETTINGS.fsrsParams, this.settings.fsrsParams);
    }
    async saveSettings() { 
        // Save settings to data.json
        const data = (await this.loadData()) as PluginData | null;
        await this.saveData({ 
            settings: this.settings, 
            cardData: data?.cardData || {},
            reviewHistory: data?.reviewHistory || []
        });
    }
    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];

        if (leaf) {
            await workspace.revealLeaf(leaf);
            return;
        }

        leaf = workspace.getRightLeaf(false) || workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
        await workspace.revealLeaf(leaf);
    }
    refreshDashboardView() { const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0]; if (leaf?.view instanceof DashboardView) { (leaf.view).render(); } }
}
