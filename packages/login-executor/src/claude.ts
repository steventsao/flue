import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type CommandRunner, runCommand } from './command.ts';
import type { LoginExecutorJob, LoginExecutorResult } from './protocol.ts';
import { parseLoginExecutorResult } from './protocol.ts';

export function createClaudeHarness(
	options: {
		command?: string;
		run?: CommandRunner;
	} = {},
): (job: LoginExecutorJob, signal?: AbortSignal) => Promise<LoginExecutorResult> {
	const command = options.command ?? 'claude';
	const run = options.run ?? runCommand;
	return async (job, signal) => {
		const directory = await mkdtemp(path.join(tmpdir(), 'flue-claude-'));
		try {
			const result = await run({
				command,
				cwd: directory,
				args: [
					'--print',
					'--output-format',
					'json',
					'--no-session-persistence',
					'--disable-slash-commands',
					'--tools',
					'',
					'--permission-mode',
					'dontAsk',
					'--system-prompt',
					'You are a stateless model-turn executor. Return only the requested JSON and perform no side effects.',
					'--model',
					job.model,
				],
				stdin: [
					job.prompt,
					'',
					'Return only JSON matching this schema. Do not use Markdown fences:',
					JSON.stringify(job.outputSchema),
				].join('\n'),
				signal,
			});
			if (result.exitCode !== 0) {
				throw new Error(`Claude exited with ${result.exitCode}: ${result.stderr.trim()}`);
			}
			return parseClaudeOutput(result.stdout);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	};
}

export function parseClaudeOutput(stdout: string): LoginExecutorResult {
	const envelope = JSON.parse(stdout) as Record<string, unknown>;
	if (envelope.structured_output !== undefined) {
		return parseLoginExecutorResult(envelope.structured_output);
	}
	if (typeof envelope.result === 'string') {
		return parseLoginExecutorResult(parseJsonText(envelope.result));
	}
	throw new Error('Claude did not return structured_output or a JSON result.');
}

function parseJsonText(value: string): unknown {
	const trimmed = value.trim();
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
	return JSON.parse(fenced?.[1] ?? trimmed);
}
