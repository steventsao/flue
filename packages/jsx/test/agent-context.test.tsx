/** @jsxImportSource @flue/jsx */
import { describe, expect, it } from 'vitest';
import { defineAgent } from '@flue/runtime';
import type { AgentDefinition } from '@flue/runtime';
import { Agent, Subagent, createAgentContext, toDefinition } from '../src/index.ts';

async function config(def: AgentDefinition) {
	return def.initialize({ id: 'x', env: {} } as never);
}

// Council's proof test: downward propagation through nesting + the static
// missing-provider guarantee.
describe('createAgentContext — authoring-time DI fold', () => {
	it('propagates a provided value to a nested subagent', async () => {
		const Model = createAgentContext<string>();
		const def = toDefinition(
			<Model.Provider value="google/gemini-flash">
				{() => (
					<Agent model="anthropic/claude-sonnet-4-6" instructions="Coordinate.">
						<Subagent name="deep" model={Model.use()} instructions="Parse." />
					</Agent>
				)}
			</Model.Provider>,
		);
		const ref = defineAgent(() => ({
			model: 'anthropic/claude-sonnet-4-6',
			instructions: 'Coordinate.',
			subagents: [{ name: 'deep', model: 'google/gemini-flash', instructions: 'Parse.' }],
		}));
		expect(await config(def)).toEqual(await config(ref));
	});

	it('throws when use() has no enclosing Provider', () => {
		const Policy = createAgentContext<{ level: string }>();
		expect(() => Policy.use()).toThrow('no enclosing <Provider>');
	});

	it('falls back to a default value when one is given', () => {
		const Flag = createAgentContext<boolean>(false);
		expect(Flag.use()).toBe(false);
	});

	it('pops the value after the subtree is built (no leak across providers)', () => {
		const Model = createAgentContext<string>();
		toDefinition(<Model.Provider value="a">{() => <Agent model={Model.use()} />}</Model.Provider>);
		// Outside any provider the stack must be empty again.
		expect(() => Model.use()).toThrow('no enclosing <Provider>');
	});
});
