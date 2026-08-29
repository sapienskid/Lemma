import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			globals: {
				window: "readonly",
				document: "readonly",
				console: "readonly",
				setTimeout: "readonly",
				clearInterval: "readonly",
				setInterval: "readonly",
				crypto: "readonly",
			},
		},
		rules: {
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["FSRS", "URL", "JSON", "XP", "CRDT"],
					brands: ["Lemma", "Obsidian", "PouchDB", "CouchDB", "IndexedDB"],
				},
			],
		},
	},
	{
		ignores: [
			"node_modules/**",
			"main.js",
			"esbuild.config.mjs",
			"version-bump.mjs",
			"deploy.mjs",
			"vitest.config.ts",
			"tests/**",
		],
	},
]);
