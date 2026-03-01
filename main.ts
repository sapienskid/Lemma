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
const ICON_NAME = 'book-heart';

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
interface CardData { id: string; deckId: string; filePath: string; type: CardType; originalText: string; front: string; back: string; }
type FSRSData = FSRSCard;
interface Card extends CardData { fsrsData?: FSRSData; }
interface Deck { id: string; title: string; filePath: string; cardIds: Set<string>; stats: { new: number; due: number; learning: number; }; }
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
                    console.error('Sync error:', err);
                    new Notice(`Sync error: ${getErrorMessage(err)}`, 5000);
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
            // Ensure URL ends with /
            if (!url.endsWith('/')) {
                url += '/';
            }
            
            const urlObj = new URL(url);
            
            // Append database name
            // Remove leading slash from dbName if present to avoid double slashes
            const cleanDbName = dbName.startsWith('/') ? dbName.substring(1) : dbName;
            
            // If pathname is just /, replace it. If it has a path, append to it.
            if (urlObj.pathname === '/' || urlObj.pathname === '') {
                 urlObj.pathname = '/' + cleanDbName;
            } else if (!urlObj.pathname.endsWith('/' + cleanDbName)) {
                 // Avoid appending if already present
                 if (urlObj.pathname.endsWith('/')) {
                     urlObj.pathname += cleanDbName;
                 } else {
                     urlObj.pathname += '/' + cleanDbName;
                 }
            }
            
            if (username && password) {
                urlObj.username = encodeURIComponent(username);
                urlObj.password = encodeURIComponent(password);
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
    getViewType(): string { return VIEW_TYPE_DASHBOARD; } getDisplayText(): string { return 'Lemma decks'; } getIcon(): string { return ICON_NAME; }
    async onOpen() { this.render(); }
    render() { 
        this.contentEl.empty(); 
        this.contentEl.setCssProps({ 'padding': "var(--size-4-4)" }); 
        
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
        
        // Quick actions row - full width buttons
        const actionsRow = headerEl.createDiv({ cls: 'fsrs-quick-actions' });
        
        // Study All button (primary)
        const studyAllBtn = actionsRow.createEl('button', { cls: 'fsrs-action-btn fsrs-action-primary' });
        const studyAllIcon = studyAllBtn.createDiv({ cls: 'fsrs-action-icon' });
        setIcon(studyAllIcon, 'play');
        studyAllBtn.createSpan({ text: 'Study all due', cls: 'fsrs-action-text' });
        const dueCount = this.plugin.dataManager.getDecks().reduce((acc, d) => acc + d.stats.due, 0);
        if (dueCount > 0) {
            studyAllBtn.createEl('span', { text: dueCount.toString(), cls: 'fsrs-action-badge' });
        }
        studyAllBtn.addEventListener('click', () => {
            const allDueCards = this.plugin.dataManager.getDecks()
                .flatMap(d => this.plugin.dataManager.getReviewQueue(d.id))
                .filter((c, i, arr) => arr.indexOf(c) === i);
            if (allDueCards.length === 0) {
                new Notice('No cards due for review!');
                return;
            }
            new ReviewModal(this.app, this.plugin, allDueCards).open();
        });
        
        // Stats button
        const statsBtn = actionsRow.createEl('button', { cls: 'fsrs-action-btn fsrs-action-secondary' });
        const statsIcon = statsBtn.createDiv({ cls: 'fsrs-action-icon' });
        setIcon(statsIcon, 'bar-chart-2');
        statsBtn.createSpan({ text: 'Statistics', cls: 'fsrs-action-text' });
        statsBtn.addEventListener('click', () => new StatsModal(this.app, this.plugin).open());
        
        // Custom study button
        const customBtn = actionsRow.createEl('button', { cls: 'fsrs-action-btn fsrs-action-secondary' });
        const customIcon = customBtn.createDiv({ cls: 'fsrs-action-icon' });
        setIcon(customIcon, 'filter');
        customBtn.createSpan({ text: 'Custom Study', cls: 'fsrs-action-text' });
        customBtn.addEventListener('click', () => new CustomStudyModal(this.app, this.plugin).open());
        
        // Refresh button
        const refreshBtn = actionsRow.createEl('button', { cls: 'fsrs-action-btn fsrs-action-icon-only' });
        const refreshIcon = refreshBtn.createDiv({ cls: 'fsrs-action-icon' });
        setIcon(refreshIcon, 'refresh-cw');
        refreshBtn.setAttribute('aria-label', 'Refresh');
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
            const syncBtn = actionsRow.createEl('button', { cls: 'fsrs-action-btn fsrs-action-icon-only' });
            const syncIcon = syncBtn.createDiv({ cls: 'fsrs-action-icon' });
            setIcon(syncIcon, 'cloud');
            syncBtn.setAttribute('aria-label', 'Sync');
            syncBtn.addEventListener('click', () => {
                void (async () => {
                    if (pouchDB.isSyncing()) {
                        new Notice('Sync in progress...');
                        return;
                    }
                    syncBtn.addClass('is-loading');
                    try {
                        await pouchDB.manualSync();
                        new Notice('Sync completed!', 3000);
                    } catch (error: unknown) {
                        new Notice(`Sync failed: ${getErrorMessage(error)}`, 5000);
                    } finally {
                        syncBtn.removeClass('is-loading');
                    }
                })();
            });
        }
        
        // Stats cards row
        const decks = this.plugin.dataManager.getDecks();
        const globalStats = decks.reduce((acc, deck) => { 
            acc.new += deck.stats.new; 
            acc.due += deck.stats.due; 
            acc.total += deck.cardIds.size; 
            return acc; 
        }, { new: 0, due: 0, total: 0 });
        
        const statsCards = headerEl.createDiv({ cls: 'fsrs-stats-cards' });
        
        const createStatCard = (icon: string, value: string, label: string, variant: string) => {
            const card = statsCards.createDiv({ cls: `fsrs-stat-card fsrs-stat-${variant}` });
            const iconEl = card.createDiv({ cls: 'fsrs-stat-card-icon' });
            setIcon(iconEl, icon);
            const content = card.createDiv({ cls: 'fsrs-stat-card-content' });
            content.createEl('div', { text: value, cls: 'fsrs-stat-card-value' });
            content.createEl('div', { text: label, cls: 'fsrs-stat-card-label' });
        };
        
        createStatCard('layers', globalStats.total.toString(), 'Total cards', 'neutral');
        createStatCard('clock', globalStats.due.toString(), 'Due today', 'due');
        createStatCard('sparkles', globalStats.new.toString(), 'New cards', 'new');
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
        decksContainer.setCssProps({ 'display': 'none' });
        
        // Toggle collapse/expand (default to collapsed)
        let isCollapsed = true;
        folderHeader.addClass('is-collapsed');
        
        const toggleFolder = () => {
            isCollapsed = !isCollapsed;
            folderHeader.toggleClass('is-collapsed', isCollapsed);
            folderHeader.toggleClass('is-expanded', !isCollapsed);
            folderHeader.setAttribute('aria-expanded', (!isCollapsed).toString());
            decksContainer.setCssProps({ 'display': isCollapsed ? 'none' : 'block' });
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
        const total = deck.cardIds.size;
        const hasDue = deck.stats.due > 0;
        
        // Modern deck card
        const deckCard = container.createDiv({ cls: 'fsrs-deck-card' });
        
        // Card header with icon and title
        const cardHeader = deckCard.createDiv({ cls: 'fsrs-deck-card-header' });
        
        // File icon
        const iconEl = cardHeader.createDiv({ cls: 'fsrs-deck-card-icon' });
        setIcon(iconEl, hasDue ? 'file-clock' : 'file-text');
        if (hasDue) {
            iconEl.addClass('has-due');
        }
        
        // Title and info
        const infoEl = cardHeader.createDiv({ cls: 'fsrs-deck-card-info' });
        infoEl.createEl('div', { text: deck.title, cls: 'fsrs-deck-card-title' });
        
        const statsEl = infoEl.createDiv({ cls: 'fsrs-deck-card-stats' });
        statsEl.createEl('span', { 
            text: `${deck.stats.due} due`, 
            cls: `fsrs-stat-due ${deck.stats.due > 0 ? 'has-due' : ''}` 
        });
        statsEl.createEl('span', { text: `${deck.stats.new} new`, cls: 'fsrs-stat-new' });
        statsEl.createEl('span', { text: `${total} total`, cls: 'fsrs-stat-total' });
        
        // Click to open deck note
        cardHeader.addEventListener('click', () => {
            void this.app.workspace.openLinkText(deck.filePath, deck.filePath);
        });
        
        // Actions - full width buttons
        const actionsEl = deckCard.createDiv({ cls: 'fsrs-deck-card-actions' });
        
        // Study button (full width)
        const studyBtn = actionsEl.createEl('button', { 
            cls: `fsrs-deck-btn fsrs-deck-btn-study ${hasDue ? 'has-due' : 'no-due'}` 
        });
        const studyIcon = studyBtn.createDiv({ cls: 'fsrs-btn-icon' });
        setIcon(studyIcon, 'play');
        studyBtn.createSpan({ text: hasDue ? `Study ${deck.stats.due}` : 'Study', cls: 'fsrs-btn-text' });
        studyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const queue = this.plugin.dataManager.getReviewQueue(deck.id);
            if (queue.length === 0) {
                new Notice('No cards to review in this deck!');
                return;
            }
            new ReviewModal(this.app, this.plugin, queue, deck.title).open();
        });
        
        // Secondary actions row
        const secondaryActions = actionsEl.createDiv({ cls: 'fsrs-deck-secondary-actions' });
        
        // Cram button
        const cramBtn = secondaryActions.createEl('button', { cls: 'fsrs-deck-btn fsrs-deck-btn-cram' });
        const cramIcon = cramBtn.createDiv({ cls: 'fsrs-btn-icon' });
        setIcon(cramIcon, 'zap');
        cramBtn.createSpan({ text: 'Cram', cls: 'fsrs-btn-text' });
        cramBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const queue = this.plugin.dataManager.getAllCardsForStudy(deck.id);
            if (queue.length === 0) {
                new Notice('No cards in this deck!');
                return;
            }
            new Notice(`Cram Mode: Studying all ${queue.length} cards`);
            new ReviewModal(this.app, this.plugin, queue, deck.title).open();
        });
        
        // Browse button
        const browseBtn = secondaryActions.createEl('button', { cls: 'fsrs-deck-btn fsrs-deck-btn-browse' });
        const browseIcon = browseBtn.createDiv({ cls: 'fsrs-btn-icon' });
        setIcon(browseIcon, 'list');
        browseBtn.createSpan({ text: 'Browse', cls: 'fsrs-btn-text' });
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
        this.contentEl.setCssProps({ 'overflow': 'hidden' });
        this.titleEl.setText(`Browsing: ${this.deckName}`);
        this.setupUI();
        void this.displayCurrentCard();
        this.scope.register([], 'keydown', (evt: KeyboardEvent) => this.handleKeyPress(evt));
    }
private setupUI() {
        const container = this.contentEl.createDiv({ cls: 'fsrs-review-container' });
        container.setCssProps({ 'display': 'flex' });
        container.setCssProps({ 'align-items': 'center' });
        container.setCssProps({ 'gap': 'var(--size-4-4)' });
        container.setCssProps({ 'height': '100%' });

        const leftControl = container.createDiv();
        this.prevButton = new ButtonComponent(leftControl)
            .setIcon('arrow-left')
            .setTooltip('Previous card (left arrow)')
            .onClick(() => this.showPrevCard());

        const cardWrapper = container.createDiv();
        cardWrapper.setCssProps({ 'flex': '1' });
        cardWrapper.setCssProps({ 'overflow-y': 'auto' });
        cardWrapper.setCssProps({ 'max-height': '100%' });

        this.cardContainer = cardWrapper.createDiv({ cls: 'fsrs-review-card' });
        this.cardContainer.setCssProps({ 'font-size': `${this.plugin.settings.fontSize}px` });
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
        this.contentEl.setCssProps({ 'overflow': 'hidden' });
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
        this.modalEl.find('.modal-title').setCssProps({ 'cursor': 'help' });

        const headerControls = this.modalEl.querySelector('.modal-header-controls');
        if (headerControls) {
            const editBtn = headerControls.createDiv({ cls: 'modal-close-button' });
            setIcon(editBtn, 'edit');
            editBtn.setAttribute('aria-label', 'Edit this card');
            editBtn.addEventListener('click', () => {
                void this.app.workspace.openLinkText(card.filePath, card.filePath);
                this.close();
            });
            headerControls.prepend(editBtn);
        }

        const container = this.contentEl.createDiv({ cls: 'fsrs-review-container' });
        container.setCssProps({ 'display': 'flex' });
        container.setCssProps({ 'flex-direction': 'column' });
        container.setCssProps({ 'height': '100%' });

        this.cardContainer = container.createDiv({ cls: 'fsrs-review-card' });
        this.cardContainer.setCssProps({ 'flex': '1 1 auto' });
        this.cardContainer.setCssProps({ 'overflow-y': 'auto' });
        this.cardContainer.setCssProps({ 'font-size': `${this.plugin.settings.fontSize}px` });

        this.frontEl = this.cardContainer.createDiv({ cls: 'fsrs-card-front' });
        this.answerContainer = this.cardContainer.createDiv({ cls: 'fsrs-card-answer' });
        this.answerContainer.setCssProps({ 'display': 'none' });
        this.answerContainer.createEl('hr');
        this.backEl = this.answerContainer.createDiv({ cls: 'fsrs-card-back' });

        const bottomControlsContainer = container.createDiv({ cls: 'fsrs-bottom-controls' });
        bottomControlsContainer.setCssProps({ 'flex': '0 0 auto' });
        bottomControlsContainer.setCssProps({ 'padding-top': 'var(--size-4-4)' });

        this.showAnswerButton = new ButtonComponent(bottomControlsContainer)
            .setButtonText('Show answer')
            .setCta()
            .onClick(() => this.showAnswer());
        this.showAnswerButton.buttonEl.addClass('fsrs-show-answer-btn');
        this.showAnswerButton.buttonEl.setCssProps({ 'width': '100%' });
        this.showAnswerButton.buttonEl.setCssProps({ 'margin-bottom': 'var(--size-4-4)' });
        this.showAnswerButton.buttonEl.setCssProps({ 'padding': 'var(--size-4-2) var(--size-4-4)' });

        this.controlsContainer = bottomControlsContainer.createDiv({ cls: 'fsrs-review-controls' });
        this.controlsContainer.setCssProps({ 'margin-top': 'var(--size-4-4)' });
        this.controlsContainer.setCssProps({ 'display': 'none' });
    }
    private createControlButtons() {
        this.controlsContainer.empty();
        this.controlsContainer.setCssProps({ 'display': 'grid' });
        this.controlsContainer.setCssProps({ 'grid-template-columns': 'repeat(4, 1fr)' });
        this.controlsContainer.setCssProps({ 'gap': 'var(--size-4-2)' });
        const card = this.getCurrentCard();
        const intervals = this.plugin.dataManager.getNextReviewIntervals(card);
        
        const createButton = (text: string, rating: Rating, interval: string, modifierClass?: string) => {
            const btn = new ButtonComponent(this.controlsContainer)
                .onClick(() => this.handleRating(rating));
            btn.buttonEl.addClass('fsrs-rating-btn');
            btn.buttonEl.setCssProps({ 'flex-direction': 'column' });
            btn.buttonEl.setCssProps({ 'height': 'auto' });
            btn.buttonEl.setCssProps({ 'padding': 'var(--size-4-3)' });
            btn.buttonEl.setCssProps({ 'gap': '4px' });
            
            btn.buttonEl.createEl('strong', { 
                text,
                cls: 'fsrs-rating-text'
            });
            
            btn.buttonEl.createEl('small', { 
                text: interval, 
                cls: 'fsrs-interval-hint' 
            });
            
            if (modifierClass) {
                btn.buttonEl.addClass(modifierClass);
            }
            
            return btn;
        };
        
        createButton('Again', Rating.Again, intervals[Rating.Again], 'mod-warning');
        createButton('Hard', Rating.Hard, intervals[Rating.Hard], 'mod-secondary');
        createButton('Good', Rating.Good, intervals[Rating.Good], 'mod-cta');
        createButton('Easy', Rating.Easy, intervals[Rating.Easy]);
    }
    private async showNextCard() {
        if (this.currentCardIndex >= this.queue.length) { this.showCompletionScreen(); return; }
        this.state = 'question';
        const card = this.getCurrentCard();
        const deckPrefix = this.deckName ? `${this.deckName} • ` : '';
        this.titleEl.setText(`${deckPrefix}Reviewing (${this.currentCardIndex + 1}/${this.queue.length})`);
        this.frontEl.empty();
        this.backEl.empty();
        await MarkdownRenderer.render(this.app, card.front, this.frontEl, card.filePath, this.renderComponent);
        await MarkdownRenderer.render(this.app, card.back, this.backEl, card.filePath, this.renderComponent);

        this.showAnswerButton.buttonEl.setCssProps({ 'display': 'block' });
        this.controlsContainer.setCssProps({ 'display': 'none' });
        this.answerContainer.setCssProps({ 'display': 'none' });
    }
    private showAnswer() {
        if (this.state === 'answer') return;
        this.createControlButtons();
        this.state = 'answer';
        this.showAnswerButton.buttonEl.setCssProps({ 'display': 'none' });
        this.controlsContainer.setCssProps({ 'display': 'grid' });
        this.answerContainer.setCssProps({ 'display': 'block' });
    }
    private handleRating(rating: Rating) {
        this.plugin.dataManager.updateCard(this.getCurrentCard(), rating);
        this.currentCardIndex++;
        this.cardContainer.setCssProps({ 'transition': 'opacity 0.2s ease-in-out' });
        this.cardContainer.setCssProps({ 'opacity': '0' });
        setTimeout(() => {
            void this.showNextCard();
            this.cardContainer.setCssProps({ 'opacity': '1' });
        }, 200);
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
        
        const activityCanvas = activityCard.createEl('canvas', { cls: 'fsrs-chart-canvas' });
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
        
        const forecastCanvas = forecastCard.createEl('canvas', { cls: 'fsrs-chart-canvas' });
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
        warningContainer.setCssProps({ 'background-color': 'var(--background-modifier-error)' });
        warningContainer.setCssProps({ 'padding': 'var(--size-4-4)' });
        warningContainer.setCssProps({ 'border-radius': 'var(--radius-m)' });
        warningContainer.setCssProps({ 'margin-bottom': 'var(--size-4-4)' });
        
        warningContainer.createEl('h3', { 
            text: 'Warning: this action cannot be undone.',
            attr: { style: 'color: var(--text-error); margin-top: 0;' }
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
        statsContainer.setCssProps({ 'margin-bottom': 'var(--size-4-4)' });
        
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
        ; 
        
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
                    
                    if (value && this.plugin.dataManager['pouchDB']) {
                        await this.setupSync();
                    } else if (!value && this.plugin.dataManager['pouchDB']) {
                        await this.plugin.dataManager['pouchDB'].stopSync();
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
        
        if (this.plugin.settings.syncEnabled && this.plugin.dataManager['pouchDB']) {
            new Setting(containerEl)
                .setName('Sync status')
                .setDesc('Check your current sync status')
                .addButton(btn => btn
                    .setButtonText('Check status')
                    .onClick(async () => {
                        const pouchDB = this.plugin.dataManager['pouchDB'];
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
                text.inputEl.setCssProps({ 'width': '100%' });
            });
    }
    
    async migrateData() {
        const pouchDB = this.plugin.dataManager['pouchDB'];
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
        const pouchDB = this.plugin.dataManager['pouchDB'];
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
    
    private buildAuthenticatedUrl(url: string, dbName: string, username: string, password: string): string {
        try {
            // Ensure URL ends with /
            if (!url.endsWith('/')) {
                url += '/';
            }
            
            const urlObj = new URL(url);
            
            // Append database name
            // Remove leading slash from dbName if present to avoid double slashes
            const cleanDbName = dbName.startsWith('/') ? dbName.substring(1) : dbName;
            
            // If pathname is just /, replace it. If it has a path, append to it.
            if (urlObj.pathname === '/' || urlObj.pathname === '') {
                 urlObj.pathname = '/' + cleanDbName;
            } else if (!urlObj.pathname.endsWith('/' + cleanDbName)) {
                 // Avoid appending if already present
                 if (urlObj.pathname.endsWith('/')) {
                     urlObj.pathname += cleanDbName;
                 } else {
                     urlObj.pathname += '/' + cleanDbName;
                 }
            }
            
            if (username && password) {
                urlObj.username = encodeURIComponent(username);
                urlObj.password = encodeURIComponent(password);
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
