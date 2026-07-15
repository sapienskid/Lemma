# Lemma — Design

## Overview

Lemma is an Obsidian plugin for spaced-repetition flashcards using the FSRS 4.5 algorithm. It turns any tagged note into a deck, parses cards from Markdown, and manages review scheduling entirely on-device.

---

## Architecture

### Class hierarchy

```
FSRSFlashcardsPlugin (extends Plugin)
├── DataManager           — all data, FSRS engine, sync orchestration
├── DashboardView         — deck list (ItemView)
├── ReviewModal           — study session (Modal)
├── BrowseModal           — card browser (Modal)
├── StatsModal            — Chart.js statistics (Modal)
├── CustomStudyModal      — filtered study (Modal)
├── ResetProgressModal    — progress reset (Modal)
└── FSRSSettingsTab       — 4-tab settings (PluginSettingTab)
```

All source lives in `main.ts` (~2300 lines). Separate files for database layer only.

### Data flow

```
vault event (create/modify/delete/rename)
  → DataManager.updateFile(file)  [parses cards from markdown]
  → DataManager.recalculateAllDeckStats()
  → plugin.refreshDashboardView()

review (user rates card)
  → DataManager.updateCard(card, rating)
    → fsrs.repeat() → new scheduling
    → fsrsDataStore[card.id] = newFsrsData
    → if usePouchDB: saveCardState() + addReviewLog()  (async)
    → else: plugin.saveData()                           (sync)
```

---

## Data model

### Settings (`FSRSSettings`)

| Field | Default | Description |
|---|---|---|
| `deckTag` | `"flashcards"` | Tag identifying deck notes |
| `newCardsPerDay` | `20` | Max new cards to introduce per day |
| `reviewsPerDay` | `200` | Max reviews per day |
| `fontSize` | `18` | Review card font size (px) |
| `fsrsParams` | FSRS defaults | request_retention, maximum_interval, w (21 weights) |
| `syncEnabled` | `false` | CouchDB sync toggle |
| `syncUrl` | `""` | CouchDB server URL |
| `syncDbName` | `"lemma"` | CouchDB database name |
| `syncUsername` | `""` | CouchDB auth username |
| `syncPassword` | `""` | CouchDB auth password |
| `usePouchDB` | `true` | Use IndexedDB vs legacy JSON |

### Card data model

```typescript
interface Card {
  id: string;           // "deckId::blockId" or cyrb53hex(...)
  deckId: string;       // cyrb53hex(filePath)
  filePath: string;     // vault path
  type: 'basic' | 'cloze';
  originalText: string; // raw markdown source
  front: string;        // rendered question
  back: string;         // rendered answer
  fsrsData?: FSRSCard;  // scheduling state (ts-fsrs)
}
```

### Deck data model

```typescript
interface Deck {
  id: string;
  title: string;         // frontmatter title or file basename
  filePath: string;
  cardIds: Set<string>;
  stats: { new: number; due: number; learning: number; };
}
```

### Review log

```typescript
interface ReviewLog {
  cardId: string;
  timestamp: number;     // epoch ms
  rating: Rating;        // Again=0, Hard=1, Good=2, Easy=3
}
```

---

## Card parsing

### Basic cards

Split file content by `---card---` (case-insensitive):

```
---card--- ^blockId
What is the capital of France?

---
Paris
```

- Block ID is optional (`^[a-zA-Z0-9-]+`)
- Everything before `\n---\n` is the front, everything after is the back

### Cloze deletion

Regex: `==c(\d+)::(.*?)==` within any paragraph

```
The capital of France is ==c1::Paris==.
```

- Each cloze generates one card
- Front: replaces marked text with `[...]`
- Back: strips the `==c\d+...::` wrapper

### Card ID generation

| Scenario | Card ID |
|---|---|
| Basic with `^blockId` | `deckId::blockId` |
| Basic without block ID | `cyrb53hex(filePath + '::' + front)` |
| Cloze with `^blockId` | `deckId::blockId-clozeNum` |
| Cloze without block ID | `cyrb53hex(filePath + '::' + paragraph + '::' + clozeNum)` |

Block IDs preserve review history across edits. Hash-based IDs change when content changes (card resets to New).

---

## FSRS state machine

States from `ts-fsrs`:

| State | Meaning | criteria |
|---|---|---|
| `New` | Never reviewed | No fsrsData or state === New |
| `Learning` | First review, not graduated | State === Learning |
| `Review` | Graduated card | State === Review |
| `Relearning` | Failed review card | State === Relearning |

Maturity classification (for stats):
- **New**: no FSRS data or state === New
- **Learning**: State.Learning or State.Relearning
- **Young**: State.Review with stability < 21 days
- **Mature**: State.Review with stability >= 21 days

---

## Persistence

### PouchDB mode (default)

Uses `pouchdb-browser` (IndexedDB) with doc types:
- `card_state` — FSRS scheduling per card
- `review_log` — individual review events
- `settings` — plugin settings
- `sync_meta` — last sync timestamp

Write path: `updateCard()` → async `saveCardState()` + `addReviewLog()`

### Legacy JSON mode

Uses Obsidian's `Plugin.saveData()` → `data.json`.

Write path: `updateCard()` → `plugin.saveData()` (sync, aggregates all data)

### Migration

`DataMigration.migrateFromLegacy()` converts `data.json` → PouchDB docs. Verifies by comparing card and log counts.

---

## Sync architecture

```
IndexedDB (local)  ←PouchDB live sync→  CouchDB (remote)
```

- **Live sync**: `{ live: true, retry: true }` — continuous bidirectional
- **Manual sync**: one-shot sync (dashboard button, settings test)
- **Retry logic**: max 5 retries, exponential backoff
- **Fatal errors**: HTTP 401/403/404 cancel sync entirely
- **Auth**: credentials embedded in URL, sanitized with `sanitizeCredentialForUrl()`
- **Logging**: password masked via `sanitizeUrl()`

---

## UI components

### DashboardView (`ItemView`)
- Shows all decks grouped by folder
- Collapsible folder groups (chevron toggle)
- Per-deck: study, cram, browse actions (hover-revealed)
- Header: study all, statistics, custom study, help, refresh, sync
- Stat pills: total/due/new card counts

### ReviewModal (`Modal`)
- Full-screen immersive modal
- State machine: `question` → `answer` → next card
- 4 rating buttons: Again/Hard/Good/Easy with interval hints
- Keyboard: Space/Enter = show answer, 1-4 = rate, Esc = close
- Completion screen on session end

### BrowseModal (`Modal`)
- Previous/next card navigation (buttons + arrow keys)
- Full Markdown rendering via `MarkdownRenderer`
- Card counter in title

### StatsModal (`Modal`)
- 4 stat header cards (reviews today, due this week, mature, total learned)
- Chart.js: 30-day activity (line) + 7-day forecast (bar)
- Charts destroyed on close to prevent memory leaks

### Settings tab (`PluginSettingTab`)
- 4 tabs: General, Sync, Advanced, About
- General: PouchDB toggle/migration, deck tag, review limits, font size, reset progress
- Sync: enable/disable, CouchDB URL/credentials, test/status
- Advanced: FSRS parameters (retention, interval, weights)
- About: version, inline quick reference guide

### ResetProgressModal (`Modal`)
- Red warning card with consequences
- Current data statistics
- Type "delete" confirmation
- Destroys PouchDB, rebuilds from scratch

---

## Commands & events

### Commands (5)
| ID | Action |
|---|---|
| `add-fsrs-flashcard` | Insert card template at cursor |
| `open-fsrs-dashboard` | Open dashboard view |
| `sync-now` | Trigger sync (PouchDB only) |
| `check-sync-status` | Show sync status notice |
| `reset-all-card-progress` | Open reset modal |

### Registered events (4)
| Event | Handler |
|---|---|
| `vault.on('create')` | `updateFile()` + debounced refresh |
| `vault.on('modify')` | `updateFile()` + debounced refresh |
| `vault.on('delete')` | `removeDeck()` + debounced refresh |
| `vault.on('rename')` | `renameDeck()` + debounced refresh |

All use 500ms debounce to batch rapid edits.

---

## Build & release

### Build pipeline

```
esbuild.config.mjs
  entry: main.ts
  output: main.js (CJS, ES2018 target)
  externals: obsidian, electron, codemirror, path, child_process
```

### Scripts
- `pnpm run dev` — dev mode (no typecheck, sourcemaps)
- `pnpm run build` — `tsc -noEmit -skipLibCheck` + esbuild production
- `pnpm run lint` — eslint (main.ts + src/)
- `pnpm run lint:fix` — auto-fix lint errors

### Release
Push semver tag (e.g., `1.0.2`) → GitHub Actions:
1. Validate tag matches `manifest.json` version
2. `pnpm install && pnpm run lint && pnpm run build`
3. Create release with `main.js`, `manifest.json`, `styles.css`

### Security
- Passwords stored in settings (Obsidian data.json)
- URLs logged with password masked
- `sanitizeCredentialForUrl()` prevents URIError from `%` characters
- `crypto-js` removed in v1.0.1; uses synchronous `cyrb53` hash (works without Secure Context)
