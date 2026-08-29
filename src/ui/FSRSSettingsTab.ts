import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { generatorParameters } from 'ts-fsrs';
import { getDocCount, getErrorMessage, buildAuthenticatedUrl } from '../data/constants';
import { DataMigration, type LegacyPluginData } from '../database/DataMigration';
import { ResetProgressModal } from './ResetProgressModal';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class FSRSSettingsTab extends PluginSettingTab {
    plugin: FSRSFlashcardsPlugin;
    constructor(app: App, plugin: FSRSFlashcardsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const tabNav = containerEl.createEl('div', { cls: 'lemma-tab-nav' });
        const tabContent = containerEl.createEl('div', { cls: 'lemma-tab-content' });

        const tabs = [
            { id: 'general', label: 'General' },
            { id: 'sync', label: 'Sync' },
            { id: 'advanced', label: 'Advanced' },
            { id: 'about', label: 'About' },
        ];

        const showTab = (tabId: string) => {
            tabContent.empty();
            tabNav.querySelectorAll('.lemma-tab-button').forEach(b => b.removeClass('active'));
            tabNav.querySelector(`[data-tab="${tabId}"]`)?.addClass('active');
            switch (tabId) {
                case 'general': this.renderGeneralTab(tabContent); break;
                case 'sync': this.renderSyncTab(tabContent); break;
                case 'advanced': this.renderAdvancedTab(tabContent); break;
                case 'about': this.renderAboutTab(tabContent); break;
            }
        };

        tabs.forEach(tab => {
            const btn = tabNav.createEl('button', { cls: 'lemma-tab-button', text: tab.label });
            btn.setAttribute('data-tab', tab.id);
            btn.addEventListener('click', () => showTab(tab.id));
        });

        showTab('general');
    }

    private renderGeneralTab(containerEl: HTMLElement) {
        new Setting(containerEl).setName('Database').setHeading();

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

        new Setting(containerEl).setName('Deck tag').setHeading();

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

        new Setting(containerEl).setName('Reset progress').setHeading();

        new Setting(containerEl)
            .setName('Reset all card progress')
            .setDesc('Permanently delete all review history and start from scratch.')
            .addButton(btn => btn
                .setButtonText('Reset progress')
                .setWarning()
                .onClick(() => new ResetProgressModal(this.app, this.plugin).open()));
    }

    private renderSyncTab(containerEl: HTMLElement) {
        new Setting(containerEl).setName('Sync').setHeading();

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
    }

    private renderAdvancedTab(containerEl: HTMLElement) {
        new Setting(containerEl).setName('FSRS parameters').setHeading();
        containerEl.createEl('p', {
            text: 'These settings control the scheduling algorithm. Change them only if you know what you are doing.',
            cls: 'setting-item-description',
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
            .setDesc('Comma-separated FSRS weights (19 values).')
            .addTextArea((text) => {
                text.setValue(this.plugin.settings.fsrsParams.w.join(', '))
                    .onChange(async (value) => {
                        try {
                            const weights = value.split(',').map((entry) => parseFloat(entry.trim()));
                            if ((weights.length === 19 || weights.length === 17) && weights.every((weight) => !isNaN(weight))) {
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

        new Setting(containerEl).setName('Optimization').setHeading();
        new Setting(containerEl)
            .setName('Optimize FSRS weights')
            .setDesc('Automatically tune FSRS weights to your review history for more accurate scheduling.')
            .addButton(btn => btn
                .setButtonText('Run optimizer')
                .setCta()
                .onClick(async () => {
                    const { OptimizerModal } = await import('./OptimizerModal');
                    new OptimizerModal(this.app, this.plugin).open();
                }));
    }

    private renderAboutTab(containerEl: HTMLElement) {
        new Setting(containerEl).setName('About').setHeading();

        new Setting(containerEl)
            .setName('Lemma')
            .setDesc(`v${this.plugin.manifest.version} by Sapienskid — FSRS-based spaced repetition flashcards.`);

        const reference = containerEl.createDiv({ cls: 'lemma-quick-reference' });
        reference.createEl('p', { text: 'Quick reference', cls: 'lemma-quick-reference-title' });

        this.renderRefSection(reference, 'Creating decks', [
            `Add the tag #${this.plugin.settings.deckTag} to any note to make it a deck.`,
            `Use frontmatter: tags: [${this.plugin.settings.deckTag}]`,
            `Or inline: # My Note #${this.plugin.settings.deckTag}`,
        ], []);

        this.renderRefSection(reference, 'Card formats', [
            'Basic: ---card--- ^id / Front / --- / Back',
            'Cloze: ==c1::hidden text==',
            'Use block IDs (^unique-id) to preserve review history when editing.',
        ], []);

        this.renderRefSection(reference, 'Review hotkeys', [], [
            ['Space / Enter', 'Show answer'],
            ['1', 'Again'],
            ['2', 'Hard'],
            ['3', 'Good'],
            ['4', 'Easy'],
            ['Esc', 'Exit review session'],
        ]);

        this.renderRefSection(reference, 'Tips', [
            'Use Custom Study to filter by tags or card state.',
            'Enable PouchDB for better performance with large collections.',
            'Use Sync to keep your data across devices via CouchDB.',
        ], []);
    }

    private renderRefSection(container: HTMLElement, title: string, paragraphs: string[], items: string[][] | string[]) {
        const section = container.createDiv({ cls: 'lemma-ref-section' });
        new Setting(section).setName(title).setHeading();
        for (const p of paragraphs) {
            section.createEl('p', { text: p });
        }
        if (items.length > 0) {
            if (Array.isArray(items[0])) {
                const grid = section.createDiv({ cls: 'lemma-ref-grid' });
                for (const [key, desc] of items as string[][]) {
                    grid.createEl('span', { cls: 'lemma-ref-key', text: key });
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

    async migrateData() {
        const pouchDB = this.plugin.dataManager.getPouchDB();
        if (!pouchDB) {
            new Notice('PouchDB is not enabled');
            return;
        }

        try {
            new Notice('Starting migration... This may take a while for large collections.');

            const legacyData = (await this.plugin.loadData()) as LegacyPluginData | null;
            if (!legacyData) {
                new Notice('No legacy data found to migrate');
                return;
            }

            const deckMapping: Record<string, { deckId: string; filePath: string }> = {};
            for (const card of this.plugin.dataManager.getAllCards()) {
                deckMapping[card.id] = {
                    deckId: card.deckId,
                    filePath: card.filePath,
                };
            }

            const migration = new DataMigration(pouchDB);
            await migration.migrateFromLegacy(legacyData, deckMapping);

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
            const syncUrl = buildAuthenticatedUrl(
                this.plugin.settings.syncUrl,
                this.plugin.settings.syncDbName,
                this.plugin.settings.syncUsername,
                this.plugin.settings.syncPassword,
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
            const syncUrl = buildAuthenticatedUrl(
                this.plugin.settings.syncUrl,
                this.plugin.settings.syncDbName,
                this.plugin.settings.syncUsername,
                this.plugin.settings.syncPassword,
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
                10000,
            );
        } catch (error) {
            console.error('Sync test failed:', error);
            new Notice(`Sync test failed: ${getErrorMessage(error)}`, 8000);
        }
    }

}
