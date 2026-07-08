import type { AssistantMessageEvent, Model } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { defineAgent, LocalHarnessProviderError } from '../src/index.ts';
import { createFlueContext, resolveModel } from '../src/internal.ts';
import {
	getLocalHarnessApiProvider,
	registerLocalHarnessProvider,
} from '../src/node/local-harness-provider.ts';
import { resetProviderRuntime } from '../src/runtime/providers.ts';
import { createNoopSessionEnv } from './fixtures/session-env.ts';

afterEach(() => {
	resetProviderRuntime();
});

async function collectEvents(
	stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function createContext() {
	return createFlueContext({
		id: 'local-harness-provider-test-instance',
		env: {},
		agentConfig: {
			resolveModel,
		},
		createDefaultEnv: async () => createNoopSessionEnv(),
	});
}

describe('registerLocalHarnessProvider()', () => {
	it('routes an agent prompt through the registered local harness provider when the agent selects its model', async () => {
		registerLocalHarnessProvider('fake-pi', {
			kind: 'pi',
			command: process.execPath,
			args: [
				'-e',
				[
					'const chunks = [];',
					'process.stdin.on("data", chunk => chunks.push(chunk));',
					'process.stdin.on("end", () => {',
					'  const prompt = Buffer.concat(chunks).toString("utf8");',
					'  process.stdout.write(prompt.includes("Say hello.") ? "hello from local harness" : "missing prompt");',
					'});',
				].join(''),
				'--',
			],
		});
		const harness = await createContext().initializeRootHarness(
			defineAgent(() => ({ model: 'fake-pi/default' })),
		);
		const session = await harness.session();

		const response = await session.prompt('Say hello.');

		expect(response.text).toBe('hello from local harness');
		expect(response.model).toEqual({ provider: 'fake-pi', id: 'default' });
	});

	it('passes the selected model id to the local CLI when the model is not default', async () => {
		registerLocalHarnessProvider('fake-codex', {
			kind: 'codex',
			command: process.execPath,
			args: [
				'-e',
				[
					'process.stdin.resume();',
					'process.stdin.on("end", () => {',
					'  process.stdout.write(JSON.stringify(process.argv.slice(1)));',
					'});',
				].join(''),
				'--',
			],
		});
		const harness = await createContext().initializeRootHarness(
			defineAgent(() => ({ model: 'fake-codex/gpt-5-codex' })),
		);
		const session = await harness.session();

		const response = await session.prompt('Say hello.');

		expect(JSON.parse(response.text)).toEqual(
			expect.arrayContaining(['--model', 'gpt-5-codex']),
		);
	});

	it('emits a local harness provider error when the CLI exits unsuccessfully', async () => {
		registerLocalHarnessProvider('failing-cli', {
			kind: 'pi',
			command: process.execPath,
			args: [
				'-e',
				[
					'process.stdin.resume();',
					'process.stdin.on("end", () => {',
					'  process.stderr.write("fake cli failed");',
					'  process.exit(7);',
					'});',
				].join(''),
				'--',
			],
		});
		const model = resolveModel('failing-cli/default');
		expect(model).toBeDefined();
		if (!model) throw new Error('Expected a resolved local harness model.');

		const events = await collectEvents(
			getLocalHarnessApiProvider().streamSimple(
				model as Model<'local-harness'>,
				{ messages: [] },
			),
		);

		const error = events.find((event) => event.type === 'error');
		expect(error).toMatchObject({
			type: 'error',
			reason: 'error',
			error: {
				errorMessage: 'Local harness provider "failing-cli" failed.',
			},
		});
	});

	it('throws LocalHarnessProviderError when a custom provider id omits its harness kind', () => {
		expect(() => registerLocalHarnessProvider('custom-local')).toThrow(
			LocalHarnessProviderError,
		);
	});
});
