# Contributing to Lemma

Thank you for contributing to Lemma. We welcome bug reports, feature suggestions, and code contributions.

## Development Workflow

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v9 or higher)

### Setup

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/Lemma.git
   cd Lemma
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```

### Available Scripts

- `pnpm run build` — Typecheck and bundle with esbuild in production mode.
- `pnpm run dev` — Watch mode for rapid development.
- `pnpm run test` — Run the Vitest test suite.
- `pnpm run lint` — Run ESLint with Obsidian plugin rules.
- `pnpm run lint:fix` — Automatically fix linting violations.
- `node deploy.mjs <vault-path>` — Build and deploy the plugin to an Obsidian vault for live testing.

## Code Conventions

- **Sentence case for UI labels:** Use "API configuration", not "API Configuration".
- **Obsidian guidelines:** Follow all official guidelines from `eslint-plugin-obsidianmd`.
- **DataManager owns state:** UI components read from `DataManager`, never duplicating or holding independent state.
- **Type safety:** Avoid `any` where possible. Use `instanceof` guards for Obsidian vault and DOM types.
- **Accessibility:** Ensure interactive elements support keyboard navigation (`Enter` and `Space`) and provide descriptive ARIA labels.

## Testing & Quality Assurance

Before submitting a pull request:

1. Run the test suite:
   ```bash
   pnpm run test
   ```
2. Check for linting errors and style issues:
   ```bash
   pnpm run lint
   ```
3. Verify the production build:
   ```bash
   pnpm run build
   ```
4. Test the built plugin in a live Obsidian vault using `deploy.mjs`.

## Submitting Pull Requests

1. Create a descriptive feature branch from `main`.
2. Commit changes with clear, concise messages.
3. Push to your fork and open a pull request against `main`.
4. Provide a clear description of the changes, motivation, and any testing performed.
