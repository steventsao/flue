import type { AssistantMessage, Context, SimpleStreamOptions } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import {
	parseLoginExecutorMessage,
	serializeLoginContext,
	serializeLoginTurnOptions,
} from '../src/protocol.ts';

describe('serializeLoginContext()', () => {
	it('preserves native replay fields while removing implementation-only details', () => {
		const context: Context = {
			messages: [
				{
					role: 'assistant',
					content: [{ type: 'thinking', thinking: 'plan', thinkingSignature: 'opaque' }],
					api: 'openai-codex-responses',
					provider: 'openai-codex',
					model: 'gpt-5.4',
					responseId: 'response-1',
					diagnostics: [{ type: 'unknown', timestamp: 1, details: { local: true } }],
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: 'stop',
					timestamp: 1,
				},
				{
					role: 'toolResult',
					toolCallId: 'call-1',
					toolName: 'lookup',
					content: [{ type: 'text', text: 'done' }],
					details: { local: true },
					isError: false,
					timestamp: 2,
				},
			],
		};

		const wire = serializeLoginContext(context);

		expect(wire.messages[0]).toMatchObject({
			responseId: 'response-1',
			content: [{ thinkingSignature: 'opaque' }],
		});
		expect(wire.messages[0]).not.toHaveProperty('diagnostics');
		expect(wire.messages[1]).not.toHaveProperty('details');
	});
});

describe('serializeLoginTurnOptions()', () => {
	it('omits provider credentials and callbacks when preparing a worker job', () => {
		const options: SimpleStreamOptions = {
			apiKey: 'must-not-cross-the-wire',
			headers: { authorization: 'secret' },
			env: { TOKEN: 'secret' },
			reasoning: 'high',
			maxTokens: 2_000,
			sessionId: 'session-1',
			onPayload: () => undefined,
		};

		expect(serializeLoginTurnOptions(options)).toEqual({
			reasoning: 'high',
			maxTokens: 2_000,
			sessionId: 'session-1',
		});
	});
});

describe('parseLoginExecutorMessage()', () => {
	it('preserves native tool identifiers, signatures, and usage when the worker completes', () => {
		const message: AssistantMessage = {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'call-1|item-1',
					name: 'lookup',
					arguments: { query: 'flue' },
					thoughtSignature: 'opaque',
				},
			],
			api: 'openai-codex-responses',
			provider: 'openai-codex',
			model: 'gpt-5.4',
			responseId: 'response-1',
			usage: {
				input: 10,
				output: 5,
				cacheRead: 2,
				cacheWrite: 0,
				totalTokens: 17,
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
			},
			stopReason: 'toolUse',
			timestamp: 1,
		};

		expect(parseLoginExecutorMessage(message)).toEqual(message);
	});
});
