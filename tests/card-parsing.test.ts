vi.mock('obsidian', () => {
    class MockNotice {
        constructor(public message: string, public duration?: number) {}
    }
    class MockComponent {
        unload() {}
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
        Component: MockComponent,
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
        MarkdownRenderer: class { static render() { return Promise.resolve(); } },
        normalizePath: (p: string) => p.replace(/\\/g, '/'),
        Platform: { isDesktop: true, isMobile: false },
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

describe('Card parsing', () => {
    describe('Basic cards', () => {
        it('parses a simple basic card', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

---card--- ^test123
What is the capital of France?
---
Paris
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            const cards = dm.getAllCards();
            expect(cards).toHaveLength(1);
            expect(cards[0].type).toBe('basic');
            expect(cards[0].front).toBe('What is the capital of France?');
            expect(cards[0].back).toBe('Paris');
        });

        it('parses multiple basic cards', async () => {
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
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(2);
        });

        it('handles cards without block ID', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

---card---
Front without block ID
---
Back without block ID
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(1);
            expect(dm.getAllCards()[0].id).not.toContain('::');
        });

        it('skips malformed cards with empty front', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

---card--- ^empty
---
Back only - no front
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(0);
        });
    });

    describe('Single-line cards (Q::A and Q:::A)', () => {
        it('parses a basic single-line card (Q::A)', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

What is the capital of France?::Paris
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            const cards = dm.getAllCards();
            expect(cards).toHaveLength(1);
            expect(cards[0].type).toBe('basic');
            expect(cards[0].front).toBe('What is the capital of France?');
            expect(cards[0].back).toBe('Paris');
        });

        it('parses a reversed single-line card (Q:::A)', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

Capital of France:::Paris
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            const cards = dm.getAllCards();
            expect(cards).toHaveLength(1);
            expect(cards[0].type).toBe('reversed');
            expect(cards[0].front).toBe('Paris');
            expect(cards[0].back).toBe('Capital of France');
        });

        it('parses multiple single-line cards in one note', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

Q1::A1
Q2::A2
Q3:::A3
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(3);
        });

        it('does not confuse colons in text for single-line cards', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

This is not::A card
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(1);
            expect(dm.getAllCards()[0].front).toBe('This is not');
            expect(dm.getAllCards()[0].back).toBe('A card');
        });
    });

    describe('Cloze deletion cards', () => {
        it('parses a simple cloze card', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

The ==c1::mitochondria== is the powerhouse of the cell.
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            const cards = dm.getAllCards();
            expect(cards).toHaveLength(1);
            expect(cards[0].type).toBe('cloze');
            expect(cards[0].front).toContain('[...]');
            expect(cards[0].back).toContain('mitochondria');
            expect(cards[0].back).not.toContain('==c1::');
        });

        it('creates separate cards for each cloze number', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
                tags: [{ tag: '#flashcards', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }],
            });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---
tags: [flashcards]
---

The ==c1::mitochondria== is the powerhouse of the ==c2::cell==.
`);
            await dm.updateFile({ path: 'test-note.md', basename: 'test-note' } as never);
            expect(dm.getAllCards()).toHaveLength(2);
            expect(dm.getAllCards().every(c => c.type === 'cloze')).toBe(true);
        });
    });

    describe('Deck detection', () => {
        it('ignores files without the deck tag', async () => {
            const plugin = createMockPlugin();
            const dm = new DataManager(plugin as never);
            plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({ tags: [] });
            plugin.app.vault.read = vi.fn().mockResolvedValue(`---card--- ^q1\nFront\n---\nBack\n`);
            await dm.updateFile({ path: 'no-deck-tag.md', basename: 'no-deck-tag' } as never);
            expect(dm.getAllCards()).toHaveLength(0);
            expect(dm.getDecks()).toHaveLength(0);
        });
    });
});
