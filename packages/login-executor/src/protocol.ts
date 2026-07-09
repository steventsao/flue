import type {
	AssistantMessage,
	Context,
	SimpleStreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
} from '@earendil-works/pi-ai/compat';

export interface LoginExecutorTurnOptions {
	temperature?: number;
	maxTokens?: number;
	reasoning?: ThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
	transport?: 'sse' | 'websocket' | 'websocket-cached' | 'auto';
	cacheRetention?: 'none' | 'short' | 'long';
	sessionId?: string;
	timeoutMs?: number;
	websocketConnectTimeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	metadata?: Record<string, unknown>;
}

export interface LoginExecutorJob {
	jobId: string;
	fence: number;
	workerId: string;
	model: string;
	context: Context;
	options: LoginExecutorTurnOptions;
	createdAt: string;
	leaseExpiresAt: string;
}

export interface LoginExecutorClaimRequest {
	workerId: string;
	waitMs?: number;
}

export interface LoginExecutorLeaseRequest {
	workerId: string;
	fence: number;
}

export interface LoginExecutorCompleteRequest extends LoginExecutorLeaseRequest {
	result: AssistantMessage;
}

export interface LoginExecutorFailRequest extends LoginExecutorLeaseRequest {
	error: string;
}

/** Copy only JSON-safe, non-secret options onto the worker job. */
export function serializeLoginTurnOptions(options?: SimpleStreamOptions): LoginExecutorTurnOptions {
	if (!options) return {};
	return pickDefined({
		temperature: options.temperature,
		maxTokens: options.maxTokens,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
		transport: options.transport,
		cacheRetention: options.cacheRetention,
		sessionId: options.sessionId,
		timeoutMs: options.timeoutMs,
		websocketConnectTimeoutMs: options.websocketConnectTimeoutMs,
		maxRetries: options.maxRetries,
		maxRetryDelayMs: options.maxRetryDelayMs,
		metadata: options.metadata,
	});
}

/** Remove implementation-only message fields before crossing the JSON wire. */
export function serializeLoginContext(context: Context): Context {
	return {
		...(context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt }),
		messages: context.messages.map((message) => {
			if (message.role === 'toolResult') {
				const { details: _details, ...wireMessage } = message;
				return wireMessage;
			}
			if (message.role === 'assistant') {
				const { diagnostics: _diagnostics, ...wireMessage } = message;
				return wireMessage;
			}
			return message;
		}),
		...(context.tools === undefined ? {} : { tools: context.tools }),
	};
}

/** Validate and narrow an untrusted worker completion. */
export function parseLoginExecutorMessage(value: unknown): AssistantMessage {
	if (!isRecord(value) || value.role !== 'assistant') {
		throw new TypeError('Login executor result must be an assistant message.');
	}
	if (
		typeof value.api !== 'string' ||
		typeof value.provider !== 'string' ||
		typeof value.model !== 'string' ||
		typeof value.timestamp !== 'number' ||
		!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(value.stopReason)) ||
		!Array.isArray(value.content) ||
		!isUsage(value.usage)
	) {
		throw new TypeError('Login executor result contains invalid message metadata.');
	}
	for (const part of value.content) {
		if (!isRecord(part)) throw new TypeError('Login executor content must contain objects.');
		if (part.type === 'text' && typeof part.text === 'string') continue;
		if (part.type === 'thinking' && typeof part.thinking === 'string') continue;
		if (
			part.type === 'toolCall' &&
			typeof part.id === 'string' &&
			typeof part.name === 'string' &&
			isRecord(part.arguments)
		) {
			continue;
		}
		throw new TypeError('Login executor result contains an invalid content block.');
	}
	const { diagnostics: _diagnostics, ...message } = value;
	return message as unknown as AssistantMessage;
}

function isUsage(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.cost)) return false;
	return ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every(
		(key) => typeof value[key] === 'number',
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickDefined<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as Partial<T>;
}
