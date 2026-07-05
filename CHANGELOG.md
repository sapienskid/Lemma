# Changelog

All notable changes to this project will be documented in this file.

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
