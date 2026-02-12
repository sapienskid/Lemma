# Lemma - FSRS Flashcards for Obsidian

Create and review flashcards directly in Obsidian using the Free Spaced Repetition Scheduler (FSRS) algorithm for optimal learning.

> **Note**: Currently tested on Linux systems. May work on other platforms.

## Features

- **Spaced Repetition**: Uses FSRS algorithm for intelligent scheduling
- **Multiple Card Types**: Basic cards and cloze deletion cards
- **Dashboard View**: Overview of all decks with statistics
- **Review Sessions**: Immersive review mode with keyboard shortcuts
- **Custom Study**: Filter and study specific cards
- **Statistics**: Charts for review activity and forecasts
- **Markdown Support**: Full Obsidian markdown rendering in cards
- **Chart.js Integration**: Visual statistics

## Installation

### Via Community Plugins (Recommended)

1. Open Obsidian Settings → Community Plugins → Disable Safe Mode
2. Search for "Lemma" and install
3. Enable the plugin

### Manual Installation

1. Download from [GitHub](https://github.com/sapienskid)
2. Extract to `.obsidian/plugins/lemma-flashcards/`
3. Reload Obsidian and enable the plugin

### Development

To develop the plugin:

1. Clone the repository
2. Run `npm install`
3. Run `npm run dev` for development build
4. Set `OBSIDIAN_VAULT_PATH` environment variable to your vault path
5. Run `npm run build-deploy` to build and copy to vault
6. Reload Obsidian to test changes

### Requirements

- Obsidian v0.15.0+

## Usage

1. Create a note and add the deck tag (default: `#flashcards`) to the frontmatter or as a tag.
2. Add flashcards using the syntax below.
3. Open the Lemma dashboard from the ribbon icon or command palette.
4. Study your decks!

## Card Syntax

### Basic Cards

```
---card--- ^unique-id
Front content here
---
Back content here
```

### Cloze Deletion Cards

Use `==c1::hidden text==` for cloze deletions.

Example:
```
This is a ==c1::cloze== deletion card.
```

## Settings

- **Deck Tag**: Tag to identify deck files
- **Max New Cards per Day**: Limit for new cards
- **Max Reviews per Day**: Limit for review cards
- **Font Size**: Review card font size
- **FSRS Parameters**: Advanced scheduling settings

## Commands

- `Add a new flashcard`: Insert basic card template
- `Open dashboard`: Open the dashboard view

## Technical Details

- Built with TypeScript for Obsidian
- Uses ts-fsrs library for FSRS algorithm
- Chart.js for statistics visualization
- No external dependencies required

## Contributing

Contributions welcome at [GitHub](https://github.com/sapienskid).

## License

MIT License - see LICENSE file.
