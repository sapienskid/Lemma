# Lemma — Design

## Overview

Lemma is an Obsidian plugin for spaced-repetition flashcards using the FSRS 4.5 algorithm. It turns any tagged note into a deck, parses cards from Markdown, and manages review scheduling entirely on-device.

---

## Architecture

### Class hierarchy

```
FSRSFlashcardsPlugin (extends Plugin)    [src/plugin/main.ts]
├── DataManager                          [src/data/DataManager.ts]
│   ├── PouchDBManager                   [src/database/PouchDBManager.ts]
│   └── FsrsOptimizer                    [src/data/FsrsOptimizer.ts]
├── DashboardView (ItemView)             [src/ui/DashboardView.ts]
├── ReviewModal (Modal)                  [src/ui/ReviewModal.ts]
├── BrowseModal (Modal)                  [src/ui/BrowseModal.ts]
├── StatsModal (Modal)                   [src/ui/StatsModal.ts]
├── HelpModal (Modal)                    [src/ui/HelpModal.ts]
├── CustomStudyModal (Modal)             [src/ui/CustomStudyModal.ts]
├── ResetProgressModal (Modal)           [src/ui/ResetProgressModal.ts]
├── ReviewNoteModal (Modal)              [src/ui/ReviewNoteModal.ts]
├── OptimizerModal (Modal)               [src/ui/OptimizerModal.ts]
└── FSRSSettingsTab (PluginSettingTab)   [src/ui/FSRSSettingsTab.ts]
```

Standalone modules:
- `src/data/types.ts` — All interfaces (Card, Deck, ReviewLog, etc.)
- `src/data/constants.ts` — Constants, utilities, hash functions
- `src/database/DataMigration.ts` — Legacy JSON → PouchDB migration

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
| `fsrsParams` | FSRS defaults | request_retention, maximum_interval, w (19 weights) |
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
  type: 'basic' | 'cloze' | 'reversed';
  originalText: string; // raw markdown source
  front: string;        // rendered question
  back: string;         // rendered answer
  context?: string;     // heading breadcrumb (e.g. "Chapter 3 > Cell Structure")
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

### Review log & note review

```typescript
interface ReviewLog {
  cardId: string;
  timestamp: number;     // epoch ms
  rating: Rating;        // Again=0, Hard=1, Good=2, Easy=3
}

interface NoteReviewData {
  filePath: string;
  fsrsData?: FSRSCard;
}
```

---

## Card parsing

### Block cards (---card---)

```
---card--- ^blockId
What is the capital of France?

---
Paris
```

- Block ID is optional (`^[a-zA-Z0-9-]+`)
- Everything before `\n---\n` is the front, everything after is the back

### Single-line cards (Q::A and Q:::A)

```
Capital of France::Paris ^fsrs-abc123
```

- `Q::A` — basic card (front::back)
- `Q:::A` — reversed card (back:::front)
- Optional `^blockId` suffix for stable review history
- Skips cloze syntax (`==c#::`)

### Cloze deletion

Regex: `==c(\d+)::(.*?)==` within any paragraph

```
The capital of France is ==c1::Paris==.
```

- Each cloze number generates one independently scheduled card
- Front: replaces marked text with `[...]`
- Back: strips the `==c\d+...::` wrapper
- Skip empty paragraphs and lines matching cloze pattern

### Card ID generation

| Scenario | Card ID |
|---|---|
| Basic + block ID | `deckId::blockId` |
| Basic, no block ID | `cyrb53hex(filePath + '::' + front)` |
| Single-line + block ID | `deckId::blockId` |
| Single-line, no block ID | `cyrb53hex(filePath + '::' + line)` |
| Cloze + block ID | `deckId::blockId-clozeNum` |
| Cloze, no block ID | `cyrb53hex(filePath + '::' + paragraph + '::' + clozeNum)` |

Block IDs preserve review history across edits. Hash-based IDs change when content changes (card resets to New).

---

## FSRS state machine

States from `ts-fsrs`:

| State | Meaning | Criteria |
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

## FSRS optimizer

Pure-TypeScript evolutionary strategy optimizer in `src/data/FsrsOptimizer.ts`:

1. **buildSequences()** — groups review logs by card, sorts by time, computes deltas
2. **computeLossForWeights()** — simulates review sequences with candidate weights, computes binary cross-entropy loss against actual recall, with L2 regularization
3. **optimize()** — population-based evolutionary strategy (20 candidates, 30 generations), decaying mutation rate

Key FSRS-5 formulas implemented:
- `forgettingCurve()` — retrievability from elapsed time and stability
- `initStability()` / `initDifficulty()` — first-review parameters
- `nextRecallStability()` / `nextForgetStability()` — state transitions
- `nextShortTermStability()` — same-day review handling
- `nextDifficulty()` — difficulty drift with mean reversion

Optimizer available via **Settings → Advanced → Run optimizer**.

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
- Swipe gestures: left=Again, down=Hard, right=Good, up=Easy
- Card context breadcrumb (heading hierarchy)
- Completion screen with session stats

### BrowseModal (`Modal`)
- Previous/next card navigation (buttons + arrow keys)
- Full Markdown rendering via `MarkdownRenderer`
- Card counter in title

### StatsModal (`Modal`)
- 4 stat header cards (reviews today, due this week, mature, total learned)
- Chart.js: 30-day activity (line) + 7-day forecast (bar)
- Retention curve: predicted vs actual recall over 30 days
- Maturity breakdown: doughnut chart (new/learning/young/mature)
- Monthly heatmap: GitHub-style 12-month activity grid
- Interval distribution: histogram of review intervals
- Per-deck breakdown: stacked bar of new/due/learning per deck
- Charts destroyed on close to prevent memory leaks

### HelpModal (`Modal`)
- Quick reference: card formats, hotkeys, tips

### CustomStudyModal (`Modal`)
- Filter by tags, card state (new/due/learning/all)
- Card limit with unlimited option (cram mode)
- Launches ReviewModal with filtered queue

### ReviewNoteModal (`Modal`)
- Queue of notes tagged with `#review`
- Open note button, then rate recall (Again/Hard/Good/Easy)
- Skip button and keyboard shortcuts

### ResetProgressModal (`Modal`)
- Red warning card with consequences
- Current data statistics
- Type "delete" confirmation
- Destroys PouchDB, rebuilds from scratch

### OptimizerModal (`Modal`)
- Shows dataset stats (reviews, cards, avg reviews/card)
- "Run optimization" button, live progress updates (epoch/loss)
- Before/after weight comparison table
- Loss improvement percentage
- Apply / Discard buttons

### Settings tab (`PluginSettingTab`)
- 4 tabs: General, Sync, Advanced, About
- General: PouchDB toggle/migration, deck tag, review limits, font size, reset progress
- Sync: enable/disable, CouchDB URL/credentials, test/status
- Advanced: FSRS parameters (retention, interval, weights), weight optimizer
- About: version, inline quick reference guide

---

## Commands & events

### Commands (8)
| ID | Action |
|---|---|
| `add-fsrs-flashcard` | Insert block card template at cursor |
| `add-single-line-card` | Insert Q::A single-line template |
| `add-reversed-card` | Insert Q:::A reversed template |
| `add-cloze-card` | Insert cloze template |
| `open-fsrs-dashboard` | Open dashboard view |
| `sync-now` | Trigger sync (PouchDB only) |
| `check-sync-status` | Show sync status notice |
| `review-notes` | Open note review queue |
| `reset-all-card-progress` | Open reset modal |

### Registered events (4)
| Event | Handler |
|---|---|
| `vault.on('create')` | `updateFile()` + debounced refresh |
| `vault.on('modify')` | `updateFile()` + debounced refresh |
| `vault.on('delete')` | `removeDeck()` + `updateFile()` + debounced refresh |
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
- `pnpm run test` — vitest run (18 tests)
- `pnpm run test:watch` — vitest watch mode

### Release
Push semver tag (e.g., `1.1.0`) → GitHub Actions:
1. Validate tag matches `manifest.json` version
2. `pnpm install && pnpm run lint && pnpm run build`
3. Create release with `main.js`, `manifest.json`, `styles.css`

### Security
- Passwords stored in settings (Obsidian data.json)
- URLs logged with password masked
- `sanitizeCredentialForUrl()` prevents URIError from `%` characters
- `crypto-js` removed in v1.0.1; uses synchronous `cyrb53` hash (works without Secure Context)

---

## Performance considerations

- `buildIndex()` iterates all markdown files — O(n) file reads
- `getStats()` iterates all cards and review history — O(n) memory
- FSRS optimizer uses evolutionary strategy — O(generations × population × reviews)
- Chart.js charts created once, destroyed on modal close
- PouchDB writes are async but not batched — each updateCard triggers separate IndexedDB writes
- No caching layer — stats are recalculated from scratch on every render
