#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runLocalCodexWorkflow } from './local-workflow.ts';

const { values, positionals } = parseArgs({
	options: {
		model: { type: 'string', short: 'm', default: 'gpt-5.4' },
		system: { type: 'string', short: 's' },
		'auth-file': { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
	allowPositionals: true,
	strict: true,
});

if (values.help) {
	console.log(`Usage: flue-login-workflow-proof [options] [prompt]

Run a complete Flue workflow with exactly one OpenAI Codex OAuth agent step.
Reads stdin when no positional prompt is given.

Options:
  -m, --model <model>    Codex model (default: gpt-5.4)
  -s, --system <text>    Optional agent instructions
      --auth-file <path> Pi auth.json credential file
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

const result = await runLocalCodexWorkflow({
	prompt,
	model: values.model,
	systemPrompt: values.system,
	authFile: values['auth-file'],
	signal: controller.signal,
	onStep: (step) => console.error(`step ${step}`),
	onWorkerEvent(event) {
		if (event.type === 'claimed') console.error(`claimed ${event.jobId}`);
		if (event.type === 'completed') console.error(`completed ${event.jobId}`);
		if (event.type === 'failed') console.error(`failed ${event.jobId}: ${String(event.error)}`);
	},
});

console.log(JSON.stringify(result, null, 2));
// Pi's OAuth transport may retain an idle HTTP keep-alive socket after the
// one-shot proof has completed. The result is fully materialized above, so the
// CLI must not wait for transport-global connection cleanup before exiting.
process.exit(result.status === 'completed' ? 0 : 1);

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return '';
	process.stdin.setEncoding('utf8');
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	return input;
}
