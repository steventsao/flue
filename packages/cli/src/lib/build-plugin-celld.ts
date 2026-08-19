/**
 * celld build plugin. Produces a self-contained Wrangler project that
 * `celld deploy` bundles and deploys to a self-hosted celld fleet.
 *
 * celld (https://celld.dev) runs Cloudflare Workers and Durable Objects on
 * infrastructure you own, so this target reuses the Cloudflare Durable Object
 * entry generation unchanged; only the packaging differs. There is no Vite
 * build and no Cloudflare control plane: the output directory is the
 * deployable unit, and celld's own esbuild step bundles the generated entry.
 */
import * as path from 'node:path';
import {
	flueDurableObjectBindings,
	generateDurableObjectsEntryPoint,
} from './build-plugin-cloudflare.ts';
import { mergeFlueAdditions, readUserWranglerConfig } from './cloudflare-wrangler-merge.ts';
import { note } from './terminal.ts';
import type { BuildContext, BuildPlugin, ViteCloudflareInputs } from './types.ts';

/**
 * The wrangler config keys celld accepts
 * (https://celld.dev/docs/cloudflare-compat#wrangler-configuration). celld
 * stops a deploy on any other key, so the build fails early here with the
 * full offending list instead.
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

export class CelldPlugin implements BuildPlugin {
	name = 'celld';
	bundle: BuildPlugin['bundle'] = 'celld';
	entryFilename = '_entry.ts';

	async generateEntryPoint(ctx: BuildContext): Promise<string> {
		return generateDurableObjectsEntryPoint(ctx, 'celld');
	}

	async viteInputs(ctx: BuildContext): Promise<ViteCloudflareInputs> {
		// Read the user's wrangler config (if any). As on the Cloudflare target,
		// the user's file is never modified; the merged result is what celld
		// consumes from the output directory.
		const { config: userConfig, path: userConfigPath } = await readUserWranglerConfig(ctx.root);
		if (userConfigPath && ctx.log !== 'silent') {
			note(`wrangler ${userConfigPath}`);
		}
		if (userConfigPath?.endsWith('.toml')) {
			throw new Error(
				`[flue] celld accepts wrangler.jsonc or wrangler.json, not wrangler.toml. ` +
					`Convert ${path.basename(userConfigPath)} to wrangler.jsonc to deploy to a celld fleet.`,
			);
		}
		validateCelldWranglerKeys(userConfig);

		const merged = mergeFlueAdditions(userConfig, {
			defaultName: path.basename(ctx.root) || 'flue-agents',
			// The merged config lives next to the generated entry in the output
			// directory, so main is relative to the deploy directory, not root.
			main: './_entry.ts',
			doBindings: flueDurableObjectBindings(ctx),
		});

		// $schema points editors at wrangler's config schema; it is not part of
		// celld's accepted key subset, so drop it from the deploy config.
		delete merged.$schema;

		// celld reads `assets.directory` relative to the deploy directory, so a
		// root-relative user value must be absolutized to survive the move.
		if (typeof merged.assets === 'object' && merged.assets !== null) {
			const assets = { ...(merged.assets as Record<string, unknown>) };
			if (typeof assets.directory === 'string' && !path.isAbsolute(assets.directory)) {
				assets.directory = path.resolve(ctx.root, assets.directory).replace(/\\/g, '/');
			}
			merged.assets = assets;
		}

		return { wranglerConfig: JSON.stringify(merged, null, 2) };
	}
}

/**
 * Fail the build when the user's wrangler config uses keys celld does not
 * support. This includes `env` blocks — celld has no wrangler environments.
 */
function validateCelldWranglerKeys(userConfig: Record<string, unknown>): void {
	const unsupported = Object.keys(userConfig).filter((key) => !CELLD_WRANGLER_KEYS.has(key));
	if (unsupported.length === 0) return;
	throw new Error(
		`[flue] Your wrangler config uses keys celld does not support: ${unsupported.join(', ')}. ` +
			`celld accepts only: name, main, compatibility_date, compatibility_flags, ` +
			`durable_objects, migrations, assets, services, vars ` +
			`(https://celld.dev/docs/cloudflare-compat#wrangler-configuration). ` +
			`Remove the listed keys, or deploy this project with the cloudflare target instead.`,
	);
}
