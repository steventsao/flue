import type {
	ApiProvider,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import {
	type LoginExecutorTurnOptions,
	serializeLoginContext,
	serializeLoginTurnOptions,
} from './protocol.ts';

export const LOGIN_EXECUTOR_API = 'flue-login-executor';

export interface LoginTurnRequest {
	model: string;
	context: Context;
	options: LoginExecutorTurnOptions;
	signal?: AbortSignal;
}

export interface LoginTurnQueue {
	enqueue(request: LoginTurnRequest): Promise<{ jobId: string; result: AssistantMessage }>;
}

export function createLoginApiProvider(options: { queue: LoginTurnQueue }): ApiProvider {
	const stream = (
		model: Model<any>,
		context: Context,
		streamOptions?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const output = createAssistantMessageEventStream();
		queueMicrotask(async () => {
			try {
				const completed = await options.queue.enqueue({
					model: model.id,
					context: serializeLoginContext(context),
					options: serializeLoginTurnOptions(streamOptions),
					signal: streamOptions?.signal,
				});
				emitMessage(output, completed.result);
			} catch (error) {
				const aborted = streamOptions?.signal?.aborted === true;
				const message = errorMessage(model, error, aborted);
				output.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
				output.end(message);
			}
		});
		return output;
	};

	return {
		api: LOGIN_EXECUTOR_API,
		stream,
		streamSimple: stream,
	};
}

function emitMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
	if (message.stopReason === 'error' || message.stopReason === 'aborted') {
		stream.push({ type: 'error', reason: message.stopReason, error: message });
		stream.end(message);
		return;
	}
	const partial: AssistantMessage = { ...message, content: [] };
	stream.push({ type: 'start', partial: { ...partial } });
	for (const [index, block] of message.content.entries()) {
		if (block.type === 'text') {
			partial.content = [...partial.content, block];
			stream.push({ type: 'text_start', contentIndex: index, partial: { ...partial } });
			stream.push({
				type: 'text_delta',
				contentIndex: index,
				delta: block.text,
				partial: { ...partial },
			});
			stream.push({
				type: 'text_end',
				contentIndex: index,
				content: block.text,
				partial: { ...partial },
			});
			continue;
		}
		if (block.type === 'thinking') {
			partial.content = [...partial.content, block];
			stream.push({ type: 'thinking_start', contentIndex: index, partial: { ...partial } });
			stream.push({
				type: 'thinking_delta',
				contentIndex: index,
				delta: block.thinking,
				partial: { ...partial },
			});
			stream.push({
				type: 'thinking_end',
				contentIndex: index,
				content: block.thinking,
				partial: { ...partial },
			});
			continue;
		}
		partial.content = [...partial.content, block];
		stream.push({ type: 'toolcall_start', contentIndex: index, partial: { ...partial } });
		stream.push({
			type: 'toolcall_end',
			contentIndex: index,
			toolCall: block,
			partial: { ...partial },
		});
	}
	stream.push({ type: 'done', reason: message.stopReason, message });
	stream.end(message);
}

function errorMessage(model: Model<any>, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: aborted ? 'aborted' : 'error',
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}
