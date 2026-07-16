import { App, Modal } from 'obsidian';

type FSRSFlashcardsPlugin = import('../plugin/main').FSRSFlashcardsPlugin;

export class HelpModal extends Modal {
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

        this.renderSection('Creating decks', [
            `Add the tag #${this.plugin.settings.deckTag} to any note to make it a deck.`,
            'You can change the tag in plugin settings.',
            'Each note with the deck tag becomes a separate deck.',
        ], [
            `Use frontmatter: tags: [${this.plugin.settings.deckTag}]`,
            `Or inline: # My Note #${this.plugin.settings.deckTag}`,
        ]);

        this.renderSection('Card formats', [
            'Basic cards have a front (question) and back (answer).',
            'Cloze deletion cards hide specific words within a sentence.',
            'Use the command palette to insert a card template.',
        ], [
            'Basic: ---card--- ^id / Front / --- / Back',
            'Cloze: ==c1::hidden text==',
            'Use block IDs (^unique-id) to preserve review history when editing.',
        ]);

        this.renderSection('Review hotkeys', [], [
            ['Space / Enter', 'Show answer'],
            ['1', 'Again'],
            ['2', 'Hard'],
            ['3', 'Good'],
            ['4', 'Easy'],
            ['Esc', 'Exit review session'],
        ]);

        this.renderSection('Tips', [
            'Use Custom Study to filter by tags or card state.',
            'Enable PouchDB for better performance with large collections.',
            'Use Sync to keep your data across devices via CouchDB.',
            'Full documentation is available in the plugin settings (About section).',
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
