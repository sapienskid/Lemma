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
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["FSRS", "URL", "JSON"],
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
		],
	},
]);
