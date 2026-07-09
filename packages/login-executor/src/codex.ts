import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type CommandRunner, runCommand } from './command.ts';
import type { LoginExecutorJob, LoginExecutorResult } from './protocol.ts';
import { parseLoginExecutorResult } from './protocol.ts';

export function createCodexHarness(
	options: {
		command?: string;
		run?: CommandRunner;
	} = {},
): (job: LoginExecutorJob, signal?: AbortSignal) => Promise<LoginExecutorResult> {
	const command = options.command ?? 'codex';
	const run = options.run ?? runCommand;
	return async (job, signal) => {
		const directory = await mkdtemp(path.join(tmpdir(), 'flue-codex-'));
		const schemaPath = path.join(directory, 'output-schema.json');
		try {
			await writeFile(schemaPath, JSON.stringify(job.outputSchema), { mode: 0o600 });
			const result = await run({
				command,
				cwd: directory,
				args: [
					'exec',
					'--json',
					'--ephemeral',
					'--ignore-user-config',
					'--ignore-rules',
					'-c',
					'approval_policy="never"',
					'--sandbox',
					'read-only',
					'--skip-git-repo-check',
					'--output-schema',
					schemaPath,
					'--model',
					job.model,
					'-',
				],
				stdin: job.prompt,
				signal,
			});
			if (result.exitCode !== 0) {
				throw new Error(`Codex exited with ${result.exitCode}: ${result.stderr.trim()}`);
			}
			return parseCodexOutput(result.stdout);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	};
}

export function parseCodexOutput(stdout: string): LoginExecutorResult {
	let finalText: string | undefined;
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!event || typeof event !== 'object') continue;
		const record = event as Record<string, unknown>;
		const item = record.item;
		if (
			record.type === 'item.completed' &&
			item &&
			typeof item === 'object' &&
			(item as Record<string, unknown>).type === 'agent_message' &&
			typeof (item as Record<string, unknown>).text === 'string'
		) {
			finalText = (item as Record<string, unknown>).text as string;
		}
	}
	if (!finalText) throw new Error('Codex did not emit a final agent_message event.');
	return parseLoginExecutorResult(JSON.parse(finalText));
}
