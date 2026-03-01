import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (!manifest.id) {
	console.error('Missing "id" in manifest.json');
	process.exit(1);
}

const cliVaultPath = process.argv[2];
const defaultVaultPath = join(process.env.HOME ?? '', 'Obsidian', 'Vault');
const vaultPath = resolve(
	cliVaultPath ??
		process.env.OBSIDIAN_VAULT ??
		process.env.OBSIDIAN_VAULT_PATH ??
		defaultVaultPath
);

if (!existsSync(vaultPath)) {
	console.error(`Vault path does not exist: ${vaultPath}`);
	console.error(
		'Pass a vault path as an argument, or set OBSIDIAN_VAULT / OBSIDIAN_VAULT_PATH.'
	);
	process.exit(1);
}

const pluginId = manifest.id;
const pluginDir = join(vaultPath, '.obsidian', 'plugins', pluginId);
mkdirSync(pluginDir, { recursive: true });

const requiredFiles = ['main.js', 'manifest.json'];
const optionalFiles = ['styles.css', 'data.json'];

for (const file of requiredFiles) {
	if (!existsSync(file)) {
		console.error(`Required file not found: ${file}`);
		process.exit(1);
	}
	copyFileSync(file, join(pluginDir, file));
	console.log(`Copied ${file} -> ${pluginDir}`);
}

for (const file of optionalFiles) {
	if (!existsSync(file)) {
		continue;
	}
	copyFileSync(file, join(pluginDir, file));
	console.log(`Copied ${file} -> ${pluginDir}`);
}

const enabledPluginsPath = join(vaultPath, '.obsidian', 'community-plugins.json');
if (existsSync(enabledPluginsPath)) {
	try {
		const enabledPlugins = JSON.parse(readFileSync(enabledPluginsPath, 'utf8'));
		if (Array.isArray(enabledPlugins) && !enabledPlugins.includes(pluginId)) {
			console.warn(
				`Plugin ID "${pluginId}" is not currently enabled in community-plugins.json.`
			);
		}
	} catch (error) {
		console.warn(`Could not read enabled plugins list: ${String(error)}`);
	}
}

console.log(`Plugin deployed to ${pluginDir}. Reload Obsidian to apply changes.`);
