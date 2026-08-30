# Changelog

All notable changes to this project will be documented in this file.

## [1.1.2] - 2026-08-30

### Added
- **Declarative Settings Search:** Implemented `getSettingDefinitions()` on [`FSRSSettingsTab`](file:///run/media/sapiens/Development/Lemma/src/ui/FSRSSettingsTab.ts) to support Obsidian 1.13+ settings search and satisfy community review standards.

## [1.1.1] - 2026-08-29

### Added
- **Contributing Guide:** Added comprehensive [`CONTRIBUTING.md`](file:///run/media/sapiens/Development/Lemma/CONTRIBUTING.md) for open-source community guidelines.
- **Note Review Preview:** Added live Markdown rendering in [`ReviewNoteModal`](file:///run/media/sapiens/Development/Lemma/src/ui/ReviewNoteModal.ts) so notes tagged with `#review` display full formatted note content during review.
- **Enhanced Type-In Answers:** Type-in cards now display detailed feedback and reveal full rating controls (Again, Hard, Good, Easy) for complete review agency.

### Fixed
- **Scorecard & Linter Compliance:** Fully resolved all ESLint directives and Obsidian plugin scanner rules (`prefer-create-el`, `prefer-window-timers`, `no-explicit-any`, type assertions).
- **FSRS Weight Validation:** Updated [`FSRSSettingsTab`](file:///run/media/sapiens/Development/Lemma/src/ui/FSRSSettingsTab.ts) to support the full 19-weight FSRS 4.5/5.0 parameter array, ensuring seamless integration with the built-in weight optimizer.
- **Mobile Swipe Handling:** Refined gesture detection in [`ReviewModal`](file:///run/media/sapiens/Development/Lemma/src/ui/ReviewModal.ts) to prevent conflict between vertical card scrolling and rating swipes.
- **Community Scorecard Compliance:** Updated [`manifest.json`](file:///run/media/sapiens/Development/Lemma/manifest.json) description to strictly adhere to Obsidian community guidelines (omitting restricted terms and ensuring punctuation compliance).
- **Clean Documentation:** Removed all emoji glyphs across all documentation and guides for clean, professional presentation.

## [1.0.1] - 2026-07-05

### Fixed
- **Mobile Compatibility:** Fully resolved initialization crashes on Obsidian Mobile by migrating from the Web Crypto API to a synchronous `cyrb53` hash function.
- **Dependency Issues:** Bundled browser polyfills for Node internals (like `events`) required by PouchDB, preventing fatal `Module Not Found` errors on Capacitor/Cordova WebViews.
- **Mobile Ribbon Icon:** Added a new icon to the mobile ribbon menu, making it easy to open the Lemma dashboard with a single tap.
- **Dashboard Layout:** The dashboard now dynamically forces itself into the main workspace tab instead of getting cramped in a hidden sidebar layout.
- **Immersive Review UI:** Redesigned the mobile flashcard review modal. Removed bulky card styling so content seamlessly fills the screen edge-to-edge.
- **Safe Area Insets:** Fixed bugs where the mobile device notch and bottom swipe bars overlapped the review modal. The header and close button now perfectly respect device safe areas (`--safe-area-inset-top`).
- **Compact Badges:** Replaced long wrapping modal titles with a beautiful, space-saving pill badge (e.g., `1/20`) for the review counter on narrow screens.
- **Security Check:** Removed the outdated `crypto-js` dependency, entirely clearing plugin security scan warnings.

## [1.0.0] - Initial Release

- Initial stable release featuring FSRS scheduling algorithm.
- Added support for basic and cloze cards.
- Integrated dashboard view with due counts and statistics.
- Added CouchDB sync capabilities.
