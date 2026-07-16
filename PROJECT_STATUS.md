# Lemma — Project status

## Current state (v1.1.0-dev)

All core features are implemented and functional:

### Phase 1 — Foundation (completed)
- [x] Modular code structure (`src/data/`, `src/ui/`, `src/plugin/`)
- [x] Test suite — Vitest, 18 tests, Obsidian + PouchDB mocks
- [x] Single-line card syntax (`Q::A` basic, `Q:::A` reversed)
- [x] Stable block IDs for single-line cards (`^blockId` suffix)
- [x] Whole-note review (`#review` tag system)
- [x] Daily review limits with cross-session load balancing
- [x] Card context breadcrumbs (heading hierarchy displayed in review)
- [x] FSRS 4.5 scheduling (ts-fsrs)
- [x] Basic card format (`---card---`)
- [x] Cloze deletion format (`==c1::text==`)
- [x] Dashboard with deck list, folder grouping, stat pills
- [x] Full-screen review modal with keyboard shortcuts + swipe gestures
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

### Phase 2 — Differentiators (in progress)
- [x] FSRS weight optimizer (evolutionary strategy, pure TypeScript)
- [x] Swipe gesture review (left/right/up/down, pointer events)
- [ ] **Stats v2** — retention curve, maturity donut, monthly heatmap, interval histogram, per-deck breakdown
- [ ] Type-in-answer cards (active recall typing)
- [ ] Per-deck settings overrides

### Phase 3 — Polish (planned)
- [ ] Data export/import (JSON backup/restore)
- [ ] i18n framework for community translations
- [ ] Plugin API for external card creation
- [ ] Enhanced sync (conflict resolution, status indicator)

## Known gaps & pain points

### Performance
- `buildIndex()` reads every markdown file in the vault — should track modified times
- `updateCard()` writes to PouchDB one doc at a time — batch writes would reduce IndexedDB overhead
- `recalculateAllDeckStats()` iterates all cards — spread across idle cycles

### Type errors
- `@types/pouchdb` has incompatible type definitions, suppressed via `skipLibCheck`

### No WASM optimizer
- The FSRS optimizer is a pure-TypeScript evolutionary strategy, not the full fsrs-rs optimizer
- ~30 generations * 20 candidates = 600 evaluations, takes ~2-5s for typical review logs
- fsrs-browser (WASM) would be faster but adds Web Worker + SharedArrayBuffer complexity

## Near-term priorities

1. **Stats v2** — deeper learning analytics
2. **Type-in-answer cards** — active recall typing
3. **Per-deck settings** — per-deck new/review limits
4. **Performance** — diff-based rebuild, batch PouchDB writes
5. **i18n** — extract UI strings for community translation

## Long-term possibilities

- Deck templates (custom card CSS per deck)
- Image occlusion cards
- Obsidian Sync native support (vs CouchDB)
- Shared deck marketplace via CouchDB
- Collaborative decks (real-time shared review)

---

*Last updated: 2026-07-16*
