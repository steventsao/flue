import { afterEach, describe, expect, it } from 'vitest';
import { runLocalCodex } from '../src/local.ts';
import type { LoginExecutorJob } from '../src/protocol.ts';

afterEach(async () => {
	const runtime = await import('@flue/runtime/internal');
	runtime.resetProviderRuntime();
});

describe('runLocalCodex()', () => {
	it('routes one prompt through the broker and a locally fulfilled worker lease', async () => {
		let claimedJob: LoginExecutorJob | undefined;
		const events: string[] = [];

		const message = await runLocalCodex({
			prompt: 'Prove the local path.',
			model: 'gpt-test',
			execute: async (job) => {
				claimedJob = job;
				return { content: [{ type: 'text', text: 'local proof' }], stopReason: 'stop' };
			},
			onEvent: (event) => events.push(event.type),
		});

		expect(message).toMatchObject({
			provider: 'codex-login',
			model: 'gpt-test',
			content: [{ type: 'text', text: 'local proof' }],
		});
		expect(claimedJob?.prompt).toContain('Prove the local path.');
		expect(events).toEqual(['claimed', 'completed']);
	});
});
