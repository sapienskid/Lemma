import { Editor, Notice, Plugin, TFile, debounce, setIcon } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { VIEW_TYPE_DASHBOARD, VIEW_ICON_NAME, STATUS_ICON_NAME, DEFAULT_SETTINGS, generateBlockId, getDocCount } from '../data/constants';
import type { FSRSSettings, PluginData } from '../data/types';
import { DashboardView } from '../ui/DashboardView';
import { FSRSSettingsTab } from '../ui/FSRSSettingsTab';
import { ResetProgressModal } from '../ui/ResetProgressModal';

class FSRSFlashcardsPlugin extends Plugin {
    settings: FSRSSettings;
    dataManager: DataManager;

    async onload() {
        console.debug('Loading Lemma plugin');
        await this.loadSettings();
        this.dataManager = new DataManager(this);

        this.app.workspace.onLayoutReady(async () => {
            await this.dataManager.load();

            await this.dataManager.initializeSync();

            this.refreshDashboardView();
        });

        this.addSettingTab(new FSRSSettingsTab(this.app, this));
        this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));

        const ribbonIconEl = this.addRibbonIcon(VIEW_ICON_NAME, 'Open Lemma dashboard', (evt: MouseEvent) => {
            void this.activateView();
        });
        ribbonIconEl.addClass('lemma-ribbon-icon');

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
        this.addCommand({
            id: 'add-fsrs-flashcard',
            name: 'Add a new flashcard',
            editorCallback: (editor: Editor) => {
                const blockId = generateBlockId();
                const template = `\n\n---card--- ^${blockId}\n\n---\n\n`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 3, ch: 0 });
            },
        });
        this.addCommand({
            id: 'add-single-line-card',
            name: 'Add a single-line card',
            editorCallback: (editor: Editor) => {
                const blockId = generateBlockId();
                const template = `\nQuestion::Answer ^${blockId}`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 1, ch: 0 });
            },
        });
        this.addCommand({
            id: 'add-reversed-card',
            name: 'Add a reversed card',
            editorCallback: (editor: Editor) => {
                const blockId = generateBlockId();
                const template = `\nQuestion:::Answer ^${blockId}`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 1, ch: 0 });
            },
        });
        this.addCommand({
            id: 'add-cloze-card',
            name: 'Add a cloze card',
            editorCallback: (editor: Editor) => {
                const template = `\nThis is ==c1::a cloze deletion== in a sentence.`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 1, ch: 0 });
            },
        });
        this.addCommand({
            id: 'cloze-from-selection',
            name: 'Create cloze from selection',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (selection) {
                    const existing = editor.getLine(editor.getCursor().line);
                    const clozeMatch = existing.match(/==c(\d+)::/);
                    const nextNum = clozeMatch ? parseInt(clozeMatch[1], 10) + 1 : 1;
                    editor.replaceSelection(`==c${nextNum}::${selection}==`);
                } else {
                    const template = `==c1::text==`;
                    editor.replaceSelection(template);
                    const cursor = editor.getCursor();
                    // Place cursor inside the cloze text
                    editor.setCursor({ line: cursor.line, ch: cursor.ch - 7 });
                }
            },
        });
        this.addCommand({
            id: 'add-typein-card',
            name: 'Add a type-in card',
            editorCallback: (editor: Editor) => {
                const blockId = generateBlockId();
                const template = `\n\n---card--- ?type ^${blockId}\nQuestion\n---\nAnswer\n\n`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 3, ch: 0 });
            },
        });
        this.addCommand({
            id: 'add-typein-single-line',
            name: 'Add a type-in single-line card',
            editorCallback: (editor: Editor) => {
                const blockId = generateBlockId();
                const template = `\nQuestion::Answer ?type ^${blockId}`;
                const cursor = editor.getCursor();
                editor.replaceRange(template, cursor);
                editor.setCursor({ line: cursor.line + 1, ch: 0 });
            },
        });
        this.addCommand({
            id: 'open-fsrs-dashboard',
            name: 'Open dashboard',
            callback: () => {
                void this.activateView();
            },
        });

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
                },
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
                },
            });
        }

        this.addCommand({
            id: 'review-notes',
            name: 'Review due notes',
            callback: async () => {
                const dueNotes = this.dataManager.getDueNotes();
                if (dueNotes.length === 0) {
                    new Notice('No notes due for review.');
                    return;
                }
                const { ReviewNoteModal } = await import('../ui/ReviewNoteModal');
                new ReviewNoteModal(this.app, this, dueNotes).open();
            },
        });

        this.addCommand({
            id: 'reset-all-card-progress',
            name: 'Reset all card progress (nuclear option)',
            callback: async () => {
                new ResetProgressModal(this.app, this).open();
            },
        });

        this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
            const selection = editor.getSelection();
            if (selection) {
                menu.addItem((item) => {
                    item.setTitle('Create cloze from selection')
                        .setIcon('highlighter')
                        .onClick(() => {
                            const line = editor.getLine(editor.getCursor().line);
                            const clozeMatch = line.match(/==c(\d+)::/);
                            const nextNum = clozeMatch ? parseInt(clozeMatch[1], 10) + 1 : 1;
                            editor.replaceSelection(`==c${nextNum}::${selection}==`);
                        });
                });
            }
        }));

        const debouncedRefresh = debounce(() => {
            this.dataManager.recalculateAllDeckStats();
            this.refreshDashboardView();
        }, 500, true);
        const updateAndRefresh = async (file: TFile) => {
            try {
                await this.dataManager.updateFile(file);
            } catch (e) {
                console.error('Failed to update file:', e);
            }
            debouncedRefresh();
        };
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
                const deckId = this.dataManager.getDeckId(file.path);
                this.dataManager.removeDeck(deckId);
                debouncedRefresh();
            }
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) {
                void this.dataManager.renameDeck(file, oldPath).then(() => {
                    debouncedRefresh();
                }).catch((e: unknown) => {
                    console.error('Failed to rename deck:', e);
                });
            }
        }));

        this.refreshDashboardView();
    }

    onunload() {
        void this.dataManager.stopSync().catch((error: unknown) => {
            console.error('Failed to stop sync during unload:', error);
        });
    }

    async loadSettings() {
        const data = (await this.loadData()) as PluginData | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.settings.fsrsParams = Object.assign({}, DEFAULT_SETTINGS.fsrsParams, this.settings.fsrsParams);
    }

    async saveSettings() {
        await this.saveData({
            settings: this.settings,
            cardData: this.dataManager['fsrsDataStore'] || {},
            reviewHistory: this.dataManager['reviewHistory'] || [],
        });
    }

    async activateView() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
        let leaf = leaves.length > 0 ? leaves[0] : null;

        if (leaf) {
            const isSidebar = leaf.getRoot() !== workspace.rootSplit;
            if (isSidebar) {
                leaf.detach();
                leaf = null;
            } else {
                await workspace.revealLeaf(leaf);
                return;
            }
        }

        if (!leaf) {
            leaf = workspace.getLeaf('tab') || workspace.getLeaf(true);
            await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
        }

        await workspace.revealLeaf(leaf);
    }

    refreshDashboardView() {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
        if (leaf?.view instanceof DashboardView) {
            (leaf.view).render();
        }
    }
}

export default FSRSFlashcardsPlugin;
export { FSRSFlashcardsPlugin };
