#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createPiCodexExecutor } from './pi-codex.ts';
import { runLoginWorker } from './worker.ts';

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		token: { type: 'string' },
		'auth-file': { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
	strict: true,
});

if (values.help) {
	console.log(`Usage: flue-login-worker --url <broker-url> [--token <token>] [--auth-file <path>]

The token defaults to FLUE_LOGIN_EXECUTOR_TOKEN. The auth file defaults to
FLUE_PI_AUTH_FILE, ~/.pi/agent/auth.json when present, then ./auth.json.

Create the OAuth credential with:
  npx @earendil-works/pi-ai login openai-codex`);
	process.exit(0);
}

const url = values.url;
const token = values.token ?? process.env.FLUE_LOGIN_EXECUTOR_TOKEN;
if (!url || !token) {
	console.error('Missing --url or token. Run with --help for usage.');
	process.exit(1);
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

await runLoginWorker({
	url,
	token,
	execute: createPiCodexExecutor({ authFile: values['auth-file'] }),
	signal: controller.signal,
	onEvent(event) {
		if (event.type === 'claimed') console.error(`claimed ${event.jobId}`);
		if (event.type === 'completed') console.error(`completed ${event.jobId}`);
		if (event.type === 'failed') console.error(`failed ${event.jobId}: ${String(event.error)}`);
	},
});
