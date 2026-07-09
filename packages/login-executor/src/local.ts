import { type AssistantMessage, completeSimple, type Model } from '@earendil-works/pi-ai/compat';
import { createLoginExecutorBroker } from './broker.ts';
import { createPiCodexExecutor } from './pi-codex.ts';
import type { LoginExecutorJob } from './protocol.ts';
import { LOGIN_EXECUTOR_API } from './provider.ts';
import { runLoginWorker } from './worker.ts';

export interface LocalCodexOptions {
	prompt: string;
	model?: string;
	systemPrompt?: string;
	authFile?: string;
	signal?: AbortSignal;
	execute?: (job: LoginExecutorJob, signal?: AbortSignal) => Promise<AssistantMessage>;
	onEvent?: (event: {
		type: 'claimed' | 'completed' | 'failed';
		jobId: string;
		error?: unknown;
	}) => void;
}

/** Run one native Pi turn through the provider, broker, lease, and OAuth worker. */
export async function runLocalCodex(options: LocalCodexOptions): Promise<AssistantMessage> {
	if (options.prompt.trim().length === 0)
		throw new TypeError('Local Codex prompt must not be empty.');
	const token = crypto.randomUUID();
	const broker = createLoginExecutorBroker({ token, serializeAgentOperations: false });
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', forwardAbort, { once: true });
	if (options.signal?.aborted) forwardAbort();
	const modelId = options.model ?? 'gpt-5.4';
	const model: Model<any> = {
		id: modelId,
		name: modelId,
		api: LOGIN_EXECUTOR_API,
		provider: 'codex-login',
		baseUrl: 'flue://login-executor',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
	};
	const completion = completeSimple(
		model,
		{
			systemPrompt: options.systemPrompt,
			messages: [{ role: 'user', content: options.prompt, timestamp: Date.now() }],
		},
		{ signal: controller.signal },
	);
	const worker = runLoginWorker({
		url: 'http://login-executor.local',
		token,
		workerId: 'local-codex',
		waitMs: 0,
		heartbeatMs: 5_000,
		signal: controller.signal,
		execute: options.execute ?? createPiCodexExecutor({ authFile: options.authFile }),
		fetch: async (input, init) => broker.routes.fetch(new Request(input, init)),
		onEvent: options.onEvent,
	});
	try {
		return await completion;
	} finally {
		controller.abort();
		await worker;
		options.signal?.removeEventListener('abort', forwardAbort);
	}
}
