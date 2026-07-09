import { type AssistantMessage, completeSimple } from '@earendil-works/pi-ai/compat';
import { resolveModel } from '@flue/runtime/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoginExecutorBroker } from '../src/broker.ts';
import type { LoginExecutorJob } from '../src/protocol.ts';

afterEach(async () => {
	vi.restoreAllMocks();
	const runtime = await import('@flue/runtime/internal');
	runtime.resetProviderRuntime();
});

describe('createLoginExecutorBroker()', () => {
	it('serializes native Pi turns when one worker lease is active', async () => {
		const broker = createLoginExecutorBroker({ token: 'secret', leaseMs: 30_000 });
		const model = resolveModel('codex-login/gpt-test');
		const firstResult = completeSimple(model, {
			systemPrompt: 'Be concise.',
			messages: [{ role: 'user', content: 'first', timestamp: Date.now() }],
		});
		const secondResult = completeSimple(model, {
			systemPrompt: 'Be concise.',
			messages: [{ role: 'user', content: 'second', timestamp: Date.now() }],
		});

		const firstClaim = await claim(broker, 'worker-1');
		const blockedClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ workerId: 'worker-1', waitMs: 0 }),
		});

		expect(firstClaim.response.status).toBe(200);
		expect(firstClaim.job.context.messages).toMatchObject([{ role: 'user', content: 'first' }]);
		expect(blockedClaim.status).toBe(204);
		expect(broker.pending()).toBe(2);

		const stale = await complete(broker, firstClaim.job, 'worker-1', assistant('wrong'), 1);
		expect(stale.status).toBe(409);

		const completed = await complete(broker, firstClaim.job, 'worker-1', assistant('first answer'));
		expect(completed.status).toBe(200);
		await expect(firstResult).resolves.toMatchObject({
			content: [{ type: 'text', text: 'first answer' }],
			provider: 'openai-codex',
			usage: { input: 12, output: 3 },
		});

		const secondClaim = await claim(broker, 'worker-1');
		expect(secondClaim.job.fence).toBeGreaterThan(firstClaim.job.fence);
		await complete(broker, secondClaim.job, 'worker-1', assistant('second answer'));
		await expect(secondResult).resolves.toMatchObject({
			content: [{ type: 'text', text: 'second answer' }],
		});
		expect(broker.pending()).toBe(0);
	});

	it('rejects claims when the worker token is missing', async () => {
		const broker = createLoginExecutorBroker({ token: 'secret' });

		const response = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-1', waitMs: 0 }),
		});

		expect(response.status).toBe(401);
	});

	it('requeues a native turn with a new fence when its worker lease expires', async () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const broker = createLoginExecutorBroker({ token: 'secret', leaseMs: 10 });
		const result = completeSimple(resolveModel('codex-login/gpt-test'), {
			messages: [{ role: 'user', content: 'recover me', timestamp: now }],
		});
		const firstClaim = await claim(broker, 'worker-1');

		now += 11;
		const replacement = await claim(broker, 'worker-2');
		expect(replacement.job.jobId).toBe(firstClaim.job.jobId);
		expect(replacement.job.fence).toBeGreaterThan(firstClaim.job.fence);
		expect((await complete(broker, firstClaim.job, 'worker-1', assistant('stale'))).status).toBe(
			409,
		);

		await complete(broker, replacement.job, 'worker-2', assistant('recovered'));
		await expect(result).resolves.toMatchObject({
			content: [{ type: 'text', text: 'recovered' }],
		});
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
			input: 12,
			output: 3,
			cacheRead: 2,
			cacheWrite: 0,
			totalTokens: 17,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}

function headers(): Record<string, string> {
	return { authorization: 'Bearer secret', 'content-type': 'application/json' };
}

async function claim(broker: ReturnType<typeof createLoginExecutorBroker>, workerId: string) {
	const response = await broker.routes.request('/claim', {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({ workerId, waitMs: 0 }),
	});
	return { response, job: (await response.json()) as LoginExecutorJob };
}

function complete(
	broker: ReturnType<typeof createLoginExecutorBroker>,
	job: LoginExecutorJob,
	workerId: string,
	result: AssistantMessage,
	fenceOffset = 0,
) {
	return broker.routes.request(`/jobs/${job.jobId}/complete`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({ workerId, fence: job.fence + fenceOffset, result }),
	});
}
