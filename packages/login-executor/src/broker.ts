import { registerApiProvider, registerProvider } from '@flue/runtime';
import { Hono } from 'hono';
import {
	LOGIN_EXECUTOR_OUTPUT_SCHEMA,
	type LoginExecutorClaimRequest,
	type LoginExecutorCompleteRequest,
	type LoginExecutorFailRequest,
	type LoginExecutorJob,
	type LoginExecutorLeaseRequest,
	type LoginExecutorResult,
	type LoginHarness,
	parseLoginExecutorResult,
} from './protocol.ts';
import {
	createLoginApiProvider,
	LOGIN_EXECUTOR_API,
	type LoginTurnQueue,
	type LoginTurnRequest,
} from './provider.ts';
import { installGlobalAgentSerialization } from './serial.ts';

export interface LoginProviderConfig {
	providerId: string;
	harness: LoginHarness;
	contextWindow?: number;
	maxTokens?: number;
}

export interface LoginExecutorBroker {
	/** Mount under an application-owned path, for example `/_flue/login-executor`. */
	routes: Hono;
	/** Number of model turns waiting for a compatible logged-in worker. */
	pending(): number;
}

interface PendingTurn {
	jobId: string;
	harness: LoginHarness;
	model: string;
	prompt: string;
	toolNames: string[];
	createdAt: number;
	status: 'queued' | 'leased';
	fence: number;
	workerId?: string;
	leaseExpiresAt?: number;
	resolve(value: { jobId: string; result: LoginExecutorResult }): void;
	reject(error: unknown): void;
	detachAbort?: () => void;
}

/**
 * Create an authenticated, globally single-threaded model-turn broker.
 *
 * The broker holds no provider OAuth credentials. A local worker claims one
 * turn at a time and fulfills it through its existing Codex or Claude login.
 */
export function createLoginExecutorBroker(options: {
	token: string;
	providers?: LoginProviderConfig[];
	leaseMs?: number;
	/** Hold one process-wide slot across each agent operation, including its Flue tool calls. */
	serializeAgentOperations?: boolean;
}): LoginExecutorBroker {
	if (options.token.trim().length === 0)
		throw new TypeError('Login executor token must not be empty.');
	const leaseMs = options.leaseMs ?? 30_000;
	if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
		throw new TypeError('Login executor leaseMs must be a positive integer.');
	}
	const providers = options.providers ?? [
		{ providerId: 'codex-login', harness: 'codex' as const },
		{ providerId: 'claude-login', harness: 'claude' as const },
	];
	if (options.serializeAgentOperations ?? true) installGlobalAgentSerialization();
	const providerHarnesses = new Map(
		providers.map((provider) => [provider.providerId, provider.harness]),
	);
	const turns: PendingTurn[] = [];
	const waiters = new Set<() => void>();
	let active: PendingTurn | undefined;
	let nextFence = 1;

	const queue: LoginTurnQueue = {
		enqueue(request: LoginTurnRequest) {
			const jobId = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				const turn: PendingTurn = {
					jobId,
					harness: request.harness,
					model: request.model,
					prompt: request.prompt,
					toolNames: request.toolNames,
					createdAt: Date.now(),
					status: 'queued',
					fence: 0,
					resolve,
					reject,
				};
				if (request.signal?.aborted) {
					reject(
						request.signal.reason ?? new DOMException('The model turn was aborted.', 'AbortError'),
					);
					return;
				}
				if (request.signal) {
					const abort = () => cancelTurn(turn, request.signal?.reason);
					request.signal.addEventListener('abort', abort, { once: true });
					turn.detachAbort = () => request.signal?.removeEventListener('abort', abort);
				}
				turns.push(turn);
				notifyWaiters();
			});
		},
	};

	const apiProvider = createLoginApiProvider({ queue, providers: providerHarnesses });
	registerApiProvider(apiProvider as Parameters<typeof registerApiProvider>[0]);
	for (const provider of providers) {
		registerProvider(provider.providerId, {
			api: LOGIN_EXECUTOR_API,
			baseUrl: 'flue://login-executor',
			contextWindow: provider.contextWindow ?? 200_000,
			maxTokens: provider.maxTokens ?? 32_000,
		});
	}

	function notifyWaiters(): void {
		for (const waiter of waiters) waiter();
		waiters.clear();
	}

	function cancelTurn(turn: PendingTurn, reason: unknown): void {
		const index = turns.indexOf(turn);
		if (index === -1) return;
		turns.splice(index, 1);
		if (active === turn) active = undefined;
		turn.detachAbort?.();
		turn.reject(reason ?? new DOMException('The model turn was aborted.', 'AbortError'));
		notifyWaiters();
	}

	function reapExpiredLease(now = Date.now()): void {
		if (!active || (active.leaseExpiresAt ?? 0) > now) return;
		active.status = 'queued';
		active.workerId = undefined;
		active.leaseExpiresAt = undefined;
		active = undefined;
		notifyWaiters();
	}

	function claim(request: LoginExecutorClaimRequest): LoginExecutorJob | undefined {
		reapExpiredLease();
		if (active) return undefined;
		const turn = turns.find(
			(candidate) => candidate.status === 'queued' && candidate.harness === request.harness,
		);
		if (!turn) return undefined;
		turn.status = 'leased';
		turn.fence = nextFence++;
		turn.workerId = request.workerId;
		turn.leaseExpiresAt = Date.now() + leaseMs;
		active = turn;
		return publicJob(turn);
	}

	function publicJob(turn: PendingTurn): LoginExecutorJob {
		return {
			jobId: turn.jobId,
			fence: turn.fence,
			workerId: turn.workerId ?? '',
			harness: turn.harness,
			model: turn.model,
			prompt: turn.prompt,
			outputSchema: LOGIN_EXECUTOR_OUTPUT_SCHEMA,
			createdAt: new Date(turn.createdAt).toISOString(),
			leaseExpiresAt: new Date(turn.leaseExpiresAt ?? 0).toISOString(),
		};
	}

	function ownedTurn(jobId: string, lease: LoginExecutorLeaseRequest): PendingTurn | undefined {
		reapExpiredLease();
		if (
			!active ||
			active.jobId !== jobId ||
			active.workerId !== lease.workerId ||
			active.fence !== lease.fence
		) {
			return undefined;
		}
		return active;
	}

	function settle(turn: PendingTurn): void {
		const index = turns.indexOf(turn);
		if (index !== -1) turns.splice(index, 1);
		turn.detachAbort?.();
		if (active === turn) active = undefined;
		notifyWaiters();
	}

	async function waitForWork(waitMs: number): Promise<void> {
		await new Promise<void>((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				waiters.delete(finish);
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(finish, waitMs);
			waiters.add(finish);
		});
	}

	const routes = new Hono();
	routes.use('*', async (c, next) => {
		if (c.req.header('authorization') !== `Bearer ${options.token}`) {
			return c.json({ error: 'unauthorized' }, 401);
		}
		await next();
	});
	routes.post('/claim', async (c) => {
		const request = (await c.req.json()) as LoginExecutorClaimRequest;
		if (
			typeof request.workerId !== 'string' ||
			request.workerId.length === 0 ||
			(request.harness !== 'codex' && request.harness !== 'claude')
		) {
			return c.json({ error: 'invalid claim' }, 400);
		}
		const waitMs = Math.min(Math.max(request.waitMs ?? 20_000, 0), 25_000);
		let job = claim(request);
		if (!job && waitMs > 0) {
			await waitForWork(waitMs);
			job = claim(request);
		}
		return job ? c.json(job) : c.body(null, 204);
	});
	routes.post('/jobs/:jobId/heartbeat', async (c) => {
		const lease = (await c.req.json()) as LoginExecutorLeaseRequest;
		const turn = ownedTurn(c.req.param('jobId'), lease);
		if (!turn) return c.json({ error: 'stale lease' }, 409);
		turn.leaseExpiresAt = Date.now() + leaseMs;
		return c.json({ leaseExpiresAt: new Date(turn.leaseExpiresAt).toISOString() });
	});
	routes.post('/jobs/:jobId/complete', async (c) => {
		const request = (await c.req.json()) as LoginExecutorCompleteRequest;
		const turn = ownedTurn(c.req.param('jobId'), request);
		if (!turn) return c.json({ error: 'stale lease' }, 409);
		try {
			const result = parseLoginExecutorResult(request.result);
			for (const part of result.content) {
				if (part.type === 'toolCall' && !turn.toolNames.includes(part.name)) {
					return c.json({ error: `unknown tool: ${part.name}` }, 400);
				}
			}
			settle(turn);
			turn.resolve({ jobId: turn.jobId, result });
			return c.json({ accepted: true });
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
	});
	routes.post('/jobs/:jobId/fail', async (c) => {
		const request = (await c.req.json()) as LoginExecutorFailRequest;
		const turn = ownedTurn(c.req.param('jobId'), request);
		if (!turn) return c.json({ error: 'stale lease' }, 409);
		if (typeof request.error !== 'string' || request.error.length === 0) {
			return c.json({ error: 'invalid failure' }, 400);
		}
		settle(turn);
		turn.reject(new Error(request.error));
		return c.json({ accepted: true });
	});

	return {
		routes,
		pending: () => turns.length,
	};
}
