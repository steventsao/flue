import type { AssistantMessage } from '@earendil-works/pi-ai/compat';
import { afterEach, describe, expect, it } from 'vitest';
import { runLocalCodexWorkflow } from '../src/local-workflow.ts';

afterEach(async () => {
	const runtime = await import('@flue/runtime/internal');
	runtime.resetProviderRuntime();
});

describe('runLocalCodexWorkflow()', () => {
	it('continues and completes a workflow after its single login-agent step settles', async () => {
		let releaseLogin!: () => void;
		const loginGate = new Promise<void>((resolve) => {
			releaseLogin = resolve;
		});
		let markClaimed!: () => void;
		const claimed = new Promise<void>((resolve) => {
			markClaimed = resolve;
		});
		const steps: string[] = [];
		let executions = 0;

		const proof = runLocalCodexWorkflow({
			prompt: 'Complete the login step.',
			model: 'gpt-test',
			execute: async () => {
				executions++;
				markClaimed();
				await loginGate;
				return assistant('LOGIN_STEP_OK');
			},
			onStep: (step) => steps.push(step),
		});

		await claimed;
		expect(steps).toEqual(['workflow_started', 'login_agent_started']);

		let settled = false;
		void proof.finally(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		releaseLogin();
		await expect(proof).resolves.toMatchObject({
			status: 'completed',
			loginText: 'LOGIN_STEP_OK',
			steps: [
				'workflow_started',
				'login_agent_started',
				'login_agent_completed',
				'workflow_completed',
			],
		});
		expect(executions).toBe(1);
		expect(steps).toEqual([
			'workflow_started',
			'login_agent_started',
			'login_agent_completed',
			'workflow_completed',
		]);
	});
});

function assistant(text: string): AssistantMessage {
	return {
		role: 'assistant',
		content: [{ type: 'text', text }],
		api: 'openai-codex-responses',
		provider: 'openai-codex',
		model: 'gpt-test',
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}
