#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runLocalCodex } from './local.ts';

const { values, positionals } = parseArgs({
	options: {
		model: { type: 'string', short: 'm', default: 'gpt-5.4' },
		system: { type: 'string', short: 's' },
		json: { type: 'boolean' },
		help: { type: 'boolean', short: 'h' },
	},
	allowPositionals: true,
	strict: true,
});

if (values.help) {
	console.log(`Usage: flue-login-local [options] [prompt]

Run one model turn through the local login-executor broker and the existing
Codex CLI login. Reads the prompt from stdin when no positional prompt is given.

Options:
  -m, --model <model>    Codex model (default: gpt-5.4)
  -s, --system <text>    Optional system prompt
      --json             Print the complete assistant message as JSON
  -h, --help             Show this help`);
	process.exit(0);
}

const prompt = positionals.length > 0 ? positionals.join(' ') : await readStdin();
if (prompt.trim().length === 0) {
	console.error('A prompt argument or piped stdin is required.');
	process.exit(1);
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

const message = await runLocalCodex({
	prompt,
	model: values.model,
	systemPrompt: values.system,
	signal: controller.signal,
	onEvent(event) {
		if (event.type === 'claimed') console.error(`claimed ${event.jobId}`);
		if (event.type === 'completed') console.error(`completed ${event.jobId}`);
		if (event.type === 'failed') console.error(`failed ${event.jobId}: ${String(event.error)}`);
	},
});

if (values.json) {
	console.log(JSON.stringify(message, null, 2));
} else {
	const text = message.content
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('');
	if (text) console.log(text);
	else console.log(JSON.stringify(message.content, null, 2));
}

if (message.stopReason === 'error' || message.stopReason === 'aborted') process.exitCode = 1;

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return '';
	process.stdin.setEncoding('utf8');
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	return input;
}
