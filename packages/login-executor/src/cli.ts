#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createClaudeHarness } from './claude.ts';
import { createCodexHarness } from './codex.ts';
import type { LoginHarness } from './protocol.ts';
import { runLoginWorker } from './worker.ts';

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		token: { type: 'string' },
		harness: { type: 'string' },
		model: { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
	strict: true,
});

if (values.help) {
	console.log(`Usage: flue-login-worker --url <broker-url> --harness <codex|claude> [--token <token>]

The token defaults to FLUE_LOGIN_EXECUTOR_TOKEN. The worker uses the selected
CLI's existing local login and processes one model turn at a time.`);
	process.exit(0);
}

const url = values.url;
const token = values.token ?? process.env.FLUE_LOGIN_EXECUTOR_TOKEN;
const harness = values.harness as LoginHarness | undefined;
if (!url || !token || (harness !== 'codex' && harness !== 'claude')) {
	console.error('Missing --url, token, or valid --harness. Run with --help for usage.');
	process.exit(1);
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

const execute = harness === 'codex' ? createCodexHarness() : createClaudeHarness();
await runLoginWorker({
	url,
	token,
	harness,
	execute: async (job, signal) =>
		execute(values.model ? { ...job, model: values.model } : job, signal),
	signal: controller.signal,
	onEvent(event) {
		if (event.type === 'claimed') console.error(`claimed ${event.jobId}`);
		if (event.type === 'completed') console.error(`completed ${event.jobId}`);
		if (event.type === 'failed') console.error(`failed ${event.jobId}: ${String(event.error)}`);
	},
});
