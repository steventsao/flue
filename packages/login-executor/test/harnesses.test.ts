import { describe, expect, it, vi } from 'vitest';
import { createClaudeHarness, parseClaudeOutput } from '../src/claude.ts';
import { createCodexHarness, parseCodexOutput } from '../src/codex.ts';
import type { CommandRunner } from '../src/command.ts';
import type { LoginExecutorJob } from '../src/protocol.ts';

const job: LoginExecutorJob = {
	jobId: 'job-1',
	fence: 1,
	workerId: 'worker-1',
	harness: 'codex',
	model: 'gpt-test',
	prompt: 'Answer the turn.',
	outputSchema: { type: 'object' },
	createdAt: new Date(0).toISOString(),
	leaseExpiresAt: new Date(30_000).toISOString(),
};

describe('createCodexHarness()', () => {
	it('uses an ephemeral read-only invocation when fulfilling a job', async () => {
		const run = vi.fn<CommandRunner>(async () => ({
			stdout: `${JSON.stringify({
				type: 'item.completed',
				item: {
					type: 'agent_message',
					text: JSON.stringify({ content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }),
				},
			})}\n`,
			stderr: '',
			exitCode: 0,
		}));
		const execute = createCodexHarness({ command: 'codex-test', run });

		await expect(execute(job)).resolves.toEqual({
			content: [{ type: 'text', text: 'done' }],
			stopReason: 'stop',
		});
		expect(run).toHaveBeenCalledOnce();
		expect(run.mock.calls[0]?.[0]).toMatchObject({
			command: 'codex-test',
			stdin: 'Answer the turn.',
			cwd: expect.stringContaining('flue-codex-'),
		});
		expect(run.mock.calls[0]?.[0].args).toEqual(
			expect.arrayContaining([
				'--ephemeral',
				'--ignore-user-config',
				'approval_policy="never"',
				'--sandbox',
				'read-only',
			]),
		);
	});
});

describe('parseCodexOutput()', () => {
	it('uses the last agent message when Codex emits multiple events', () => {
		const output = [
			JSON.stringify({
				type: 'item.completed',
				item: { type: 'agent_message', text: '{"content":[],"stopReason":"stop"}' },
			}),
			JSON.stringify({
				type: 'item.completed',
				item: {
					type: 'agent_message',
					text: '{"content":[{"type":"text","text":"final"}],"stopReason":"stop"}',
				},
			}),
		].join('\n');

		expect(parseCodexOutput(output)).toEqual({
			content: [{ type: 'text', text: 'final' }],
			stopReason: 'stop',
		});
	});

	it('decodes tool arguments and normalizes the stop reason when a tool call is returned', () => {
		const output = JSON.stringify({
			type: 'item.completed',
			item: {
				type: 'agent_message',
				text: JSON.stringify({
					content: [{ type: 'toolCall', name: 'search', arguments: '{"query":"flue"}' }],
					stopReason: 'stop',
				}),
			},
		});

		expect(parseCodexOutput(output)).toEqual({
			content: [{ type: 'toolCall', name: 'search', arguments: { query: 'flue' } }],
			stopReason: 'toolUse',
		});
	});
});

describe('createClaudeHarness()', () => {
	it('disables Claude tools and session persistence when fulfilling a job', async () => {
		const run = vi.fn<CommandRunner>(async () => ({
			stdout: JSON.stringify({
				result: JSON.stringify({ text: 'done', toolCalls: [], stopReason: 'stop' }),
			}),
			stderr: '',
			exitCode: 0,
		}));
		const execute = createClaudeHarness({ command: 'claude-test', run });

		await expect(execute({ ...job, harness: 'claude', model: 'sonnet' })).resolves.toEqual({
			content: [{ type: 'text', text: 'done' }],
			stopReason: 'stop',
		});
		expect(run.mock.calls[0]?.[0].args).toEqual(
			expect.arrayContaining([
				'--no-session-persistence',
				'--disable-slash-commands',
				'--tools',
				'',
				'--permission-mode',
				'dontAsk',
			]),
		);
		expect(run.mock.calls[0]?.[0].cwd).toEqual(expect.stringContaining('flue-claude-'));
		expect(run.mock.calls[0]?.[0].args).not.toContain('--json-schema');
		expect(run.mock.calls[0]?.[0].stdin).toContain(JSON.stringify(job.outputSchema));
	});
});

describe('parseClaudeOutput()', () => {
	it('accepts a JSON-encoded result when structured output is absent', () => {
		const output = JSON.stringify({
			result: JSON.stringify({ content: [{ type: 'text', text: 'fallback' }], stopReason: 'stop' }),
		});

		expect(parseClaudeOutput(output)).toEqual({
			content: [{ type: 'text', text: 'fallback' }],
			stopReason: 'stop',
		});
	});
});
