# Lemma

Lemma is an Obsidian plugin for creating and reviewing flashcards with the FSRS spaced-repetition algorithm.

## Features

- FSRS scheduling for new, learning, and review cards
- Basic and cloze card support
- Dashboard with deck stats and due counts
- Immersive review and browse modals
- Custom study filters (tags, state, limits)
- Optional PouchDB local storage for large collections
- Optional CouchDB sync support
- Review statistics with charts

## Requirements

- Obsidian `>= 0.15.0`

## Installation

### Community plugins

1. Open **Settings → Community plugins**.
2. Search for **Lemma**.
3. Install and enable the plugin.

### Manual installation

1. Download release assets from GitHub:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create folder: `.obsidian/plugins/lemma-flashcards/`
3. Copy the files into that folder.
4. Reload Obsidian and enable **Lemma**.

## Quick start

1. Add your deck tag (default `#flashcards`) to notes you want indexed.
2. Add cards using one of the formats below.
3. Open the dashboard from the right-side status bar icon or run **Lemma: Open dashboard** from the command palette.
4. Start reviewing due cards.

## Card formats

### Basic

```markdown
---card--- ^unique-id
Front content
---
Back content
```

### Cloze

```markdown
This is a ==c1::cloze== deletion card.
```

## Commands

- `Add a new flashcard`
- `Open dashboard`
- `Sync now` (when sync is enabled)
- `Check sync status` (when sync is enabled)
- `Reset all card progress (nuclear option)`

## Sync setup (CouchDB)

1. Open **Settings -> Lemma -> Database** and keep **Use PouchDB (IndexedDB)** enabled.
2. In **Settings -> Lemma -> Sync**, fill:
   - `CouchDB server URL` (server root, for example `https://your-server.com:5984`)
   - `Database name` (for example `lemma`)
   - `Username`
   - `Password`
3. Click **Run test** in `Test sync`:
   - verifies local + remote DB connectivity
   - if sync is enabled, also runs a one-time manual sync check
4. Enable **Enable sync** to start continuous sync.
5. Use:
   - `Sync now` command for manual sync
   - `Check sync status` command for current status/details

Notes:
- The plugin appends the database name to the server URL automatically.
- If sync is disabled, `Run test` still validates connection without starting continuous sync.

## Settings

- Deck tag
- Daily limits for new/review cards
- Review font size
- FSRS parameters (advanced)
- Storage mode (JSON or PouchDB)
- Sync server and credentials
- Sync test button (connection + manual sync check)

## Development

```bash
pnpm install
pnpm run lint
pnpm run build
pnpm run dev
```

Deploy to a local vault (copies `main.js`, `manifest.json`, and `styles.css` if present):

```bash
pnpm run deploy
# or
OBSIDIAN_VAULT="/path/to/vault" pnpm run deploy
```

## License

ISC License. See `LICENSE`.
