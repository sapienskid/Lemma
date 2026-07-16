vi.mock('obsidian', () => {
    class MockNotice {
        constructor(public message: string, public duration?: number) {}
    }
    class MockTFile {
        path: string;
        basename: string;
        constructor(path: string, basename?: string) {
            this.path = path;
            this.basename = basename || path.split('/').pop() || 'untitled';
        }
    }
    return {
        Notice: MockNotice,
        TFile: MockTFile,
        Component: class { unload() {} },
        Plugin: class {},
        ItemView: class {
            contentEl = document.createElement('div');
            getViewType() { return ''; }
            getDisplayText() { return ''; }
            getIcon() { return ''; }
            onOpen() { return Promise.resolve(); }
        },
        Modal: class {
            app: any;
            contentEl = document.createElement('div');
            containerEl = document.createElement('div');
            modalEl = document.createElement('div');
            titleEl = document.createElement('div');
            scope = { register: () => {} };
            constructor(app: any) { this.app = app; }
            open() {}
            close() {}
        },
        Setting: class {
            setName() { return this; }
            setDesc() { return this; }
            setHeading() { return this; }
            addText() { return this; }
            addToggle() { return this; }
            addDropdown() { return this; }
            addButton() { return this; }
            addSlider() { return this; }
            setDisabled() { return this; }
        },
        ButtonComponent: class {
            buttonEl = document.createElement('div');
            setIcon() { return this; }
            setButtonText() { return this; }
            setCta() { return this; }
            setWarning() { return this; }
            setDisabled() { return this; }
            setTooltip() { return this; }
            onClick() { return this; }
        },
        setIcon: () => {},
        debounce: (fn: any) => fn,
    };
});

vi.mock('../src/database/PouchDBManager', () => {
    class MockPouchDBManager {
        constructor() {}
        async getAllCardStates() { return {}; }
        async getReviewHistory() { return []; }
        async saveCardState() { return Promise.resolve(); }
        async addReviewLog() { return Promise.resolve(); }
        async destroy() { return Promise.resolve(); }
        async setupSync() { return Promise.resolve(); }
        async stopSync() { return Promise.resolve(); }
        async manualSync() { return Promise.resolve(); }
        async getSyncStatus() { return { enabled: false }; }
        async getDatabaseInfo() { return { doc_count: 0 }; }
        async testConnection() { return { remoteInfo: {}, localInfo: {} }; }
        isSyncing() { return false; }
        onSyncChange() {}
        onSyncError() {}
        onSyncActive() {}
        onSyncPaused() {}
    }
    return { PouchDBManager: MockPouchDBManager };
});

import { describe, it, expect, vi } from 'vitest';
import { DataManager } from '../src/data/DataManager';
import { DEFAULT_SETTINGS } from '../src/data/constants';
import { Rating, State } from 'ts-fsrs';

function createMockPlugin() {
    const app = {
        vault: {
            getMarkdownFiles: vi.fn().mockReturnValue([]),
            read: vi.fn().mockResolvedValue(''),
            on: vi.fn().mockReturnValue(vi.fn()),
        },
        metadataCache: {
            getFileCache: vi.fn().mockReturnValue(null),
            getCache: vi.fn().mockReturnValue(null),
        },
        workspace: {
            getLeavesOfType: vi.fn().mockReturnValue([]),
            revealLeaf: vi.fn().mockResolvedValue(undefined),
            getLeaf: vi.fn().mockReturnValue({ setViewState: vi.fn().mockResolvedValue(undefined) }),
            rootSplit: {},
            on: vi.fn().mockReturnValue(vi.fn()),
        },
    };
    return {
        app,
        settings: { ...DEFAULT_SETTINGS },
        loadData: vi.fn().mockResolvedValue(null),
        saveData: vi.fn().mockResolvedValue(undefined),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        refreshDashboardView: vi.fn(),
    };
}

describe('DataManager', () => {
    describe('getStats', () => {
        it('returns zero stats when there are no cards', () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            const stats = dm.getStats();
            expect(stats.reviewsToday).toBe(0);
            expect(stats.activity).toHaveLength(30);
            expect(stats.forecast).toHaveLength(7);
            expect(stats.maturity.new).toBe(0);
            expect(stats.maturity.mature).toBe(0);
            expect(stats.maturity.young).toBe(0);
            expect(stats.maturity.learning).toBe(0);
        });
    });

    describe('getReviewQueue', () => {
        it('returns empty queue for non-existent deck', () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            expect(dm.getReviewQueue('nonexistent')).toHaveLength(0);
        });
    });

    describe('getNextReviewIntervals', () => {
        it('returns string intervals for a new card', () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            const card = {
                id: 'test::card1',
                deckId: 'test-deck',
                filePath: 'test.md',
                type: 'basic' as const,
                originalText: '',
                front: 'Front',
                back: 'Back',
            };
            const intervals = dm.getNextReviewIntervals(card);
            expect(typeof intervals[Rating.Again]).toBe('string');
            expect(typeof intervals[Rating.Hard]).toBe('string');
            expect(typeof intervals[Rating.Good]).toBe('string');
            expect(typeof intervals[Rating.Easy]).toBe('string');
        });
    });

    describe('FSRS state machine', () => {
        it('transitions card from New to Learning on Again', () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            const card = {
                id: 'test::card1',
                deckId: 'test-deck',
                filePath: 'test.md',
                type: 'basic' as const,
                originalText: '',
                front: 'Front',
                back: 'Back',
            };
            dm.updateCard(card, Rating.Again);
            expect(card.fsrsData).toBeDefined();
            expect(card.fsrsData!.state).toBe(State.Learning);
        });

        it('records review in history', () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            const card = {
                id: 'test::card2',
                deckId: 'test-deck',
                filePath: 'test.md',
                type: 'basic' as const,
                originalText: '',
                front: 'Front',
                back: 'Back',
            };
            dm.updateCard(card, Rating.Good);
            const stats = dm.getStats();
            expect(stats.reviewsToday).toBe(1);
        });
    });

    describe('getAllCards', () => {
        it('returns cards after parsing', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

---card--- ^q1
Front 1
---
Back 1

---card--- ^q2
Front 2
---
Back 2
`);
            await dm.updateFile({ path: 'test.md', basename: 'test' } as never);
            expect(dm.getAllCards()).toHaveLength(2);
        });
    });
});
