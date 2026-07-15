# Lemma — Agent Guide

## Quick start

```bash
pnpm install
pnpm run build        # typecheck + bundle
pnpm run lint         # eslint
pnpm run lint:fix     # auto-fix lint
pnpm run dev          # dev mode (no typecheck, sourcemaps)
node deploy.mjs <vault-path>   # copy built files to vault
```

## Code conventions

- **Sentence case** for labels: "API configuration" not "API Configuration"
- **No comments** unless explaining a non-obvious tradeoff
- **fsrs-** prefix for all CSS classes in `styles.css`
- **DataManager** owns all state; UI classes read from it, never duplicate state
- Settings are read/written through `plugin.settings` + `plugin.saveSettings()`
- Save settings immediately on every `onChange`, don't batch
- Use `isRecord()` and `getErrorMessage()` for safe unknown-type handling

## Architecture at a glance

```
main.ts (single file, ~2300 lines)
├── FSRSFlashcardsPlugin (main class)
├── DataManager (all data, FSRS, sync orchestration)
├── DashboardView (ItemView — deck list)
├── ReviewModal (Modal — study session)
├── BrowseModal (Modal — browse cards)
├── StatsModal (Modal — Chart.js stats)
├── CustomStudyModal (Modal — filtered study)
├── ResetProgressModal (Modal — nuclear reset)
└── FSRSSettingsTab (PluginSettingTab — 4 tabs)

src/database/
├── PouchDBManager.ts  (IndexedDB + CouchDB sync)
└── DataMigration.ts   (legacy JSON → PouchDB)
```

## Important patterns to follow

### Settings tab
Use the 4-tab pattern from `FSRSSettingsTab`:
- Tab nav uses `lemma-tab-*` CSS classes
- Each tab is a private `renderXxxTab(containerEl)` method
- Use `new Setting(containerEl).setName(...).setHeading()` for section titles
- No manual `<h3>` or HTML headings in settings

### Data flow
```
vault event → updateFile() → recalculateAllDeckStats() → refreshDashboardView()
review      → updateCard() → saveCardState()/addReviewLog() (PouchDB) or saveData() (JSON)
```

### Card IDs
- With block ID (`^abc123`): `deckId::blockId`
- Without: `cyrb53hex(filePath + '::' + front)` or `cyrb53hex(filePath + '::' + paragraph + '::' + clozeNum)`

### FSRS state machine
- `State.New` → no fsrsData or state is New
- `State.Learning` / `State.Relearning` → counts as "learning"
- `State.Review` → stability < 21 = "young", >= 21 = "mature"

### Sync
- PouchDB sync is live+retry by default
- Manual sync for dashboard button and settings test
- Credentials embedded in URL (sanitized for logging)
- Fatal HTTP statuses (401/403/404) cancel sync

## Testing

There is no test framework. Validate by:
1. `pnpm run build` (typecheck + bundle)
2. `pnpm run lint`
3. Deploy to vault, reload Obsidian, manually verify

## Release

Pushing a semver tag (e.g., `1.0.2`) triggers `.github/workflows/release.yml`:
lints → builds → creates GitHub release with `main.js`, `manifest.json`, `styles.css`.

**Do not push release tags unless explicitly asked.**

## Key files

| File | Purpose |
|---|---|
| `main.ts` | All plugin logic (~2300 lines) |
| `styles.css` | All styles (~1350 lines) |
| `src/database/PouchDBManager.ts` | IndexedDB + CouchDB sync layer |
| `src/database/DataMigration.ts` | Legacy data migration |
| `manifest.json` | Plugin metadata + version |
| `deploy.mjs` | Copies built files to vault |
| `esbuild.config.mjs` | Bundler config |
