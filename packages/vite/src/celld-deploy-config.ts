/**
 * celld deploy configuration.
 *
 * Unlike the Cloudflare target — where the sibling `@cloudflare/vite-plugin`
 * owns the wrangler config end to end — a celld project has no sibling, so
 * the `flue()` plugin reads the user's authored wrangler file itself,
 * validates it against celld's accepted key subset, and writes the merged
 * result as `<outDir>/wrangler.json` next to the bundled Worker. The output
 * directory is the deployable unit: `celld deploy <outDir>` consumes it.
 *
 * celld (https://celld.dev) runs Cloudflare Workers and Durable Objects on
 * infrastructure you own: each Durable Object is its own SQLite database,
 * replicated to an S3-compatible or Google Cloud Storage bucket.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FlueDoBinding, mergeDurableObjectBindings } from './cloudflare-worker-config.ts';
import { stackless } from './diagnostics.ts';

/**
 * The wrangler config keys celld accepts
 * (https://celld.dev/docs/cloudflare-compat#wrangler-configuration). celld
 * stops a deploy on any other key, so the build fails here first with the
 * full offending list.
 */
const CELLD_WRANGLER_KEYS = new Set([
	'$schema',
	'name',
	'main',
	'compatibility_date',
	'compatibility_flags',
	'durable_objects',
	'migrations',
	'assets',
	'services',
	'vars',
]);

/** Default compatibility_date for celld deploy configs — matches Flue's floor. */
const CELLD_COMPATIBILITY_DATE = '2026-04-01';

export interface BuildCelldDeployConfigOptions {
	/** The project root (where the authored wrangler file lives). */
	root: string;
	/** Flue's generated per-agent Durable Object bindings. */
	doBindings: readonly FlueDoBinding[];
}

/**
 * Produce the celld deploy config: the user's authored wrangler config (when
 * present) restricted to celld's key subset, with Flue's generated Durable
 * Object bindings merged in and `main` pointing at the bundled Worker.
 */
export function buildCelldDeployConfig(
	options: BuildCelldDeployConfigOptions,
): Record<string, unknown> {
	const user = readAuthoredWranglerConfig(options.root);
	if (user.path) validateCelldKeys(user.config, user.path);

	// Shallow clone so the user's parsed config is never mutated in place.
	const merged: Record<string, unknown> = { ...user.config };
	// $schema points editors at wrangler's config schema; it is not part of
	// celld's accepted key subset, so drop it from the deploy config.
	delete merged.$schema;

	// main: Flue always wins. The config sits next to the bundled Worker in
	// the output directory, so the path is relative to the deploy directory.
	merged.main = './worker.mjs';

	// name: user wins if set; fall back to the project directory name.
	if (typeof merged.name !== 'string' || merged.name.length === 0) {
		merged.name = path.basename(options.root) || 'flue-agents';
	}

	// compatibility_date: user wins if set. celld honors the date for the
	// switches it models and accepts flags it doesn't model without effect,
	// so the user's compatibility_flags pass through untouched and no
	// nodejs_compat union is needed (celld provides node: imports always).
	if (typeof merged.compatibility_date !== 'string') {
		merged.compatibility_date = CELLD_COMPATIBILITY_DATE;
	}

	mergeDurableObjectBindings(merged, options.doBindings);

	// celld reads `assets.directory` relative to the deploy directory, so a
	// root-relative user value must be absolutized to survive the move.
	if (typeof merged.assets === 'object' && merged.assets !== null) {
		const assets = { ...(merged.assets as Record<string, unknown>) };
		if (typeof assets.directory === 'string' && !path.isAbsolute(assets.directory)) {
			assets.directory = path.resolve(options.root, assets.directory).replace(/\\/g, '/');
		}
		merged.assets = assets;
	}

	return merged;
}

/**
 * Read the user's authored wrangler config at the project root. celld accepts
 * wrangler.jsonc and wrangler.json (not wrangler.toml); both are parsed here
 * without a wrangler dependency, which a celld project does not have.
 */
function readAuthoredWranglerConfig(root: string): {
	config: Record<string, unknown>;
	path: string | undefined;
} {
	const jsoncPath = path.join(root, 'wrangler.jsonc');
	const jsonPath = path.join(root, 'wrangler.json');
	const tomlPath = path.join(root, 'wrangler.toml');
	if (!fs.existsSync(jsoncPath) && !fs.existsSync(jsonPath) && fs.existsSync(tomlPath)) {
		throw stackless(
			new Error(
				`[flue] celld accepts wrangler.jsonc or wrangler.json, not wrangler.toml. ` +
					`Convert wrangler.toml to wrangler.jsonc to deploy to a celld fleet.`,
			),
		);
	}
	const configPath = fs.existsSync(jsoncPath)
		? jsoncPath
		: fs.existsSync(jsonPath)
			? jsonPath
			: undefined;
	if (!configPath) return { config: {}, path: undefined };
	const source = fs.readFileSync(configPath, 'utf-8');
	const parsed = configPath.endsWith('.jsonc')
		? parseJsonc(source, configPath)
		: parseJson(source, configPath);
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw stackless(new Error(`[flue] ${configPath} must contain a JSON object.`));
	}
	return { config: parsed as Record<string, unknown>, path: configPath };
}

/**
 * Fail the build when the user's wrangler config uses keys celld does not
 * support. This includes `env` blocks — celld has no wrangler environments.
 */
function validateCelldKeys(config: Record<string, unknown>, configPath: string): void {
	const unsupported = Object.keys(config).filter((key) => !CELLD_WRANGLER_KEYS.has(key));
	if (unsupported.length === 0) return;
	throw stackless(
		new Error(
			`[flue] ${path.basename(configPath)} uses keys celld does not support: ${unsupported.join(', ')}. ` +
				`celld accepts only: name, main, compatibility_date, compatibility_flags, ` +
				`durable_objects, migrations, assets, services, vars ` +
				`(https://celld.dev/docs/cloudflare-compat#wrangler-configuration). ` +
				`Remove the listed keys, or deploy this project with the cloudflare target instead.`,
		),
	);
}

function parseJson(source: string, file: string): unknown {
	try {
		return JSON.parse(source);
	} catch (error) {
		throw stackless(
			new Error(
				`[flue] Failed to parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}
}

/**
 * Parse a JSONC document (comments and trailing commas allowed). A JSONC
 * grammar package isn't pulled in for one config file — this handles the two
 * relaxations wrangler.jsonc files actually use, both string-safely.
 */
function parseJsonc(source: string, file: string): unknown {
	// Pass 1: drop comments, string-aware.
	let stripped = '';
	let inString = false;
	for (let i = 0; i < source.length; i++) {
		const ch = source.charAt(i);
		if (inString) {
			stripped += ch;
			if (ch === '\\') {
				stripped += source.charAt(++i);
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			stripped += ch;
			continue;
		}
		if (ch === '/' && source.charAt(i + 1) === '/') {
			while (i < source.length && source.charAt(i) !== '\n') i++;
			stripped += '\n';
			continue;
		}
		if (ch === '/' && source.charAt(i + 1) === '*') {
			i += 2;
			while (i < source.length && !(source.charAt(i) === '*' && source.charAt(i + 1) === '/')) i++;
			i++; // consume the closing '/'
			continue;
		}
		stripped += ch;
	}
	// Pass 2: drop trailing commas — a ',' whose next non-whitespace character
	// (outside strings) closes an object or array.
	let result = '';
	inString = false;
	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped.charAt(i);
		if (inString) {
			result += ch;
			if (ch === '\\') {
				result += stripped.charAt(++i);
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			result += ch;
			continue;
		}
		if (ch === ',') {
			let lookahead = i + 1;
			while (lookahead < stripped.length && /\s/.test(stripped.charAt(lookahead))) lookahead++;
			const next = stripped.charAt(lookahead);
			if (next === '}' || next === ']') continue;
		}
		result += ch;
	}
	return parseJson(result, file);
}
