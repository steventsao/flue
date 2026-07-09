import type { LoginExecutorJob, LoginExecutorResult, LoginHarness } from './protocol.ts';

export interface LoginWorkerOptions {
	url: string;
	token: string;
	harness: LoginHarness;
	execute(job: LoginExecutorJob, signal?: AbortSignal): Promise<LoginExecutorResult>;
	workerId?: string;
	waitMs?: number;
	heartbeatMs?: number;
	signal?: AbortSignal;
	fetch?: typeof globalThis.fetch;
	onEvent?: (event: {
		type: 'claimed' | 'completed' | 'failed';
		jobId: string;
		error?: unknown;
	}) => void;
}

/** Run one globally serialized login worker until its signal is aborted. */
export async function runLoginWorker(options: LoginWorkerOptions): Promise<void> {
	const fetch_ = options.fetch ?? globalThis.fetch;
	const baseUrl = options.url.replace(/\/$/, '');
	const workerId = options.workerId ?? crypto.randomUUID();
	const headers = {
		authorization: `Bearer ${options.token}`,
		'content-type': 'application/json',
	};
	while (!options.signal?.aborted) {
		let response: Response;
		try {
			response = await fetch_(`${baseUrl}/claim`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					workerId,
					harness: options.harness,
					waitMs: options.waitMs ?? 20_000,
				}),
				signal: options.signal,
			});
		} catch {
			if (options.signal?.aborted) return;
			await abortableDelay(1_000, options.signal);
			continue;
		}
		if (response.status === 204) continue;
		if (!response.ok) {
			throw new Error(
				`Login executor claim failed with ${response.status}: ${await response.text()}`,
			);
		}
		const job = (await response.json()) as LoginExecutorJob;
		options.onEvent?.({ type: 'claimed', jobId: job.jobId });
		const execution = new AbortController();
		const forwardAbort = () => execution.abort(options.signal?.reason);
		options.signal?.addEventListener('abort', forwardAbort, { once: true });
		const heartbeat = setInterval(() => {
			void fetch_(`${baseUrl}/jobs/${job.jobId}/heartbeat`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ workerId, fence: job.fence }),
			})
				.then((heartbeatResponse) => {
					if (heartbeatResponse.status === 409)
						execution.abort(new Error('Login executor lease expired.'));
				})
				.catch(() => {
					// A transient heartbeat failure is retried on the next interval. The
					// broker lease remains the authority for accepting the result.
				});
		}, options.heartbeatMs ?? 10_000);
		if (typeof heartbeat === 'object' && 'unref' in heartbeat) heartbeat.unref();
		try {
			const result = await options.execute(job, execution.signal);
			const completion = await fetch_(`${baseUrl}/jobs/${job.jobId}/complete`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ workerId, fence: job.fence, result }),
				signal: options.signal,
			});
			if (completion.status === 409) {
				throw new Error('Login executor completion rejected a stale lease.');
			}
			if (!completion.ok) {
				throw new Error(`Login executor completion failed with ${completion.status}.`);
			}
			options.onEvent?.({ type: 'completed', jobId: job.jobId });
		} catch (error) {
			if (!options.signal?.aborted) {
				try {
					await fetch_(`${baseUrl}/jobs/${job.jobId}/fail`, {
						method: 'POST',
						headers,
						body: JSON.stringify({
							workerId,
							fence: job.fence,
							error: error instanceof Error ? error.message : String(error),
						}),
					});
				} catch {
					// Losing the failure acknowledgement must not stop the worker. The
					// broker will recover the job when its lease expires.
				}
			}
			options.onEvent?.({ type: 'failed', jobId: job.jobId, error });
		} finally {
			clearInterval(heartbeat);
			options.signal?.removeEventListener('abort', forwardAbort);
		}
	}
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;
	await new Promise<void>((resolve) => {
		const finish = () => {
			signal?.removeEventListener('abort', abort);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		const abort = () => {
			clearTimeout(timer);
			finish();
		};
		signal?.addEventListener('abort', abort, { once: true });
	});
}
