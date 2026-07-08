/**
 * Node provider that routes model turns through an installed local agent CLI.
 *
 * This intentionally adapts only final text. CLIs such as Codex, Claude Code,
 * Pi, and opencode have their own tool/session protocols, so Flue cannot safely
 * translate their internal tool calls into pi-ai tool call events yet.
 */
import { spawn } from 'node:child_process';
import type {
	ApiProvider,
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	Usage,
} from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { LocalHarnessProviderError } from '../errors.ts';
import { registerApiProvider, registerProvider } from '../runtime/providers.ts';

export const LOCAL_HARNESS_API = 'local-harness' as const;

export type LocalHarnessKind = 'pi' | 'codex' | 'claude' | 'opencode';

export interface LocalHarnessProviderOptions {
	/**
	 * Which supported CLI argument profile to use. Defaults to `providerId`
	 * when it is one of the supported kind names.
	 */
	kind?: LocalHarnessKind;
	/** CLI executable. Defaults to the selected kind, e.g. `codex`. */
	command?: string;
	/** Arguments prepended before Flue's noninteractive/model arguments. */
	args?: readonly string[];
	/** Working directory for the child process. Defaults to the current process cwd. */
	cwd?: string;
	/** Environment overrides layered over `process.env`. Set a key to `undefined` to remove it. */
	env?: Record<string, string | undefined>;
	/** Wall-clock timeout for one model turn. Defaults to 5 minutes. */
	timeoutMs?: number;
	/** Best-effort CLI tool isolation. Defaults to true. */
	disableTools?: boolean;
	/** Maximum captured stdout or stderr bytes before the process is terminated. */
	maxOutputBytes?: number;
}

interface RegisteredLocalHarnessProvider extends Required<Pick<LocalHarnessProviderOptions, 'kind'>> {
	command: string;
	args: readonly string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
	timeoutMs: number;
	disableTools: boolean;
	maxOutputBytes: number;
}

interface LocalHarnessInvocation {
	providerId: string;
	modelId: string;
	reasoning?: SimpleStreamOptions['reasoning'];
	prompt: string;
	signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const LOCAL_HARNESS_BASE_URL = 'http://local-harness.invalid';
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(27)}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`,
	'g',
);
const providers = new Map<string, RegisteredLocalHarnessProvider>();

export function registerLocalHarnessProvider(
	providerId: string,
	options: LocalHarnessProviderOptions = {},
): void {
	const kind = options.kind ?? inferKind(providerId);
	providers.set(providerId, {
		kind,
		command: options.command ?? kind,
		args: options.args ?? [],
		cwd: options.cwd,
		env: options.env,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		disableTools: options.disableTools ?? true,
		maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
	});
	registerApiProvider(
		getLocalHarnessApiProvider() as unknown as Parameters<typeof registerApiProvider>[0],
	);
	registerProvider(providerId, {
		api: LOCAL_HARNESS_API,
		baseUrl: LOCAL_HARNESS_BASE_URL,
		telemetry: { providerName: `local.${kind}` },
	});
}

export function getLocalHarnessApiProvider(): ApiProvider<typeof LOCAL_HARNESS_API, StreamOptions> {
	return {
		api: LOCAL_HARNESS_API,
		stream: streamLocalHarness,
		streamSimple: streamLocalHarness,
	};
}

const streamLocalHarness = (
	model: Model<typeof LOCAL_HARNESS_API>,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		const output: AssistantMessage = {
			role: 'assistant',
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: 'stop',
			timestamp: Date.now(),
		};

		try {
			const provider = providers.get(model.provider);
			if (!provider) {
				throw new LocalHarnessProviderError({
					providerId: model.provider,
					command: [model.provider],
				});
			}

			stream.push({ type: 'start', partial: output });
			const text = await invokeLocalHarness(provider, {
				providerId: model.provider,
				modelId: model.id,
				reasoning: options?.reasoning,
				prompt: renderPrompt(context),
				signal: options?.signal,
			});
			const block = { type: 'text' as const, text };
			output.content.push(block);
			stream.push({ type: 'text_start', contentIndex: 0, partial: output });
			if (text.length > 0) {
				stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: output });
			}
			stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: output });
			stream.push({ type: 'done', reason: 'stop', message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: 'error', reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

async function invokeLocalHarness(
	provider: RegisteredLocalHarnessProvider,
	invocation: LocalHarnessInvocation,
): Promise<string> {
	const plan = buildInvocationPlan(provider, invocation);
	const command = [provider.command, ...plan.args];
	const env = { ...process.env };
	for (const [key, value] of Object.entries(provider.env ?? {})) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}

	return await new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		let settled = false;
		let timeout: NodeJS.Timeout | undefined;
		let killTimer: NodeJS.Timeout | undefined;
		const child = spawn(provider.command, plan.args, {
			cwd: provider.cwd,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const settle = (result: { text: string } | { error: unknown }): void => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (killTimer) clearTimeout(killTimer);
			invocation.signal?.removeEventListener('abort', abort);
			if ('error' in result) reject(result.error);
			else resolve(stripAnsi(result.text).trim());
		};

		const fail = (partial: Partial<ConstructorParameters<typeof LocalHarnessProviderError>[0]>): void => {
			settle({
				error: new LocalHarnessProviderError({
					providerId: invocation.providerId,
					command,
					stdout: truncateForError(stdout),
					stderr: truncateForError(stderr),
					...partial,
				}),
			});
		};

		const abort = (): void => {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
			fail({ signal: 'SIGTERM' });
		};

		timeout = setTimeout(() => {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
			fail({ signal: 'SIGTERM' });
		}, provider.timeoutMs);

		invocation.signal?.addEventListener('abort', abort, { once: true });

		child.once('error', (cause) => fail({ cause }));
		child.stdin.on('error', () => {});
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout = appendBounded(stdout, chunk, provider.maxOutputBytes);
			if (Buffer.byteLength(stdout) >= provider.maxOutputBytes) {
				child.kill('SIGTERM');
				fail({ stderr: 'Local harness stdout exceeded the configured maxOutputBytes.' });
			}
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			stderr = appendBounded(stderr, chunk, provider.maxOutputBytes);
			if (Buffer.byteLength(stderr) >= provider.maxOutputBytes) {
				child.kill('SIGTERM');
				fail({ stderr: 'Local harness stderr exceeded the configured maxOutputBytes.' });
			}
		});
		child.once('close', (exitCode, signal) => {
			if (exitCode === 0 && !signal) {
				settle({ text: plan.outputFrom === 'stdout' ? stdout : '' });
				return;
			}
			fail({ exitCode, signal });
		});

		if (plan.stdin !== undefined) {
			child.stdin.end(plan.stdin);
		} else {
			child.stdin.end();
		}
	});
}

interface InvocationPlan {
	args: string[];
	stdin?: string;
	outputFrom: 'stdout';
}

function buildInvocationPlan(
	provider: RegisteredLocalHarnessProvider,
	invocation: LocalHarnessInvocation,
): InvocationPlan {
	const args = [...provider.args];
	switch (provider.kind) {
		case 'pi':
			args.push('-p', '--no-session', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes');
			if (provider.disableTools) args.push('--no-tools');
			appendModelArg(args, '--model', invocation.modelId);
			appendReasoningArg(args, '--thinking', invocation.reasoning);
			return { args, stdin: invocation.prompt, outputFrom: 'stdout' };
		case 'codex':
			args.push('exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never');
			if (provider.cwd) args.push('--cd', provider.cwd);
			if (provider.disableTools) args.push('--sandbox', 'read-only');
			appendModelArg(args, '--model', invocation.modelId);
			appendCodexReasoningArg(args, invocation.reasoning);
			args.push('-');
			return { args, stdin: invocation.prompt, outputFrom: 'stdout' };
		case 'claude':
			args.push('--print', '--output-format', 'text', '--no-session-persistence', '--disable-slash-commands');
			if (provider.disableTools) {
				args.push(
					'--disallowedTools',
					'Bash',
					'Edit',
					'MultiEdit',
					'NotebookEdit',
					'Read',
					'Task',
					'TodoWrite',
					'WebFetch',
					'WebSearch',
					'Write',
				);
			}
			appendModelArg(args, '--model', invocation.modelId);
			appendReasoningArg(args, '--effort', invocation.reasoning);
			return { args, stdin: invocation.prompt, outputFrom: 'stdout' };
		case 'opencode':
			args.push('run', '--title', `flue-${invocation.providerId}`);
			if (provider.cwd) args.push('--dir', provider.cwd);
			if (provider.disableTools) args.push('--pure');
			appendModelArg(args, '--model', invocation.modelId);
			appendReasoningArg(args, '--variant', invocation.reasoning);
			args.push(invocation.prompt);
			return { args, outputFrom: 'stdout' };
	}
}

function inferKind(providerId: string): LocalHarnessKind {
	if (providerId === 'pi' || providerId === 'codex' || providerId === 'claude' || providerId === 'opencode') {
		return providerId;
	}
	throw new LocalHarnessProviderError({
		providerId,
		command: [providerId],
		stderr: 'Pass `kind` when registering a local harness provider with a custom provider ID.',
	});
}

function appendModelArg(args: string[], flag: string, modelId: string): void {
	if (modelId !== 'default') args.push(flag, modelId);
}

function appendReasoningArg(
	args: string[],
	flag: string,
	reasoning: SimpleStreamOptions['reasoning'] | undefined,
): void {
	if (reasoning) args.push(flag, reasoning);
}

function appendCodexReasoningArg(
	args: string[],
	reasoning: SimpleStreamOptions['reasoning'] | undefined,
): void {
	if (reasoning) args.push('-c', `model_reasoning_effort="${reasoning}"`);
}

function renderPrompt(context: Context): string {
	const sections: string[] = [
		'You are responding as the model for a Flue agent turn.',
		'Return only the assistant response text. Do not emit tool-call JSON; this local harness adapter accepts final text only.',
	];
	if (context.systemPrompt?.trim()) {
		sections.push(`System instructions:\n${context.systemPrompt.trim()}`);
	}
	if (context.messages.length > 0) {
		sections.push(`Conversation:\n${context.messages.map(renderMessage).join('\n\n')}`);
	}
	if (context.tools && context.tools.length > 0) {
		sections.push(
			`Unavailable Flue tools:\n${context.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`,
		);
	}
	sections.push('Respond to the latest user message.');
	return sections.join('\n\n');
}

function renderMessage(message: Context['messages'][number]): string {
	const role = 'role' in message && typeof message.role === 'string' ? message.role.toUpperCase() : 'MESSAGE';
	return `${role}:\n${renderContent((message as { content?: unknown }).content)}`;
}

function renderContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content.map(renderContentPart).join('\n');
	}
	if (content && typeof content === 'object') return renderContentPart(content);
	return '';
}

function renderContentPart(part: unknown): string {
	if (typeof part === 'string') return part;
	if (!part || typeof part !== 'object') return '';
	const value = part as Record<string, unknown>;
	if (value.type === 'text' && typeof value.text === 'string') return value.text;
	if (value.type === 'thinking') return '[reasoning omitted]';
	if (value.type === 'image') return '[image omitted]';
	if (value.type === 'toolCall') {
		return `[assistant requested tool ${String(value.name ?? 'unknown')}: ${safeJson(value.arguments)}]`;
	}
	if (value.type === 'toolResult') {
		return `[tool result ${String(value.name ?? 'unknown')}: ${renderContent(value.content)}]`;
	}
	if (typeof value.text === 'string') return value.text;
	return safeJson(value);
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return '[unserializable content]';
	}
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function appendBounded(value: string, chunk: string, maxBytes: number): string {
	const next = value + chunk;
	if (Buffer.byteLength(next) <= maxBytes) return next;
	return next.slice(0, maxBytes);
}

function truncateForError(value: string): string | undefined {
	const stripped = stripAnsi(value).trim();
	if (!stripped) return undefined;
	return stripped.length > 4000 ? `${stripped.slice(0, 4000)}\n[truncated]` : stripped;
}

function stripAnsi(value: string): string {
	return value.replace(ANSI_ESCAPE_PATTERN, '');
}
