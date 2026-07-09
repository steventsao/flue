import type {
	ApiProvider,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import type { LoginExecutorResult, LoginHarness } from './protocol.ts';

export const LOGIN_EXECUTOR_API = 'flue-login-executor';

export interface LoginTurnRequest {
	harness: LoginHarness;
	model: string;
	prompt: string;
	toolNames: string[];
	signal?: AbortSignal;
}

export interface LoginTurnQueue {
	enqueue(request: LoginTurnRequest): Promise<{ jobId: string; result: LoginExecutorResult }>;
}

export function createLoginApiProvider(options: {
	queue: LoginTurnQueue;
	providers: ReadonlyMap<string, LoginHarness>;
}): ApiProvider {
	const stream = (
		model: Model<any>,
		context: Context,
		streamOptions?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const output = createAssistantMessageEventStream();
		queueMicrotask(async () => {
			let prompt = '';
			try {
				const harness = options.providers.get(model.provider);
				if (!harness)
					throw new Error(`No login harness is configured for provider "${model.provider}".`);
				const toolNames = context.tools?.map((tool) => tool.name) ?? [];
				prompt = renderLoginPrompt(context);
				const completed = await options.queue.enqueue({
					harness,
					model: model.id,
					prompt,
					toolNames,
					signal: streamOptions?.signal,
				});
				const message = toAssistantMessage(model, completed.jobId, completed.result, prompt);
				emitMessage(output, message);
			} catch (error) {
				const aborted = streamOptions?.signal?.aborted === true;
				const message = toErrorMessage(model, error, aborted, prompt);
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

function renderLoginPrompt(context: Context): string {
	assertTextOnlyContext(context);
	return [
		'You are fulfilling one model turn for a remote Flue agent.',
		'Do not execute the listed tools yourself. Populate toolCalls when the Flue runtime should execute one.',
		'Return only the structured response required by the supplied output schema.',
		'',
		JSON.stringify(
			{
				systemPrompt: context.systemPrompt,
				messages: context.messages,
				tools: context.tools,
			},
			null,
			2,
		),
	].join('\n');
}

function assertTextOnlyContext(context: Context): void {
	for (const message of context.messages) {
		const content = 'content' in message ? message.content : undefined;
		if (!Array.isArray(content)) continue;
		if (content.some((part) => part.type === 'image')) {
			throw new Error('Login executors do not support image content yet.');
		}
	}
}

function estimateUsage(prompt: string, result?: LoginExecutorResult) {
	const input = estimateTokens(prompt);
	const output = result ? estimateTokens(JSON.stringify(result)) : 0;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function estimateTokens(value: string): number {
	return value.length === 0 ? 0 : Math.ceil(value.length / 4);
}

function toAssistantMessage(
	model: Model<any>,
	jobId: string,
	result: LoginExecutorResult,
	prompt: string,
): AssistantMessage {
	return {
		role: 'assistant',
		content: result.content.map((part, index) =>
			part.type === 'text'
				? part
				: {
						type: 'toolCall' as const,
						id: `login:${jobId}:${index}`,
						name: part.name,
						arguments: part.arguments,
					},
		),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: estimateUsage(prompt, result),
		stopReason: result.stopReason,
		timestamp: Date.now(),
	};
}

function toErrorMessage(
	model: Model<any>,
	error: unknown,
	aborted: boolean,
	prompt: string,
): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: estimateUsage(prompt),
		stopReason: aborted ? 'aborted' : 'error',
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function emitMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
	const partial: AssistantMessage = { ...message, content: [] };
	stream.push({ type: 'start', partial: { ...partial } });
	for (const [index, block] of message.content.entries()) {
		if (block.type === 'text') {
			partial.content = [...partial.content, { type: 'text', text: block.text }];
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
		if (block.type === 'toolCall') {
			partial.content = [...partial.content, block];
			stream.push({ type: 'toolcall_start', contentIndex: index, partial: { ...partial } });
			stream.push({
				type: 'toolcall_end',
				contentIndex: index,
				toolCall: block,
				partial: { ...partial },
			});
		}
	}
	stream.push({
		type: 'done',
		reason: message.stopReason as 'stop' | 'toolUse' | 'length',
		message,
	});
	stream.end(message);
}
