export type LoginHarness = 'codex' | 'claude';

export type LoginExecutorContent =
	| { type: 'text'; text: string }
	| { type: 'toolCall'; name: string; arguments: Record<string, unknown> };

export interface LoginExecutorResult {
	content: LoginExecutorContent[];
	stopReason: 'stop' | 'toolUse';
}

export interface LoginExecutorJob {
	jobId: string;
	fence: number;
	workerId: string;
	harness: LoginHarness;
	model: string;
	prompt: string;
	outputSchema: Record<string, unknown>;
	createdAt: string;
	leaseExpiresAt: string;
}

export interface LoginExecutorClaimRequest {
	workerId: string;
	harness: LoginHarness;
	waitMs?: number;
}

export interface LoginExecutorLeaseRequest {
	workerId: string;
	fence: number;
}

export interface LoginExecutorCompleteRequest extends LoginExecutorLeaseRequest {
	result: LoginExecutorResult;
}

export interface LoginExecutorFailRequest extends LoginExecutorLeaseRequest {
	error: string;
}

export const LOGIN_EXECUTOR_OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		text: {
			type: 'string',
			description: 'Assistant text. Use an empty string when returning only tool calls.',
		},
		toolCalls: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string' },
					arguments: {
						type: 'string',
						description: 'A JSON object encoded as a string.',
					},
				},
				required: ['name', 'arguments'],
			},
		},
		stopReason: { type: 'string', enum: ['stop', 'toolUse'] },
	},
	required: ['text', 'toolCalls', 'stopReason'],
} as const;

export function parseLoginExecutorResult(value: unknown): LoginExecutorResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Login executor result must be an object.');
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.stopReason !== 'stop' && candidate.stopReason !== 'toolUse') {
		throw new TypeError('Login executor result has an invalid stopReason.');
	}
	const rawContent = Array.isArray(candidate.content)
		? candidate.content
		: flatWireContent(candidate.text, candidate.toolCalls);
	const content = rawContent.map((part): LoginExecutorContent => {
		if (!part || typeof part !== 'object' || Array.isArray(part)) {
			throw new TypeError('Login executor content must contain objects.');
		}
		const block = part as Record<string, unknown>;
		if (block.type === 'text' && typeof block.text === 'string') {
			return { type: 'text', text: block.text };
		}
		if (block.type === 'toolCall' && typeof block.name === 'string') {
			const arguments_ = parseToolArguments(block.arguments);
			return {
				type: 'toolCall',
				name: block.name,
				arguments: arguments_,
			};
		}
		throw new TypeError('Login executor result contains an invalid content block.');
	});
	const hasToolCall = content.some((part) => part.type === 'toolCall');
	if (candidate.stopReason === 'toolUse' && !hasToolCall) {
		throw new TypeError('A toolUse result must contain at least one tool call.');
	}
	return { content, stopReason: hasToolCall ? 'toolUse' : candidate.stopReason };
}

function flatWireContent(text: unknown, toolCalls: unknown): unknown[] {
	if (typeof text !== 'string' || !Array.isArray(toolCalls)) {
		throw new TypeError('Login executor result must contain content or flat wire fields.');
	}
	return [
		...(text.length > 0 ? [{ type: 'text', text }] : []),
		...toolCalls.map((toolCall) =>
			toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)
				? { type: 'toolCall', ...(toolCall as Record<string, unknown>) }
				: toolCall,
		),
	];
}

function parseToolArguments(value: unknown): Record<string, unknown> {
	const decoded = typeof value === 'string' ? JSON.parse(value) : value;
	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
		throw new TypeError('Login executor tool arguments must be a JSON object.');
	}
	return decoded as Record<string, unknown>;
}
