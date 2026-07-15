# Lemma — Project status

## Current state (v1.0.1)

All core features are implemented and functional:

- [x] FSRS 4.5 scheduling (ts-fsrs)
- [x] Basic card format (`---card---`)
- [x] Cloze deletion format (`==c1::text==`)
- [x] Dashboard with deck list, folder grouping, stat pills
- [x] Full-screen review modal with keyboard shortcuts
- [x] Card browser (browse modal)
- [x] Statistics (30-day activity + 7-day forecast charts)
- [x] Custom study sessions (filter by tag, state, limit)
- [x] PouchDB/IndexedDB storage (default)
- [x] Legacy JSON storage fallback
- [x] CouchDB sync (live + manual)
- [x] Data migration (JSON → PouchDB)
- [x] 4-tab settings UI
- [x] Reset progress (nuclear option)
- [x] Responsive/mobile design
- [x] Sync to Obsidian community plugin list

## Known gaps & pain points

### No test suite
The project has zero tests. All validation is manual: build → deploy → reload → click around.
- Critical for review logic (FSRS state transitions, scheduling calculations)
- Needed for card parsing (edge cases in `---card---` and cloze regex)
- Needed for sync (CouchDB interactions, error handling, retry logic)

### Single-file bottleneck
All ~2300 lines of `main.ts` handle plugin, data, and UI. This makes the file:
- Hard to navigate (search-dependent)
- Prone to merge conflicts
- Difficult to reason about class boundaries

### Settings UI conventions
The current tab implementation uses `createEl('div')` for the quick reference grid. The Obsidian ESLint rule prefers `Setting.setName()` over manual HTML, but the quick reference content is purely informational so this is acceptable.

### Type errors
`node_modules/@types/pouchdb` has incompatible type definitions. Currently suppressed via `skipLibCheck` in tsconfig.

## Near-term priorities (next 3-6 months)

1. **Test framework** — vitest with Obsidian API mocks
   - FSRS scheduling edge cases (new → learning → review transitions)
   - Card parsing (basic, cloze, block IDs, Unicode, edge cases)
   - DataManager methods (getReviewQueue, getStats)
   - PouchDB interaction (mocked)

2. **Refactor main.ts** — split into modules:
   - `src/data/` — DataManager, types, constants
   - `src/ui/` — Dashboard, Modals, Settings, Browsing
   - `src/plugin/` — main plugin class

3. **Sync improvements**
   - Conflict resolution strategy (last-write-wins currently)
   - Sync status indicator in settings (green/yellow/red dot)
   - Selective sync (per-deck or per-tag)

4. **Settings polish**
   - Export/import settings
   - Per-deck overrides (override new/review limits per deck)

## Long-term possibilities

- Deck templates (custom card CSS per deck)
- Image occlusion cards
- FSRS optimizer (auto-tune weights from review history)
- Plugin API for other plugins to create cards
- Obsidian Sync native support (vs CouchDB)

---

*Last updated: 2026-07-15*
