import { completeSimple } from '@earendil-works/pi-ai/compat';
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
	it('serializes model turns when one worker lease is active', async () => {
		const broker = createLoginExecutorBroker({
			token: 'secret',
			providers: [{ providerId: 'codex-login', harness: 'codex' }],
			leaseMs: 30_000,
		});
		const model = resolveModel('codex-login/gpt-test');
		const firstResult = completeSimple(model, {
			systemPrompt: 'Be concise.',
			messages: [{ role: 'user', content: 'first', timestamp: Date.now() }],
		});
		const secondResult = completeSimple(model, {
			systemPrompt: 'Be concise.',
			messages: [{ role: 'user', content: 'second', timestamp: Date.now() }],
		});

		const firstClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-1', harness: 'codex', waitMs: 0 }),
		});
		const firstJob = (await firstClaim.json()) as LoginExecutorJob;
		const blockedClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-1', harness: 'codex', waitMs: 0 }),
		});

		expect(firstClaim.status).toBe(200);
		expect(blockedClaim.status).toBe(204);
		expect(broker.pending()).toBe(2);

		const stale = await broker.routes.request(`/jobs/${firstJob.jobId}/complete`, {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({
				workerId: 'worker-1',
				fence: firstJob.fence + 1,
				result: { content: [{ type: 'text', text: 'wrong' }], stopReason: 'stop' },
			}),
		});
		expect(stale.status).toBe(409);

		const completed = await broker.routes.request(`/jobs/${firstJob.jobId}/complete`, {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({
				workerId: 'worker-1',
				fence: firstJob.fence,
				result: { content: [{ type: 'text', text: 'first answer' }], stopReason: 'stop' },
			}),
		});
		expect(completed.status).toBe(200);
		await expect(firstResult).resolves.toMatchObject({
			content: [{ type: 'text', text: 'first answer' }],
			provider: 'codex-login',
		});

		const secondClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-1', harness: 'codex', waitMs: 0 }),
		});
		const secondJob = (await secondClaim.json()) as LoginExecutorJob;
		expect(secondClaim.status).toBe(200);
		expect(secondJob.fence).toBeGreaterThan(firstJob.fence);

		await broker.routes.request(`/jobs/${secondJob.jobId}/complete`, {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({
				workerId: 'worker-1',
				fence: secondJob.fence,
				result: { content: [{ type: 'text', text: 'second answer' }], stopReason: 'stop' },
			}),
		});
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
			body: JSON.stringify({ workerId: 'worker-1', harness: 'codex', waitMs: 0 }),
		});

		expect(response.status).toBe(401);
	});

	it('requeues a turn with a new fence when its worker lease expires', async () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const broker = createLoginExecutorBroker({
			token: 'secret',
			providers: [{ providerId: 'codex-login', harness: 'codex' }],
			leaseMs: 10,
		});
		const result = completeSimple(resolveModel('codex-login/gpt-test'), {
			messages: [{ role: 'user', content: 'recover me', timestamp: now }],
		});
		const firstClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-1', harness: 'codex', waitMs: 0 }),
		});
		const firstJob = (await firstClaim.json()) as LoginExecutorJob;

		now += 11;
		const replacementClaim = await broker.routes.request('/claim', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({ workerId: 'worker-2', harness: 'codex', waitMs: 0 }),
		});
		const replacementJob = (await replacementClaim.json()) as LoginExecutorJob;

		expect(replacementJob.jobId).toBe(firstJob.jobId);
		expect(replacementJob.fence).toBeGreaterThan(firstJob.fence);
		const stale = await broker.routes.request(`/jobs/${firstJob.jobId}/complete`, {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({
				workerId: 'worker-1',
				fence: firstJob.fence,
				result: { content: [{ type: 'text', text: 'stale' }], stopReason: 'stop' },
			}),
		});
		expect(stale.status).toBe(409);

		await broker.routes.request(`/jobs/${replacementJob.jobId}/complete`, {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
			body: JSON.stringify({
				workerId: 'worker-2',
				fence: replacementJob.fence,
				result: { content: [{ type: 'text', text: 'recovered' }], stopReason: 'stop' },
			}),
		});
		await expect(result).resolves.toMatchObject({
			content: [{ type: 'text', text: 'recovered' }],
		});
	});
});
