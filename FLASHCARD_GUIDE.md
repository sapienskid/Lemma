# Lemma - Flashcard Creation Guide

A complete guide to creating flashcards in Obsidian using the Lemma plugin.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic Cards](#basic-cards)
3. [Cloze Deletion Cards](#cloze-deletion-cards)
4. [Card IDs & Editing](#card-ids--editing)
5. [Markdown Support](#markdown-support)
6. [Quick Commands](#quick-commands)
7. [Best Practices](#best-practices)

---

## Getting Started

### 1. Create a Deck

Any note with the `#flashcards` tag (default) becomes a deck. Add the tag to frontmatter or as an inline tag:

**Frontmatter method:**
```yaml
---
tags: [flashcards]
---
```

**Inline method:**
```markdown
# My Study Notes #flashcards
```

### 2. Add Cards

Add cards to your deck using the syntax described below. The plugin will automatically detect and index them.

### 3. Study

Open the **Lemma dashboard** via:
- Ribbon icon (📚)
- Command palette: `Open dashboard`

---

## Basic Cards

Basic cards have a **front** (question) and **back** (answer).

### Syntax

```markdown
---card--- ^block-id
Front content here
---
Back content here
```

### Examples

**Simple Q&A:**
```markdown
---card--- ^fsrs-abc123
What is the capital of France?
---
Paris
```

**With Markdown Formatting:**
```markdown
---card--- ^fsrs-def456
What is the formula for **Einstein's mass-energy equivalence**?
---
$E = mc^2$

Where:
- $E$ = energy
- $m$ = mass
- $c$ = speed of light
```

**With Lists:**
```markdown
---card--- ^fsrs-ghi789
Name the three states of matter
---
1. Solid
2. Liquid
3. Gas

*Bonus: Plasma is the fourth state*
```

**Multi-line Back:**
```markdown
---card--- ^fsrs-jkl012
Explain the process of photosynthesis
---
Photosynthesis is the process by which plants convert:

**Light energy** → **Chemical energy**

The basic equation:
$$6CO_2 + 6H_2O + light \rightarrow C_6H_{12}O_6 + 6O_2$$
```

### Card Delimiter

- Start with `---card---` (case insensitive)
- Separate front/back with a single `---` line
- The `^block-id` is optional but recommended for stable card identities

---

## Cloze Deletion Cards

Cloze cards hide specific words/phrases within a sentence. Great for:
- Fill-in-the-blank style learning
- Memorizing definitions in context
- Language learning

### Syntax

```markdown
==c1::hidden text==
```

- `c1` = cloze number (supports c1, c2, c3, etc.)
- `hidden text` = the content to be hidden during review

### Examples

**Single Cloze:**
```markdown
The capital of France is ==c1::Paris==.
```

**Multiple Clozes (same paragraph):**
```markdown
==c1::Mitochondria== is the powerhouse of the cell, producing ==c2::ATP== through cellular respiration.
```

**Sequential Learning (c1, c2, c3):**
```markdown
The three branches of the US government are: ==c1::Legislative==, ==c2::Executive==, and ==c3::Judicial==.
```

**With Block ID for editing:**
```markdown
The quadratic formula is ==c1::x = (-b ± √(b² - 4ac)) / 2a==. ^my-math-card
```

### How Cloze Cards Display

| Original | Front Shows | Back Shows |
|----------|-------------|------------|
| `The ==c1::capital== of France` | `The [...] of France` | `The capital of France` |

### Important Notes

- Each cloze number creates a **separate card**
- `==c1::text==` and `==c2::text==` in the same paragraph = 2 cards
- Clozes must be in the **same paragraph** to be grouped
- Empty lines break paragraphs (creates separate cards)

---

## Card IDs & Editing

### Why Use Block IDs?

Block IDs (`^unique-id`) ensure your cards maintain their review history even when you edit them.

**Without Block ID:**
- Card ID is generated from file path + front content hash
- Editing the front resets your progress 😢

**With Block ID:**
- Card ID is based on the block ID
- Edit freely without losing progress 😊

### Generating Block IDs

Use the command palette: **`Add a new flashcard`**

This inserts a template with a pre-generated ID:
```markdown
---card--- ^fsrs-a1b2c3

---

```

### Manual ID Format

- Start with `fsrs-` (recommended) or use any alphanumeric string
- Example valid IDs: `^fsrs-abc123`, `^my-card-001`, `^chemistry-5`
- Place at the end of the front section, after `---card---`

---

## Markdown Support

All Obsidian Markdown features work in cards:

| Feature | Example |
|---------|---------|
| **Bold/Italic** | `**bold**`, `*italic*` |
| **Links** | `[[Internal Link]]`, `[External](url)` |
| **Images** | `![[image.png]]` |
| **Math (LaTeX)** | `$inline$`, `$$block$$` |
| **Code** | `` `inline` `` or code blocks |
| **Tables** | Standard Markdown tables |
| **Lists** | `- bullet`, `1. numbered` |
| **Highlight** | `==highlight==` (except cloze syntax) |
| **Embeds** | `![[Another Note]]` |
| **Callouts** | `> [!info]` |

### Example with Full Formatting

```markdown
---card--- ^fsrs-full-example
What is the **Pythagorean theorem**?
---
In a right triangle:

$$a^2 + b^2 = c^2$$

Where:
| Variable | Meaning |
|----------|---------|
| $a, b$ | Legs of the triangle |
| $c$ | Hypotenuse |

> [!tip] Remember: The hypotenuse is always the longest side!

See also: [[Geometry Basics]]
```

---

## Quick Commands

| Command | Action | Hotkey |
|---------|--------|--------|
| `Add a new flashcard` | Insert basic card template | - |
| `Open dashboard` | Open study dashboard | - |
| `Sync Now` | Manual sync (if enabled) | - |
| `Check Sync Status` | View sync status | - |

### Review Session Hotkeys

| Key | Action |
|-----|--------|
| `Space` / `Enter` | Show answer |
| `1` | Rate: Again |
| `2` | Rate: Hard |
| `3` | Rate: Good |
| `4` | Rate: Easy |
| `←` / `→` | Navigate (Browse mode) |

---

## Best Practices

### Card Design

1. **One concept per card** - Don't overload cards with information
2. **Be specific** - "What is 2+2?" > "What are some math facts?"
3. **Use your own words** - Aids comprehension and retention
4. **Include context** - Brief context helps trigger memory

### Cloze Tips

```markdown
❌ Avoid: The ==c1::quick brown fox jumps over the lazy dog==.
✅ Better: The ==c1::quick brown fox== jumps over the lazy dog.

❌ Avoid: ==c1::Paris== is the capital of ==c2::France== and has ==c3::2.1 million== people.
✅ Better: Split into focused clozes or separate cards
```

### Organization

```markdown
---
tags: [flashcards, chemistry, organic]
---

# Organic Chemistry - Alkanes #flashcards

## Basic Definitions

---card--- ^chem-001
What is the general formula for alkanes?
---
$C_nH_{2n+2}$

Examples:
- Methane: $CH_4$
- Ethane: $C_2H_6$

---card--- ^chem-002
What type of bonds do alkanes contain?
---
Only **single covalent bonds** (C-C and C-H)

This makes them ==c1::saturated== hydrocarbons. ^chem-003
```

### Tagging for Custom Study

Use tags in your deck notes to enable filtered study sessions:

```markdown
---
tags: [flashcards, biology, chapter-1, exam-prep]
---
```

Then use **Custom Study Session** → Filter by Tags: `#biology, #exam-prep`

---

## Troubleshooting

### Cards Not Appearing?

1. Check that the file has the `#flashcards` tag
2. Verify syntax (especially `---` separators for basic cards)
3. Check the **Dashboard** → Refresh button
4. Look for console errors (Ctrl+Shift+I)

### Review Progress Reset?

- You likely edited a card without a block ID
- Always use `^block-id` for cards you plan to edit

### Cloze Not Working?

- Ensure syntax is exactly `==c1::text==` (no spaces)
- Check that clozes are in the same paragraph
- Verify the paragraph is in a `#flashcards` tagged file

---

## Examples Deck

```markdown
---
tags: [flashcards]
---

# Sample Flashcard Deck

## Geography

---card--- ^geo-001
What is the largest ocean on Earth?
---
The **Pacific Ocean**

It covers approximately ==c1::63 million square miles==. ^geo-002

## Programming

---card--- ^code-001
What does the `map()` function do in JavaScript?
---
Creates a new array by applying a function to every element.

```javascript
const doubled = [1, 2, 3].map(x => x * 2);
// Result: [2, 4, 6]
```

## Spaced Repetition Facts

The ==c1::Forgetting Curve== was discovered by ==c2::Hermann Ebbinghaus== in ==c3::1885==. ^sr-001

FSRS stands for ==c1::Free Spaced Repetition Scheduler==. ^sr-002
```

---

Happy studying! 📚✨
