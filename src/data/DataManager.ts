import { FSRS, Rating, State, createEmptyCard, type Card as FSRSCard } from 'ts-fsrs';
import { Notice, TFile } from 'obsidian';
import type { Card, Deck, FSRSData, FSRSParameters, Gamification, NoteReviewData, PluginData, ReviewLog } from './types';
import { isRecord, toStringArray, cyrb53hex, getDocsWritten, getErrorMessage, isLikelyCorsOrNetworkErrorMessage, buildAuthenticatedUrl } from './constants';
import { PouchDBManager } from '../database/PouchDBManager';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class DataManager {
    private plugin: FSRSFlashcardsPlugin;
    private fsrs: FSRS;
    private decks: Map<string, Deck> = new Map();
    private cards: Map<string, Card> = new Map();
    private fsrsDataStore: Record<string, FSRSData> = {};
    private noteReviews: Map<string, NoteReviewData> = new Map();
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
        if (this.plugin.settings.syncEnabled
            && this.plugin.settings.syncUrl
            && this.pouchDB) {
            try {
                const syncUrl = buildAuthenticatedUrl(
                    this.plugin.settings.syncUrl,
                    this.plugin.settings.syncDbName,
                    this.plugin.settings.syncUsername,
                    this.plugin.settings.syncPassword,
                );
                console.debug('Initializing sync with:', this.sanitizeUrl(syncUrl));

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

        this.fsrsDataStore = await this.pouchDB.getAllCardStates();

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
        await this.plugin.saveData({
            settings: this.plugin.settings,
            cardData: this.plugin.settings.usePouchDB ? {} : this.fsrsDataStore,
            reviewHistory: this.plugin.settings.usePouchDB ? [] : this.reviewHistory,
        });
    }

    updateFsrsParameters(params: FSRSParameters) {
        this.fsrs = new FSRS(params);
    }

    async buildIndex() {
        console.debug('FSRS: Building index...');
        this.decks.clear();
        this.cards.clear();
        this.noteReviews.clear();
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            await this.updateFile(file);
        }
        this.recalculateAllDeckStats();
        console.debug(`FSRS: Index complete. Found ${this.decks.size} decks and ${this.cards.size} cards.`);
    }

    getDeckId(path: string): string {
        return cyrb53hex(path);
    }

    private getHeadingContext(content: string, cardIndex: number): string | undefined {
        const lines = content.split('\n');
        const headingStack: string[] = [];
        let foundContext: string | undefined;

        for (let i = 0; i < Math.min(cardIndex, lines.length); i++) {
            const line = lines[i];
            const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const text = headingMatch[2].trim();
                while (headingStack.length >= level) {
                    headingStack.pop();
                }
                headingStack.push(text);
            }
        }

        if (headingStack.length > 0) {
            foundContext = headingStack.join(' > ');
        }

        return foundContext;
    }

    async updateFile(file: TFile) {
        const deckId = this.getDeckId(file.path);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const deckTag = `#${this.plugin.settings.deckTag}`;
        const reviewTag = '#review';
        const frontmatter = isRecord(cache?.frontmatter) ? cache.frontmatter : null;
        const frontmatterTags = frontmatter ? toStringArray(frontmatter.tags) : [];
        const allTags = (cache?.tags ?? []).map(t => t.tag.toLowerCase());
        const allFrontmatterTags = frontmatterTags.map(t => `#${t.toLowerCase()}`);

        // Check for deck tag
        const isDeck = allTags.includes(deckTag) || allFrontmatterTags.includes(deckTag);
        this.removeDeck(deckId, false);
        if (isDeck) {
            const title = frontmatter && typeof frontmatter.title === 'string' ? frontmatter.title : file.basename;
            const newDeck: Deck = { id: deckId, title, filePath: file.path, cardIds: new Set(), stats: { new: 0, due: 0, learning: 0 } };
            const content = await this.plugin.app.vault.read(file);
            const lines = content.split('\n');

            this.parseBasicCards(content, lines, file.path, deckId, newDeck);
            this.parseSingleLineCards(content, lines, file.path, deckId, newDeck);
            this.parseClozeCards(content, lines, file.path, deckId, newDeck);

            if (newDeck.cardIds.size > 0) this.decks.set(deckId, newDeck);
        }

        // Check for note review tag
        const isReviewNote = allTags.includes(reviewTag) || allFrontmatterTags.includes(reviewTag);
        if (isReviewNote) {
            const existing = this.noteReviews.get(file.path);
            this.noteReviews.set(file.path, {
                filePath: file.path,
                fsrsData: existing?.fsrsData || this.fsrsDataStore[`note::${file.path}`],
            });
        } else {
            this.noteReviews.delete(file.path);
        }
    }

    private findCardContext(content: string, lines: string[], searchText: string): string | undefined {
        const idx = content.indexOf(searchText);
        if (idx < 0) return undefined;
        const lineNum = content.substring(0, idx).split('\n').length - 1;
        return this.getHeadingContext(content, lineNum);
    }

    private parseSingleLineCards(content: string, lines: string[], filePath: string, deckId: string, newDeck: Deck) {
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Skip lines that are part of ---card--- blocks (inside frontmatter)
            if (trimmed.startsWith('---card---') || trimmed === '---') continue;

            // Skip lines that contain cloze syntax (==c#::)
            if (/==c\d+::/.test(trimmed)) continue;

            // Extract optional block ID from end of line: ^identifier
            const blockIdMatch = trimmed.match(/\s+\^([a-zA-Z0-9-]+)\s*$/);
            const blockId = blockIdMatch ? blockIdMatch[1] : null;
            let cardText = blockIdMatch ? trimmed.slice(0, blockIdMatch.index).trim() : trimmed;

            // Detect ?type flag and strip it
            const isTypeIn = /\?type\b/.test(cardText);
            cardText = cardText.replace(/\?type\b\s*/g, '').trim();

            // Reversed single-line: Q:::A
            const reversedMatch = cardText.match(/^([^:].*?):::(.*)$/);
            if (reversedMatch) {
                const front = reversedMatch[1].trim();
                const back = reversedMatch[2].trim();
                if (!front || !back) continue;

                const rType = isTypeIn ? 'typein' : 'reversed';
                const cardId = blockId
                    ? `${deckId}::${blockId}`
                    : cyrb53hex(`${filePath}::${trimmed}::${rType}`);
                const card: Card = {
                    id: cardId,
                    deckId,
                    filePath,
                    type: rType,
                    originalText: trimmed,
                    front: back,
                    back: front,
                    context: this.getHeadingContext(content, lineIdx),
                    fsrsData: this.fsrsDataStore[cardId],
                };
                this.cards.set(cardId, card);
                newDeck.cardIds.add(cardId);
                continue;
            }

            // Basic single-line: Q::A
            const basicMatch = cardText.match(/^([^:].*?)::(?!:)(.*)$/);
            if (basicMatch) {
                const front = basicMatch[1].trim();
                const back = basicMatch[2].trim();
                if (!front || !back) continue;

                const bType = isTypeIn ? 'typein' : 'basic';
                const cardId = blockId
                    ? `${deckId}::${blockId}`
                    : cyrb53hex(`${filePath}::${trimmed}`);
                const card: Card = {
                    id: cardId,
                    deckId,
                    filePath,
                    type: bType,
                    originalText: trimmed,
                    front,
                    back,
                    context: this.getHeadingContext(content, lineIdx),
                    fsrsData: this.fsrsDataStore[cardId],
                };
                this.cards.set(cardId, card);
                newDeck.cardIds.add(cardId);
            }
        }
    }
    private parseBasicCards(content: string, lines: string[], filePath: string, deckId: string, newDeck: Deck) {
        const basicCardsRaw = content.split(/---\s*card\s*---/i).slice(1);
        for (const cardRaw of basicCardsRaw) {
            const parts = cardRaw.split(/\n---\n/);
            if (parts.length < 2) continue;

            const frontPart = parts[0];
            const backPart = parts.slice(1).join('\n---\n');

            const isTypeIn = /\?type\b/.test(frontPart);
            const cleanFront = frontPart.replace(/\?type\b\s*/g, '').trim();

            const blockIdMatch = cleanFront.match(/\^([a-zA-Z0-9-]+)\s*$/m);
            let cardId: string;
            let front = cleanFront.trim();

            if (blockIdMatch) {
                cardId = `${deckId}::${blockIdMatch[1]}`;
                front = cleanFront.replace(/\^([a-zA-Z0-9-]+)\s*$/m, '').trim();
            } else {
                cardId = cyrb53hex(filePath + '::' + front);
            }

            const back = backPart.trim();
            if (!front || !back) continue;

            const context = this.findCardContext(content, lines, cardRaw);

            const card: Card = {
                id: cardId,
                deckId,
                filePath,
                type: isTypeIn ? 'typein' : 'basic',
                originalText: cardRaw,
                front,
                back,
                context,
                fsrsData: this.fsrsDataStore[cardId],
            };
            this.cards.set(cardId, card);
            newDeck.cardIds.add(cardId);
        }
    }

    private parseClozeCards(content: string, lines: string[], filePath: string, deckId: string, newDeck: Deck) {
        const paragraphs = content.split(/\n\s*\n/);

        for (const paragraph of paragraphs) {
            const clozeRegex = /==c(\d+)::(.*?)==/gs;
            const clozes = [...paragraph.matchAll(clozeRegex)];

            if (clozes.length === 0) continue;

            const blockIdMatch = paragraph.match(/\^([a-zA-Z0-9-]+)\s*$/);

            const context = this.findCardContext(content, lines, paragraph);

            clozes.forEach(cloze => {
                const clozeNum = cloze[1];
                const originalCloze = cloze[0];

                let cardId: string;
                if (blockIdMatch) {
                    cardId = `${deckId}::${blockIdMatch[1]}-${clozeNum}`;
                } else {
                    cardId = cyrb53hex(`${filePath}::${paragraph}::${clozeNum}`);
                }

                const front = paragraph.replace(originalCloze, '[...]');
                const back = paragraph.replace(/==c\d+::(.*?)==/g, '$1');

                const card: Card = {
                    id: cardId,
                    deckId,
                    filePath,
                    type: 'cloze',
                    originalText: paragraph,
                    front,
                    back,
                    context,
                    fsrsData: this.fsrsDataStore[cardId],
                };
                this.cards.set(cardId, card);
                newDeck.cardIds.add(cardId);
            });
        }
    }

    removeDeck(deckId: string, fullDelete: boolean = true) {
        const deck = this.decks.get(deckId);
        if (deck) {
            deck.cardIds.forEach(cardId => {
                this.cards.delete(cardId);
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
                const card = this.cards.get(cardId);
                if (!card || card.deckId !== deck.id) continue;

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

    getDecks(): Deck[] {
        return Array.from(this.decks.values()).sort((a, b) => a.title.localeCompare(b.title));
    }

    getAllCards(): Card[] {
        return Array.from(this.cards.values());
    }

    getReviewHistory(): ReviewLog[] {
        return this.reviewHistory;
    }

    getCardsByDeck(deckId: string): Card[] {
        const deck = this.decks.get(deckId);
        if (!deck) return [];
        return Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => {
                return card !== undefined && card !== null && card.deckId === deckId;
            });
    }

    private getReviewedTodayCount(deckId: string): number {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return this.reviewHistory.filter(log =>
            log.timestamp >= todayStart.getTime() &&
            this.cards.has(log.cardId) &&
            this.cards.get(log.cardId)?.deckId === deckId
        ).length;
    }

    getReviewQueue(deckId: string): Card[] {
        const deck = this.decks.get(deckId);
        if (!deck) return [];
        const now = new Date();
        const allCards = Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => card !== undefined && card !== null && card.deckId === deckId);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const alreadyReviewedTodaySet = new Set(
            this.reviewHistory
                .filter(log => log.timestamp >= todayStart.getTime())
                .map(log => log.cardId)
        );

        const everReviewedSet = new Set(this.reviewHistory.map(log => log.cardId));

        const dueCards = allCards.filter(c =>
            c.fsrsData && c.fsrsData.state !== State.New && c.fsrsData.due <= now
        )
            .filter(c => !alreadyReviewedTodaySet.has(c.id))
            .sort((a, b) => a.fsrsData!.due.getTime() - b.fsrsData!.due.getTime());

        const newCards = allCards.filter(c =>
            !c.fsrsData || c.fsrsData.state === State.New
        )
            .filter(c => !alreadyReviewedTodaySet.has(c.id));

        const reviewsRemaining = Math.max(0, this.plugin.settings.reviewsPerDay - this.getReviewedTodayCount(deckId));
        const newCardsRemaining = Math.max(0, this.plugin.settings.newCardsPerDay - newCards.filter(c =>
            everReviewedSet.has(c.id)
        ).length);

        return [
            ...dueCards.slice(0, reviewsRemaining),
            ...newCards.slice(0, newCardsRemaining),
        ];
    }

    getAllCardsForStudy(deckId: string): Card[] {
        const deck = this.decks.get(deckId);
        if (!deck) return [];
        const now = new Date();
        const allCards = Array.from(deck.cardIds)
            .map(id => this.cards.get(id))
            .filter((card): card is Card => card !== undefined && card !== null && card.deckId === deckId);
        const dueCards = allCards.filter(c =>
            c.fsrsData && c.fsrsData.state !== State.New && c.fsrsData.due <= now
        ).sort((a, b) => a.fsrsData!.due.getTime() - b.fsrsData!.due.getTime());
        const newCards = allCards.filter(c => !c.fsrsData || c.fsrsData.state === State.New);
        return [...dueCards, ...newCards];
    }

    updateCard(card: Card, rating: Rating) {
        const now = new Date();
        const fsrsCard = card.fsrsData || {
            due: now, stability: 0, difficulty: 0, elapsed_days: 0,
            scheduled_days: 0, reps: 0, lapses: 0, state: State.New, learning_steps: 0,
        };
        const schedulingCards = this.fsrs.repeat(fsrsCard, now);
        const newFsrsData = schedulingCards[rating as Exclude<Rating, Rating.Manual>].card;
        this.fsrsDataStore[card.id] = newFsrsData;
        card.fsrsData = newFsrsData;

        const reviewLog: ReviewLog = { cardId: card.id, timestamp: now.getTime(), rating };
        this.reviewHistory.push(reviewLog);

        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            this.pouchDB.saveCardState(card.id, card.deckId, card.filePath, newFsrsData).catch(err =>
                console.error('Failed to save card state:', err),
            );
            this.pouchDB.addReviewLog(card.id, now.getTime(), rating).catch(err =>
                console.error('Failed to save review log:', err),
            );
        } else {
            void this.save();
        }

        this.updateGamification(now, rating, newFsrsData);
    }

    private updateGamification(now: Date, rating: Rating, fsrsData: import('ts-fsrs').Card) {
        const g = this.plugin.settings.gamification;
        const today = now.toISOString().slice(0, 10);

        // Streak
        if (g.lastReviewDate) {
            const lastDate = new Date(g.lastReviewDate);
            const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                g.currentStreak++;
            } else if (diffDays > 1) {
                g.currentStreak = 1;
            }
        } else {
            g.currentStreak = 1;
        }
        g.lastReviewDate = today;
        if (g.currentStreak > g.longestStreak) {
            g.longestStreak = g.currentStreak;
        }

        // XP: base 10 × rating multiplier × interval multiplier
        const ratingMult = rating === Rating.Again ? 1 : rating === Rating.Hard ? 2 : rating === Rating.Good ? 3 : 4;
        const intervalDays = Math.max(fsrsData.scheduled_days || 0, 1);
        const xpGained = Math.round(10 * ratingMult * Math.min(intervalDays / 7, 3));
        g.totalXp += xpGained;

        // Total cards reviewed
        g.totalCardsReviewed++;

        // Most reviews in a day
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const reviewsToday = this.reviewHistory.filter(l => l.timestamp >= todayStart).length;
        if (reviewsToday > g.mostReviewsInDay) {
            g.mostReviewsInDay = reviewsToday;
        }
    }

    getGamificationStats(): Gamification {
        return { ...this.plugin.settings.gamification };
    }

    getNextReviewIntervals(card: Card): Record<number, string> {
        const now = new Date();
        const fsrsCard = card.fsrsData || {
            due: now, stability: 0, difficulty: 0, elapsed_days: 0,
            scheduled_days: 0, reps: 0, lapses: 0, state: State.New, learning_steps: 0,
        };
        const schedulingCards = this.fsrs.repeat(fsrsCard, now);
        const formatInterval = (days: number): string => {
            if (days < 1) return '<1d';
            if (days < 30) return `${Math.round(days)}d`;
            if (days < 365) return `${(days / 30).toFixed(1)}m`;
            return `${(days / 365).toFixed(1)}y`;
        };
        return {
            [Rating.Again]: formatInterval(schedulingCards[Rating.Again].card.scheduled_days),
            [Rating.Hard]: formatInterval(schedulingCards[Rating.Hard].card.scheduled_days),
            [Rating.Good]: formatInterval(schedulingCards[Rating.Good].card.scheduled_days),
            [Rating.Easy]: formatInterval(schedulingCards[Rating.Easy].card.scheduled_days),
        };
    }

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
                new: this.cards.size - total,
            },
        };
    }

    getDetailedStats(): {
        reviewsToday: number;
        activity: number[];
        forecast: number[];
        maturity: { mature: number; young: number; learning: number; new: number };
        retentionCurve: { date: string; predicted: number; actual: number }[];
        heatmapData: { date: string; count: number }[];
        intervalBuckets: { label: string; count: number }[];
        perDeckStats: { name: string; new: number; due: number; learning: number }[];
    } {
        const base = this.getStats();
        const now = new Date();

        // Retention curve: replay review sequences to compute predicted R vs actual recall
        const dailyBuckets = new Map<string, { predictedSum: number; actualSum: number; count: number }>();
        const byCard = new Map<string, { timestamp: number; rating: Rating }[]>();
        for (const log of this.reviewHistory) {
            if (!byCard.has(log.cardId)) byCard.set(log.cardId, []);
            byCard.get(log.cardId)!.push({ timestamp: log.timestamp, rating: log.rating });
        }

        for (const reviews of byCard.values()) {
            reviews.sort((a, b) => a.timestamp - b.timestamp);
            let state: import('ts-fsrs').Card | null = null;

            for (let i = 0; i < reviews.length; i++) {
                const review = reviews[i];
                const dateKey = new Date(review.timestamp).toISOString().slice(0, 10);

                if (!dailyBuckets.has(dateKey)) {
                    dailyBuckets.set(dateKey, { predictedSum: 0, actualSum: 0, count: 0 });
                }
                const bucket = dailyBuckets.get(dateKey)!;

                if (state && i > 0) {
                    const elapsedDays = (review.timestamp - reviews[i - 1].timestamp) / (1000 * 60 * 60 * 24);
                    const stability = state.stability;
                    const predictedR = Math.pow(1 + (Math.pow(0.9, 1 / -0.5) - 1) * Math.max(elapsedDays, 0) / Math.max(stability, 0.01), -0.5);
                    bucket.predictedSum += predictedR;
                } else {
                    bucket.predictedSum += 1;
                }

                const repeatCard: FSRSCard = state ?? createEmptyCard(new Date(review.timestamp));
                const schedulingCards = this.fsrs.repeat(repeatCard, new Date(review.timestamp));
                const rating = review.rating as Exclude<Rating, Rating.Manual>;
                state = schedulingCards[rating].card;

                const actualR = review.rating >= Rating.Good ? 1 : 0;
                bucket.actualSum += actualR;
                bucket.count++;
            }
        }

        const retentionCurve: { date: string; predicted: number; actual: number }[] = [];
        const sortedDates = [...dailyBuckets.keys()].sort().slice(-60);
        for (const date of sortedDates) {
            const b = dailyBuckets.get(date)!;
            retentionCurve.push({
                date,
                predicted: +(b.predictedSum / b.count).toFixed(3),
                actual: +(b.actualSum / b.count).toFixed(3),
            });
        }

        // Heatmap data: last 365 days
        const heatmapData: { date: string; count: number }[] = [];
        const dayCounts = new Map<string, number>();
        for (const log of this.reviewHistory) {
            const date = new Date(log.timestamp).toISOString().slice(0, 10);
            dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
        }
        for (let i = 364; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const date = d.toISOString().slice(0, 10);
            heatmapData.push({ date, count: dayCounts.get(date) || 0 });
        }

        // Interval distribution
        const intervalDeltas: number[] = [];
        for (const reviews of byCard.values()) {
            reviews.sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 1; i < reviews.length; i++) {
                const deltaDays = (reviews[i].timestamp - reviews[i - 1].timestamp) / (1000 * 60 * 60 * 24);
                intervalDeltas.push(deltaDays);
            }
        }

        const buckets = [
            { max: 1, label: '<1d' },
            { max: 2, label: '1d' },
            { max: 3, label: '2d' },
            { max: 4, label: '3d' },
            { max: 7, label: '4-6d' },
            { max: 14, label: '1-2w' },
            { max: 30, label: '2-4w' },
            { max: Infinity, label: '>30d' },
        ];
        const intervalBuckets = buckets.map(b => ({ label: b.label, count: 0 }));
        for (const d of intervalDeltas) {
            for (let i = 0; i < buckets.length; i++) {
                if (d < buckets[i].max) {
                    intervalBuckets[i].count++;
                    break;
                }
            }
        }

        // Per-deck stats
        const perDeckStats = this.getDecks().map(d => ({
            name: d.title,
            new: d.stats.new,
            due: d.stats.due,
            learning: d.stats.learning,
        }));

        return {
            ...base,
            retentionCurve,
            heatmapData,
            intervalBuckets,
            perDeckStats,
        };
    }

    async resetAllProgress(): Promise<void> {
        console.debug('Nuclear option: Resetting all card progress...');

        this.fsrsDataStore = {};
        this.reviewHistory = [];

        for (const card of this.cards.values()) {
            card.fsrsData = undefined;
        }

        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            console.debug('Clearing PouchDB card states and review logs...');
            await this.pouchDB.destroy();
            const { PouchDBManager } = await import('../database/PouchDBManager');
            this.pouchDB = new PouchDBManager('lemma_local');
            if (this.plugin.settings.syncEnabled) {
                await this.initializeSync();
            }
        }

        await this.save();

        this.recalculateAllDeckStats();

        console.debug('All progress has been reset');
    }

    getDueNotes(): NoteReviewData[] {
        const now = new Date();
        return Array.from(this.noteReviews.values())
            .filter(n => {
                const data = n.fsrsData;
                return !data || data.state === State.New || data.due <= now;
            })
            .sort((a, b) => {
                const aDue = a.fsrsData?.due?.getTime() ?? 0;
                const bDue = b.fsrsData?.due?.getTime() ?? 0;
                return aDue - bDue;
            });
    }

    getAllReviewNotes(): NoteReviewData[] {
        return Array.from(this.noteReviews.values());
    }

    rateNote(filePath: string, rating: Rating) {
        const now = new Date();
        const existing = this.noteReviews.get(filePath);
        const fsrsCard = existing?.fsrsData || {
            due: now, stability: 0, difficulty: 0, elapsed_days: 0,
            scheduled_days: 0, reps: 0, lapses: 0, state: State.New, learning_steps: 0,
        };
        const schedulingCards = this.fsrs.repeat(fsrsCard, now);
        const newFsrsData = schedulingCards[rating as Exclude<Rating, Rating.Manual>].card;

        const noteKey = `note::${filePath}`;
        this.fsrsDataStore[noteKey] = newFsrsData;
        this.noteReviews.set(filePath, { filePath, fsrsData: newFsrsData });

        const reviewLog: ReviewLog = { cardId: noteKey, timestamp: now.getTime(), rating };
        this.reviewHistory.push(reviewLog);

        if (this.plugin.settings.usePouchDB && this.pouchDB) {
            this.pouchDB.saveCardState(noteKey, '', filePath, newFsrsData).catch(err =>
                console.error('Failed to save note review state:', err),
            );
            this.pouchDB.addReviewLog(noteKey, now.getTime(), rating).catch(err =>
                console.error('Failed to save note review log:', err),
            );
        } else {
            void this.save();
        }
    }
}
