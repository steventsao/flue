/** @jsxImportSource @flue/jsx */
import { describe, expect, it } from 'vitest';
import { defineAgentProfile, defineAgent, defineTool } from '@flue/runtime';
import type { AgentDefinition, ToolDefinition } from '@flue/runtime';
import { Agent, Engine, Subagent, Tool, component, toDefinition, toProfile } from '../src/index.ts';

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

	it('treats a NESTED <Agent> as a subagent — compose, no <Subagent> markup', async () => {
		const jsx = toDefinition(
			<Agent model={M} instructions="Coordinate.">
				<Agent name="parse" model="google/gemini-flash" instructions="Transcribe." />
				<Agent name="verify" model={M} instructions="Refute." />
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

	it('nests <Agent> recursively (subagent of a subagent)', async () => {
		const jsx = toDefinition(
			<Agent model={M}>
				<Agent name="outer" model={M}>
					<Agent name="inner" model="google/gemini-flash" />
				</Agent>
			</Agent>,
		);
		const ref = defineAgent(() => ({
			model: M,
			subagents: [{ name: 'outer', model: M, subagents: [{ name: 'inner', model: 'google/gemini-flash' }] }],
		}));
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

	it('authors a tool INLINE (<Tool name … run …/>) equal to defineTool', async () => {
		const run = async () => 'x';
		const jsx = toDefinition(
			<Agent model={M}>
				<Tool name="lookup" description="Look up a value." run={run} />
			</Agent>,
		);
		const ref = defineAgent(() => ({
			model: M,
			tools: [defineTool({ name: 'lookup', description: 'Look up a value.', run })],
		}));
		expect(await config(jsx)).toEqual(await config(ref));
	});

	it('authors a tool both ways — <Tool def> and inline <Tool {…}> — identically', async () => {
		const run = async () => 'x';
		const spec = { name: 'lookup', description: 'Look up a value.', run } as const;
		const wrapped = toDefinition(
			<Agent model={M}>
				<Tool def={defineTool(spec)} />
			</Agent>,
		);
		const inline = toDefinition(
			<Agent model={M}>
				<Tool name="lookup" description="Look up a value." run={run} />
			</Agent>,
		);
		expect(await config(inline)).toEqual(await config(wrapped));
	});

	it('inline <Tool> inherits defineTool validation (missing run)', () => {
		expect(() =>
			toDefinition(
				<Agent model={M}>
					<Tool name="broken" description="No run." />
				</Agent>,
			),
		).toThrow('run must be a function');
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

// The core idea: write agents and tools as standalone COMPONENTS that know
// nothing about their parents. The hierarchy (subagents/tools) is NOT declared in
// any defineAgent — it's derived at compile from how the components are composed.
function LookupTool() {
	return <Tool name="lookup" description="Look up a value." run={async () => 'x'} />;
}
function ResearchAgent() {
	return <Agent name="research" model="google/gemini-flash" instructions="Find sources." />;
}
// A component that wants to host children forwards them, exactly like React.
function WriterAgent(props: { children?: unknown }) {
	return (
		<Agent name="writer" model="anthropic/claude-haiku-4-5" instructions="Draft.">
			{props.children}
		</Agent>
	);
}

describe('components, hierarchy derived at compile', () => {
	it('composes plain function components; subagents/tools derived from the tree', async () => {
		const def = toDefinition(
			<Agent model={M} instructions="Coordinate.">
				<ResearchAgent />
				<WriterAgent />
				<LookupTool />
			</Agent>,
		);
		const cfg = await config(def);
		// Hierarchy derived — no defineAgent({subagents}) was ever hand-written.
		expect(cfg.subagents).toEqual([
			{ name: 'research', model: 'google/gemini-flash', instructions: 'Find sources.' },
			{ name: 'writer', model: 'anthropic/claude-haiku-4-5', instructions: 'Draft.' },
		]);
		expect(cfg.tools?.map((t) => t.name)).toEqual(['lookup']);
	});

	it('reorders to a different hierarchy with the SAME components (composition, not definition)', async () => {
		// WriterAgent now owns ResearchAgent as ITS subagent — same components, new tree.
		const def = toDefinition(
			<Agent model={M}>
				<WriterAgent>
					<ResearchAgent />
				</WriterAgent>
			</Agent>,
		);
		const cfg = await config(def);
		expect(cfg.subagents?.[0]?.name).toBe('writer');
		expect(cfg.subagents?.[0]?.subagents?.[0]?.name).toBe('research');
	});
});

// Reusability: a quality tool defined in its own file (here, a module const) is
// composed two equivalent ways — <Tool def={imported}/> and a component()-lifted
// <Lookup/>. Same symmetric lift as agents. Encourage this over inline authoring.
describe('reusable tools: define in a file, compose here', () => {
	const lookupTool = defineTool({ name: 'lookup', description: 'Look up a value.', run: async () => 'x' });

	it('lifts an imported tool with component() into <Lookup/>', async () => {
		const Lookup = component(lookupTool);
		const lifted = toDefinition(
			<Agent model={M}>
				<Lookup />
			</Agent>,
		);
		const wrapped = toDefinition(
			<Agent model={M}>
				<Tool def={lookupTool} />
			</Agent>,
		);
		expect(await config(lifted)).toEqual(await config(wrapped));
	});

	it('composes an imported tool as a modelSlot engine (run defined in a file)', async () => {
		// engine `run`s are ordinary functions — define them in files, compose here.
		const geminiParse = async () => 'G';
		const qwenParse = async () => 'Q';
		const def = toDefinition(
			<Agent model={M}>
				<Tool capability="parse">
					<Engine name="gemini-flash" default run={geminiParse} />
					<Engine name="qwen-vl" run={qwenParse} />
				</Tool>
			</Agent>,
		);
		// biome-ignore lint/suspicious/noExplicitAny: reach into the resolved tool
		const tool = (await config(def)).tools![0] as any;
		expect(await tool.run({ input: undefined, signal: new AbortController().signal })).toBe('G');
	});
});

// The okra unlock: a stable capability with swappable engines, authored in one
// element. Default resolved at authoring; runtime selection inside the run thunk.
describe('<Tool capability> modelSlot — the swap mechanic', () => {
	const signal = new AbortController().signal;

	async function slotTool(node: unknown) {
		const cfg = await config(toDefinition(node));
		// biome-ignore lint/suspicious/noExplicitAny: test reaches into the resolved tool
		return cfg.tools![0] as any;
	}

	it('dispatches to the default engine when none is selected', async () => {
		const tool = await slotTool(
			<Agent model={M}>
				<Tool capability="parse" io="page-image -> md+json">
					<Engine name="gemini-flash" default run={async () => 'G'} />
					<Engine name="qwen-vl" run={async () => 'Q'} />
				</Tool>
			</Agent>,
		);
		expect(tool.name).toBe('parse');
		expect(await tool.run({ input: undefined, signal })).toBe('G');
	});

	it('dispatches via the runtime select() thunk', async () => {
		const tool = await slotTool(
			<Agent model={M}>
				<Tool
					capability="parse"
					select={(input: { scanned?: boolean }) => (input.scanned ? 'qwen-vl' : 'gemini-flash')}
				>
					<Engine name="gemini-flash" default run={async () => 'G'} />
					<Engine name="qwen-vl" run={async () => 'Q'} />
				</Tool>
			</Agent>,
		);
		expect(await tool.run({ input: { scanned: true }, signal })).toBe('Q');
		expect(await tool.run({ input: { scanned: false }, signal })).toBe('G');
	});

	it('rejects a duplicate engine at mount time', () => {
		expect(() =>
			toDefinition(
				<Agent model={M}>
					<Tool capability="parse">
						<Engine name="x" run={async () => 1} />
						<Engine name="x" run={async () => 2} />
					</Tool>
				</Agent>,
			),
		).toThrow('duplicate engine');
	});

	it('rejects multiple defaults and an empty slot at mount time', () => {
		expect(() =>
			toDefinition(
				<Agent model={M}>
					<Tool capability="parse">
						<Engine name="a" default run={async () => 1} />
						<Engine name="b" default run={async () => 2} />
					</Tool>
				</Agent>,
			),
		).toThrow('multiple default');
		expect(() =>
			toDefinition(
				<Agent model={M}>
					<Tool capability="parse" />
				</Agent>,
			),
		).toThrow('at least one');
	});
});

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
