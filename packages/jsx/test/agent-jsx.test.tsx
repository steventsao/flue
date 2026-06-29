/** @jsxImportSource @flue/jsx */
import { describe, expect, it } from 'vitest';
import { defineAgentProfile, defineAgent, defineTool } from '@flue/runtime';
import type { AgentDefinition, ToolDefinition } from '@flue/runtime';
import { Agent, Subagent, Tool, component, toDefinition, toProfile } from '../src/index.ts';

const M = 'anthropic/claude-haiku-4-5';

// Two agent definitions are equivalent iff their initializers resolve to the
// same runtime config. The initializers here ignore context.
async function config(def: AgentDefinition) {
	return def.initialize({ id: 'x', env: {} } as never);
}

function createTool(name: string): ToolDefinition {
	return defineTool({ name, description: `Run ${name}.`, run: async () => name });
}

// ── source .tsx → assert the produced value equals the defineAgent() value ──

describe('<Agent> ≡ defineAgent()', () => {
	it('compiles a leaf agent to the same runtime config', async () => {
		const jsx = toDefinition(<Agent model={M} instructions="Coordinate." />);
		const ref = defineAgent(() => ({ model: M, instructions: 'Coordinate.' }));
		expect(await config(jsx)).toEqual(await config(ref));
	});

	it('compiles <Subagent> children to the same subagents array', async () => {
		const jsx = toDefinition(
			<Agent model={M} instructions="Coordinate.">
				<Subagent name="parse" model="google/gemini-flash" instructions="Transcribe." />
				<Subagent name="verify" model={M} instructions="Refute." />
			</Agent>,
		);
		const ref = defineAgent(() => ({
			model: M,
			instructions: 'Coordinate.',
			subagents: [
				{ name: 'parse', model: 'google/gemini-flash', instructions: 'Transcribe.' },
				{ name: 'verify', model: M, instructions: 'Refute.' },
			],
		}));
		expect(await config(jsx)).toEqual(await config(ref));
	});

	it('compiles <Tool def> children to the same tools array', async () => {
		const t = createTool('lookup');
		const jsx = toDefinition(
			<Agent model={M}>
				<Tool def={t} />
			</Agent>,
		);
		const ref = defineAgent(() => ({ model: M, tools: [t] }));
		expect(await config(jsx)).toEqual(await config(ref));
	});

	it('drops falsy conditional children like {cond && <Subagent/>}', async () => {
		const enabled = false;
		const jsx = toDefinition(
			<Agent model={M}>
				<Subagent name="parse" model={M} />
				{enabled && <Subagent name="verify" model={M} />}
			</Agent>,
		);
		const ref = defineAgent(() => ({ model: M, subagents: [{ name: 'parse', model: M }] }));
		expect(await config(jsx)).toEqual(await config(ref));
	});
});

// ── vice versa: lift an existing Flue value into <MyAgent/> ──

describe('component(): Flue value → <MyAgent/>', () => {
	it('round-trips a defineAgent() definition to itself', () => {
		const agent = defineAgent(() => ({ model: M }));
		const MyAgent = component(agent);
		expect(toDefinition(<MyAgent />)).toBe(agent);
	});

	it('lifts an existing profile and buckets it as a subagent', async () => {
		const parse = defineAgentProfile({ name: 'parse', model: 'google/gemini-flash' });
		const Parse = component(parse);
		const jsx = toDefinition(
			<Agent model={M}>
				<Parse />
			</Agent>,
		);
		const ref = defineAgent(() => ({ model: M, subagents: [parse] }));
		expect(await config(jsx)).toEqual(await config(ref));
	});
});

// ── inherits Flue's own validation: identical errors ──

describe('inherits defineAgentProfile() validation', () => {
	it('rejects unknown profile fields', () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately inject an unknown field
		const extra: any = { unsupported: true };
		expect(() => toProfile(<Subagent name="x" {...extra} />)).toThrow(
			'unknown agent profile field "unsupported"',
		);
	});

	it('rejects a subagent whose name does not start with a letter', () => {
		expect(() => toProfile(<Subagent name="1invalid" model={M} />)).toThrow(
			'must start with a letter',
		);
	});

	it('rejects duplicate subagent names', () => {
		expect(() =>
			toProfile(
				<Subagent name="root">
					<Subagent name="delegate" model={M} />
					<Subagent name="delegate" model={M} />
				</Subagent>,
			),
		).toThrow('duplicate subagent name');
	});

	it('rejects duplicate tool names', () => {
		expect(() =>
			toProfile(
				<Subagent name="root">
					<Tool def={createTool('lookup')} />
					<Tool def={createTool('lookup')} />
				</Subagent>,
			),
		).toThrow('duplicate tool name');
	});
});
