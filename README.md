<div align="center">

<img src="https://img.shields.io/badge/Obsidian-Plugin-7C3AED?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian Plugin">
<img src="https://img.shields.io/github/v/release/sapienskid/Lemma?style=flat-square&color=7C3AED&label=version" alt="Version">
<img src="https://img.shields.io/github/license/sapienskid/Lemma?style=flat-square&color=22c55e" alt="License">
<img src="https://img.shields.io/badge/algorithm-FSRS%204.5-f59e0b?style=flat-square" alt="FSRS">
<img src="https://img.shields.io/badge/platform-Desktop%20%7C%20Mobile-3b82f6?style=flat-square" alt="Platform">

<br/><br/>

<h1>Lemma — Flashcards for Obsidian</h1>

<p><strong>A modern, FSRS-powered spaced repetition plugin that lives inside your notes.</strong><br>
No separate app. No manual data export. Write, tag, and study directly where your knowledge lives.</p>

<a href="obsidian://show-plugin?id=lemma-flashcards"><img src="https://img.shields.io/badge/Install%20in%20Obsidian-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white" alt="Install in Obsidian"></a>
&nbsp;
<a href="https://github.com/sapienskid/Lemma/issues/new?labels=bug"><img src="https://img.shields.io/badge/Report%20Issue-ef4444?style=for-the-badge" alt="Report Bug"></a>
&nbsp;
<a href="https://github.com/sapienskid/Lemma/issues/new?labels=enhancement"><img src="https://img.shields.io/badge/Request%20Feature-22c55e?style=for-the-badge" alt="Request Feature"></a>

</div>

---

## Preview

<p align="center">
  <img src="screenshots/lemma-dashboard.png" width="49%" alt="Lemma Dashboard — decks with due counts at a glance">
  <img src="screenshots/lemma-review-modal.png" width="49%" alt="Immersive review mode with FSRS scheduling and LaTeX support">
</p>
<p align="center">
  <img src="screenshots/lemma_mobile_dashboard.jpg" width="32%" alt="Mobile dashboard">
  <img src="screenshots/lemma_mobile_review.jpg" width="32%" alt="Mobile review — full screen, native layout">
  <img src="screenshots/lemma_mobile_stats.jpg" width="32%" alt="Mobile statistics panel">
</p>
<p align="center"><em>Desktop and mobile · LaTeX math support · Learning analytics · Custom study sessions</em></p>

---

## Why Lemma?

Most spaced repetition tools require leaving your knowledge base, exporting notes, and managing a secondary database. Lemma embeds spaced repetition directly in Markdown.

> **Notes are decks.** Add `#flashcards` to any note, write cards in plain Markdown, and let FSRS handle scheduling.

| Feature | Lemma | Anki | Standard SR Plugins |
|---|:---:|:---:|:---:|
| Native Markdown workflow | Yes | No | Yes |
| FSRS scheduling | Yes | Yes (addon) | Partial |
| Mobile support | Yes | Yes | Varies |
| LaTeX / rich Markdown | Yes | Yes | Varies |
| Cross-device sync (CouchDB) | Yes | Yes | No |
| Custom study sessions | Yes | Yes | No |
| Zero file clutter | Yes | N/A | Varies |
| Open source | Yes | Yes | Yes |

---

## Features

### FSRS Scheduling
Lemma uses **FSRS** (Free Spaced Repetition Scheduler), a modern scheduling algorithm developed from cognitive science research. It models memory stability and retrievability based on your individual recall patterns.

### Cards Live in Notes
Write flashcards directly in any Markdown note without imports or app switching.

```markdown
---card--- ^fsrs-abc123
What is the powerhouse of the cell?
---
**Mitochondria** — produces ATP through cellular respiration.
```

### Cloze Deletions
```markdown
The ==c1::mitochondria== is the powerhouse of the ==c2::cell==.
```
Each cloze deletion is scheduled independently.

### Dashboard View
View all decks in a single overview with due counts, new cards, and total reviewed.

### Custom Study Sessions
Filter review queues by **tag**, **card state** (new, learning, due), or configure a **card limit** for targeted study and exam preparation.

### Review Statistics
Analyze learning progress with retention curves, card maturity distribution, interval histograms, 30-day activity, and 7-day forecast charts.

### Mobile Support
Responsive review interface designed for desktop and mobile, with safe-area insets and touch-optimized navigation.

### Optional CouchDB Sync
Connect to self-hosted CouchDB or Cloudant instances to sync review history seamlessly across devices.

---

## Quick Start

1. Install from Community Plugins: search for **Lemma**.
2. Add `#flashcards` to any note's frontmatter or inline:

```yaml
---
tags: [flashcards]
---
```

3. Write a card:

```markdown
---card--- ^my-first-card
What is spaced repetition?
---
A learning technique that schedules reviews at increasing intervals to maximize long-term retention.
```

4. Open the **Lemma dashboard** from the status bar or Command Palette (**Open dashboard**).

**Full syntax documentation:** [FLASHCARD_GUIDE.md](FLASHCARD_GUIDE.md)

---

## Card Formats

### Basic Cards

````markdown
---card--- ^unique-id
Front content (question)
---
Back content (answer with **Markdown**, $LaTeX$, and images)
````

### Single-Line Cards

```markdown
Question::Answer ^single-001
Reversed Question:::Reversed Answer ^rev-001
```

### Cloze Deletion Cards

```markdown
The ==c1::Ebbinghaus== forgetting curve shows memory decays without ==c2::repetition==.
```

> [!TIP]
> Add a `^block-id` to any card so review history persists across content edits.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` / `Enter` | Reveal answer |
| `1` | Again |
| `2` | Hard |
| `3` | Good |
| `4` | Easy |
| `Esc` | Exit session |

---

## Commands

| Command | Description |
|---|---|
| `Add a new flashcard` | Insert a card template with a pre-generated block ID |
| `Add a single-line card` | Insert a single-line card template |
| `Add a reversed card` | Insert a bidirectional card template |
| `Add a cloze card` | Insert a cloze deletion template |
| `Create cloze from selection` | Wrap selected text in cloze syntax |
| `Open dashboard` | Open the Lemma deck overview |
| `Sync now` | Trigger a manual CouchDB sync |
| `Check sync status` | View sync connection status |
| `Review due notes` | Start whole-note review session |
| `Reset all card progress` | Reset all scheduling data |

---

## Settings

| Setting | Description |
|---|---|
| **Deck tag** | Tag identifying deck files (default: `flashcards`) |
| **Max new cards/day** | Daily limit on new card introductions |
| **Max reviews/day** | Daily limit on review cards |
| **Review font size** | Font size in the review modal |
| **FSRS parameters** | Algorithm weights and retention target configuration |
| **PouchDB storage** | IndexedDB storage engine for collections |
| **Sync** | CouchDB connection and credential settings |

---

## Installation

### Community Plugin Directory
1. Open **Settings → Community plugins**
2. Click **Browse** and search for **Lemma**
3. Select **Install**, then **Enable**

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/sapienskid/Lemma/releases/latest)
2. Copy the files into:
   ```
   <vault>/.obsidian/plugins/lemma-flashcards/
   ```
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Contributing

Contributions, bug reports, and feature requests are welcome.

- **Issue tracker:** [GitHub issues](https://github.com/sapienskid/Lemma/issues)
- **Pull requests:** Open a pull request against `main`

---

## License

ISC License — see [LICENSE](LICENSE) for details.
