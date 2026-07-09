import type { AssistantMessage } from '@earendil-works/pi-ai/compat';
import { defineAgent, defineWorkflow, type PromptResponse, type SessionEnv } from '@flue/runtime';
import {
	createFlueContext,
	generateWorkflowRunId,
	invokeWorkflowAttached,
	resolveModel,
	type RunStatus,
} from '@flue/runtime/internal';
import { sqlite } from '@flue/runtime/node';
import { createLoginExecutorBroker } from './broker.ts';
import { createPiCodexExecutor } from './pi-codex.ts';
import { defineCodexLoginProfile } from './profile.ts';
import type { LoginExecutorJob } from './protocol.ts';
import { runLoginWorker } from './worker.ts';

export type LocalCodexWorkflowStep =
	| 'workflow_started'
	| 'login_agent_started'
	| 'login_agent_completed'
	| 'workflow_completed';

export interface LocalCodexWorkflowOptions {
	prompt: string;
	model?: string;
	systemPrompt?: string;
	authFile?: string;
	signal?: AbortSignal;
	execute?: (job: LoginExecutorJob, signal?: AbortSignal) => Promise<AssistantMessage>;
	onStep?: (step: LocalCodexWorkflowStep) => void;
	onWorkerEvent?: (event: {
		type: 'claimed' | 'completed' | 'failed';
		jobId: string;
		error?: unknown;
	}) => void;
}

export interface LocalCodexWorkflowResult {
	runId: string;
	status: RunStatus | 'missing';
	loginText: string;
	model: PromptResponse['model'];
	usage: PromptResponse['usage'];
	steps: LocalCodexWorkflowStep[];
}

/** Run a complete Flue workflow containing exactly one Codex-login model operation. */
export async function runLocalCodexWorkflow(
	options: LocalCodexWorkflowOptions,
): Promise<LocalCodexWorkflowResult> {
	if (options.prompt.trim().length === 0)
		throw new TypeError('Local Codex workflow prompt must not be empty.');

	const token = crypto.randomUUID();
	const broker = createLoginExecutorBroker({ token });
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', forwardAbort, { once: true });
	if (options.signal?.aborted) forwardAbort();

	const steps: LocalCodexWorkflowStep[] = [];
	const recordStep = (step: LocalCodexWorkflowStep) => {
		steps.push(step);
		options.onStep?.(step);
	};
	const agent = defineAgent(() => ({
		profile: defineCodexLoginProfile({
			model: options.model ?? 'gpt-5.4',
			...(options.systemPrompt ? { instructions: options.systemPrompt } : {}),
		}),
	}));
	const workflow = defineWorkflow({
		agent,
		async run({ harness }) {
			recordStep('workflow_started');
			const session = await harness.session();
			recordStep('login_agent_started');
			const response = await session.prompt(options.prompt, { signal: controller.signal });
			recordStep('login_agent_completed');
			const loginText = response.text;
			recordStep('workflow_completed');
			return {
				loginText,
				model: { provider: response.model.provider, id: response.model.id },
				usage: {
					input: response.usage.input,
					output: response.usage.output,
					cacheRead: response.usage.cacheRead,
					cacheWrite: response.usage.cacheWrite,
					totalTokens: response.usage.totalTokens,
					cost: {
						input: response.usage.cost.input,
						output: response.usage.cost.output,
						cacheRead: response.usage.cost.cacheRead,
						cacheWrite: response.usage.cost.cacheWrite,
						total: response.usage.cost.total,
					},
				},
				steps: [...steps],
			};
		},
	});

	const persistence = sqlite();
	await persistence.migrate?.();
	const stores = await persistence.connect();
	const runId = generateWorkflowRunId();
	const request = new Request('http://login-executor.local/workflows/oauth-proof', {
		method: 'POST',
	});
	const invocation = invokeWorkflowAttached({
		workflowName: 'oauth-proof',
		runId,
		workflow,
		input: undefined,
		request,
		runStore: stores.runStore,
		eventStreamStore: stores.eventStreamStore,
		createContext: ({ runId: contextRunId, request: contextRequest }) =>
			createFlueContext({
				id: contextRunId,
				runId: contextRunId,
				req: contextRequest,
				env: {},
				agentConfig: { resolveModel },
				createDefaultEnv: async () => createProofSessionEnv(),
			}),
	});
	const worker = runLoginWorker({
		url: 'http://login-executor.local',
		token,
		workerId: 'local-workflow-codex',
		waitMs: 0,
		heartbeatMs: 5_000,
		signal: controller.signal,
		execute: options.execute ?? createPiCodexExecutor({ authFile: options.authFile }),
		fetch: async (input, init) => broker.routes.fetch(new Request(input, init)),
		onEvent: options.onWorkerEvent,
	});

	try {
		const completed = await invocation;
		const run = await stores.runStore.getRun(runId);
		const result = completed.result as {
			loginText: string;
			model: PromptResponse['model'];
			usage: PromptResponse['usage'];
			steps: LocalCodexWorkflowStep[];
		};
		return { runId, status: run?.status ?? 'missing', ...result };
	} finally {
		controller.abort();
		await worker;
		await persistence.close?.();
		options.signal?.removeEventListener('abort', forwardAbort);
	}
}

function createProofSessionEnv(): SessionEnv {
	return {
		cwd: '/workspace',
		resolvePath: (path) => (path.startsWith('/') ? path : `/workspace/${path}`),
		exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
		readFile: async () => '',
		readFileBuffer: async () => new Uint8Array(),
		writeFile: async () => {},
		stat: async () => ({ isFile: false, isDirectory: false }),
		readdir: async () => [],
		exists: async () => false,
		mkdir: async () => {},
		rm: async () => {},
	};
}
