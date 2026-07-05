<div align="center">

<img src="https://img.shields.io/badge/Obsidian-Plugin-7C3AED?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian Plugin">
<img src="https://img.shields.io/github/v/release/sapienskid/Lemma?style=flat-square&color=7C3AED&label=version" alt="Version">
<img src="https://img.shields.io/github/license/sapienskid/Lemma?style=flat-square&color=22c55e" alt="License">
<img src="https://img.shields.io/badge/algorithm-FSRS%204.5-f59e0b?style=flat-square" alt="FSRS">
<img src="https://img.shields.io/badge/platform-Desktop%20%7C%20Mobile-3b82f6?style=flat-square" alt="Platform">

<br/><br/>

<h1>🧠 Lemma — Flashcards for Obsidian</h1>

<p><strong>The modern, FSRS-powered flashcard plugin that lives inside your notes.</strong><br>
No separate app. No data export. Just write, tag, and study — right where your knowledge lives.</p>

<a href="obsidian://show-plugin?id=lemma-flashcards"><img src="https://img.shields.io/badge/Install%20in%20Obsidian-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white" alt="Install in Obsidian"></a>
&nbsp;
<a href="https://github.com/sapienskid/Lemma/issues/new?labels=bug"><img src="https://img.shields.io/badge/Report%20a%20Bug-ef4444?style=for-the-badge" alt="Report Bug"></a>
&nbsp;
<a href="https://github.com/sapienskid/Lemma/issues/new?labels=enhancement"><img src="https://img.shields.io/badge/Request%20a%20Feature-22c55e?style=for-the-badge" alt="Request Feature"></a>

</div>

---

## 📸 See It in Action

<p align="center">
  <img src="screenshots/lemma-dashboard.png" width="49%" alt="Lemma Dashboard — all your decks with due counts at a glance">
  <img src="screenshots/lemma-review-modal.png" width="49%" alt="Immersive review mode with FSRS scheduling and LaTeX support">
</p>
<p align="center">
  <img src="screenshots/lemma_mobile_dashboard.jpg" width="32%" alt="Mobile dashboard">
  <img src="screenshots/lemma_mobile_review.jpg" width="32%" alt="Mobile review — full screen, native feel">
  <img src="screenshots/lemma_mobile_stats.jpg" width="32%" alt="Mobile statistics panel">
</p>
<p align="center"><em>Desktop + Mobile · LaTeX Math Support · Activity Charts · Custom Study Sessions</em></p>

---

## ✨ Why Lemma?

Most spaced repetition tools force you to leave Obsidian, export your notes, and manage a separate database. **Lemma doesn't.**

> **Your notes are your decks.** Add a `#flashcards` tag to any note, write cards in familiar Markdown, and Lemma handles the science of when to review them.

| Feature | Lemma | Anki | Other SR Plugins |
|---|:---:|:---:|:---:|
| Lives inside Obsidian | ✅ | ❌ | ✅ |
| FSRS 4.5 algorithm | ✅ | ✅ (addon) | Partial |
| Native mobile support | ✅ | ✅ | ⚠️ varies |
| LaTeX / rich Markdown | ✅ | ✅ | ⚠️ varies |
| Cross-device sync (CouchDB) | ✅ | ✅ | ❌ |
| Custom study sessions | ✅ | ✅ | ❌ |
| Zero file pollution | ✅ | N/A | ⚠️ varies |
| Open source & free | ✅ | ✅ | ✅ |

---

## 🚀 Features

### 🔬 FSRS Scheduling — The Science of Memory
Lemma uses **FSRS 4.5** (Free Spaced Repetition Scheduler), the state-of-the-art algorithm developed from 20 years of cognitive science research. It outperforms classic SM-2 by learning *your* forgetting curve — not a one-size-fits-all approximation.

### 📝 Cards Live in Your Notes
Write flashcards directly in any Markdown note. No imports, no exports, no app switching.

```markdown
---card--- ^fsrs-abc123
What is the powerhouse of the cell?
---
**Mitochondria** — produces ATP through cellular respiration.
```

### 🔵 Cloze Deletions — Fill-in-the-Blank Style
```markdown
The ==c1::mitochondria== is the powerhouse of the ==c2::cell==.
```
Each cloze number becomes a separate, independently scheduled card.

### 📊 Dashboard View
See all your decks in one place — due counts, new cards, and total reviewed — so you always know exactly where to focus.

### 🎯 Custom Study Sessions
Cramming for an exam? Filter cards by **tag**, **card state** (new / learning / due), or set a **card limit**. Exam mode is just three clicks away.

### 📈 Review Statistics
Track your 30-day activity streak and 7-day forecast chart to stay consistent and motivated.

### 📱 Full Mobile Support
Lemma is built for both desktop and mobile. The review interface is fully responsive, with native safe-area support for notched devices and large tap targets.

### ☁️ Optional CouchDB Sync
Already running a self-hosted CouchDB instance (or using a service like Cloudant)? Connect once and your review history syncs seamlessly across all devices.

---

## ⚡ Quick Start (2 minutes)

**Step 1:** Install from Community Plugins → search **"Lemma"**

**Step 2:** Add `#flashcards` to any note's frontmatter or inline

```yaml
---
tags: [flashcards]
---
```

**Step 3:** Write your first card

```markdown
---card--- ^my-first-card
What is spaced repetition?
---
A learning technique that schedules reviews at increasing intervals to maximize long-term retention.
```

**Step 4:** Open the **Lemma Dashboard** from the status bar or Command Palette → **"Open dashboard"**

That's it. Lemma automatically detects your cards and schedules them for optimal review.

📖 **Full card syntax guide:** [FLASHCARD_GUIDE.md](FLASHCARD_GUIDE.md)

---

## 🃏 Card Formats

### Basic Q&A Cards

````markdown
---card--- ^unique-id
Front content (question)
---
Back content (answer, supports **Markdown**, $LaTeX$, ![[images]], and more)
````

### Cloze Deletion Cards

```markdown
The ==c1::Ebbinghaus== forgetting curve shows memory decays without ==c2::repetition==.
```

> 💡 **Pro tip:** Add a `^block-id` to any card so its review history persists even when you edit the card text.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `Enter` | Reveal answer |
| `1` | Again (forgot) |
| `2` | Hard |
| `3` | Good |
| `4` | Easy |
| `Esc` | Exit session |

---

## 🛠 Commands

| Command | Description |
|---------|-------------|
| `Add a new flashcard` | Insert a card template with a pre-generated block ID |
| `Open dashboard` | Open the Lemma deck overview |
| `Sync now` | Trigger a manual CouchDB sync |
| `Check sync status` | View sync connection status |
| `Reset all card progress` | Clear all scheduling data |

---

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Deck tag** | Tag that marks a note as a deck (default: `flashcards`) |
| **Max new cards/day** | Daily cap on new card introductions |
| **Max reviews/day** | Daily cap on review cards |
| **Review font size** | Font size in the review modal |
| **FSRS parameters** | Advanced: tune the scheduling algorithm to your memory |
| **PouchDB storage** | Use IndexedDB for large collections (10k+ cards) |
| **Sync** | CouchDB server URL, username, and password |

---

## 📦 Installation

### Option A — Community Plugin Browser (Recommended)
1. Open **Settings → Community plugins**
2. Click **Browse** and search for **Lemma**
3. Click **Install**, then **Enable**

### Option B — Direct Install Link
Click → [**Add to Obsidian**](obsidian://show-plugin?id=lemma-flashcards)

### Option C — Manual Installation
1. Download the [latest release](https://github.com/sapienskid/Lemma/releases/latest)
2. Copy `main.js`, `manifest.json`, and `styles.css` to:
   ```
   <your-vault>/.obsidian/plugins/lemma-flashcards/
   ```
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## 🤝 Contributing

Bug reports, feature requests, and PRs are all welcome!

- **Found a bug?** [Open an issue](https://github.com/sapienskid/Lemma/issues)
- **Have an idea?** [Start a discussion](https://github.com/sapienskid/Lemma/issues)
- **Want to contribute code?** Fork the repo and open a PR against `main`

---

## 📄 License

ISC License — see [LICENSE](LICENSE) for details.

---

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

<div align="center">

**If Lemma helps you study smarter, consider giving it a ⭐ on GitHub — it helps others discover it!**

Made with ❤️ by [Sabin Pokharel](https://github.com/sapienskid)

</div>
