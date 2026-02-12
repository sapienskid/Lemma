# Lemma publishing checklist

Use this checklist before opening a PR to `obsidianmd/obsidian-releases`.

## 1) Pre-release checks

- [ ] `pnpm install`
- [ ] `pnpm run build`
- [ ] Confirm `manifest.json` version matches `versions.json`.
- [ ] Confirm description in `manifest.json` ends with a period and is under 250 characters.
- [ ] Confirm `README.md` and `LICENSE` are present and up to date.

## 2) Create release

1. Commit all changes to `main`.
2. Tag with the exact manifest version (no `v` prefix):
   - `git tag 1.0.0`
   - `git push origin main`
   - `git push origin 1.0.0`
3. Wait for `.github/workflows/release.yml` to publish the release.
4. Verify release assets include:
   - `main.js`
   - `manifest.json`
   - `styles.css` (optional; omitted if not present)

## 3) Community plugins entry

Add this entry to `community-plugins.json` in your fork of `obsidianmd/obsidian-releases`:

```json
{
  "id": "lemma-flashcards",
  "name": "Lemma",
  "author": "Sapienskid",
  "description": "Create and review flashcards in your vault using the FSRS algorithm for spaced repetition.",
  "repo": "sapienskid/neuralcard"
}
```

## 4) PR checklist

- [ ] Release tag matches manifest version exactly.
- [ ] `id` in `manifest.json` matches community entry.
- [ ] PR body uses the official template without edits.
