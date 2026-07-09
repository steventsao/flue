import type { AssistantMessage } from '@earendil-works/pi-ai/compat';
import { afterEach, describe, expect, it } from 'vitest';
import { runLocalCodex } from '../src/local.ts';
import type { LoginExecutorJob } from '../src/protocol.ts';

afterEach(async () => {
	const runtime = await import('@flue/runtime/internal');
	runtime.resetProviderRuntime();
});

describe('runLocalCodex()', () => {
	it('routes native Pi context through the broker and a locally fulfilled worker lease', async () => {
		let claimedJob: LoginExecutorJob | undefined;
		const events: string[] = [];

		const message = await runLocalCodex({
			prompt: 'Prove the local path.',
			model: 'gpt-test',
			execute: async (job) => {
				claimedJob = job;
				return assistant('local proof');
			},
			onEvent: (event) => events.push(event.type),
		});

		expect(message).toMatchObject({
			provider: 'openai-codex',
			api: 'openai-codex-responses',
			content: [{ type: 'text', text: 'local proof' }],
		});
		expect(claimedJob?.context.messages).toMatchObject([
			{ role: 'user', content: 'Prove the local path.' },
		]);
		expect(events).toEqual(['claimed', 'completed']);
	});
});

function assistant(text: string): AssistantMessage {
	return {
		role: 'assistant',
		content: [{ type: 'text', text }],
		api: 'openai-codex-responses',
		provider: 'openai-codex',
		model: 'gpt-test',
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}
