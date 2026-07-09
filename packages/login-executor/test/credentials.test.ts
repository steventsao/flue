import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonCredentialStore } from '../src/credentials.ts';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe('JsonCredentialStore', () => {
	it('persists a refreshed OAuth credential without replacing other providers', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'flue-pi-auth-'));
		directories.push(directory);
		const file = path.join(directory, 'auth.json');
		await writeFile(
			file,
			JSON.stringify({
				'openai-codex': {
					type: 'oauth',
					access: 'old-access',
					refresh: 'refresh-token',
					expires: 1,
				},
				anthropic: { type: 'api_key', key: 'keep-me' },
			}),
			{ mode: 0o600 },
		);
		const store = new JsonCredentialStore(file);

		await store.modify('openai-codex', async (current) => ({
			...current,
			type: 'oauth',
			access: 'new-access',
			refresh: 'refresh-token',
			expires: 2,
		}));

		const persisted = JSON.parse(await readFile(file, 'utf8'));
		expect(persisted).toEqual({
			'openai-codex': {
				type: 'oauth',
				access: 'new-access',
				refresh: 'refresh-token',
				expires: 2,
			},
			anthropic: { type: 'api_key', key: 'keep-me' },
		});
	});
});
