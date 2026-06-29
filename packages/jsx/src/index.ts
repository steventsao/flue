import { defineAgent, defineAgentProfile, defineTool } from '@flue/runtime';
import type {
	AgentDefinition,
	AgentProfile,
	AgentRuntimeConfig,
	Skill,
	ToolDefinition,
	ToolInputSchema,
	ToolOutputSchema,
} from '@flue/runtime';

export { Fragment } from './jsx-runtime.ts';

// ─── Tagged builder nodes ─────────────────────────────────────────────────
// Builder components return a small wrapper so a parent can bucket each child
// by role. The wrapper is internal; toDefinition()/toProfile() unwrap it.

const KIND = Symbol('flue.jsx.kind');
// 'agentNode' = an <Agent> whose role (root definition vs nested subagent) is
// decided by POSITION, not by markup. 'subagent' = the explicit (deprecated)
// alias. 'agent' = a lifted real AgentDefinition (root-only). 'engine' = a
// swappable engine inside a <Tool capability> modelSlot.
type Kind = 'agent' | 'agentNode' | 'subagent' | 'tool' | 'action' | 'skill' | 'engine';

interface Tagged<T = unknown> {
	readonly [KIND]: Kind;
	readonly value: T;
}

function tag<T>(kind: Kind, value: T): Tagged<T> {
	return { [KIND]: kind, value };
}

function isTagged(value: unknown): value is Tagged {
	return typeof value === 'object' && value !== null && KIND in value;
}

function isAgentDefinition(value: unknown): value is AgentDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { __flueAgentDefinition?: unknown }).__flueAgentDefinition === true
	);
}

// ─── Child collection ─────────────────────────────────────────────────────

interface Buckets {
	subagents: AgentProfile[];
	tools: ToolDefinition[];
	actions: unknown[];
	skills: Skill[];
}

function flatten(children: unknown): unknown[] {
	if (Array.isArray(children)) return children.flatMap(flatten);
	return [children];
}

function collectChildren(children: unknown): Buckets {
	const buckets: Buckets = { subagents: [], tools: [], actions: [], skills: [] };
	for (const child of flatten(children)) {
		// Drop the falsy leaves JSX conditionals produce: {cond && <X/>}, null, undefined.
		if (child == null || child === false || child === true || child === '') continue;
		if (isTagged(child)) {
			switch (child[KIND]) {
				// A nested <Agent> (agentNode) IS a subagent — compose, don't mark up.
				case 'agentNode':
				case 'subagent':
					buckets.subagents.push(child.value as AgentProfile);
					break;
				case 'tool':
					buckets.tools.push(child.value as ToolDefinition);
					break;
				case 'action':
					buckets.actions.push(child.value);
					break;
				case 'skill':
					buckets.skills.push(child.value as Skill);
					break;
				case 'agent':
					throw new Error(
						'[flue-jsx] Cannot nest a lifted agent definition as a subagent. ' +
							'Lift a profile (defineAgentProfile) instead, or author a nested <Agent name=…>.',
					);
				case 'engine':
					throw new Error(
						'[flue-jsx] <Engine> must be a child of <Tool capability="…">, not an agent.',
					);
			}
			continue;
		}
		throw new Error(
			'[flue-jsx] Unexpected child. Agent/Subagent children must be ' +
				'<Subagent>/<Tool>/<Action>/<Skill> or a lifted component().',
		);
	}
	return buckets;
}

// Surface a duplicate `name` at the composition site (mount/compile) rather than
// deferring to Flue's async harness validation — the one coupling that survives
// hierarchy-is-derived. Two composed components colliding on a name fail here.
function assertUniqueNames(items: Array<{ name?: string }>, kind: string): void {
	const seen = new Set<string>();
	for (const item of items) {
		const name = item?.name;
		if (!name) continue;
		if (seen.has(name)) {
			throw new Error(`[flue-jsx] duplicate ${kind} name "${name}" in <Agent>.`);
		}
		seen.add(name);
	}
}

// Drop undefined-valued props, then attach only the buckets that have entries —
// so the produced object matches a hand-written defineAgent()/defineAgentProfile()
// that omits empty arrays and unset fields.
function build(rest: Record<string, unknown>, buckets: Buckets): Record<string, unknown> {
	assertUniqueNames(buckets.subagents, 'subagent');
	assertUniqueNames(buckets.tools, 'tool');
	assertUniqueNames(buckets.actions as Array<{ name?: string }>, 'action');
	assertUniqueNames(buckets.skills, 'skill');
	const out: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(rest)) {
		if (v !== undefined) out[key] = v;
	}
	if (buckets.subagents.length) out.subagents = buckets.subagents;
	if (buckets.tools.length) out.tools = buckets.tools;
	if (buckets.actions.length) out.actions = buckets.actions;
	if (buckets.skills.length) out.skills = buckets.skills;
	return out;
}

// ─── Builder components ───────────────────────────────────────────────────

type AgentProps = Omit<AgentRuntimeConfig, 'skills' | 'tools' | 'actions' | 'subagents'> & {
	/**
	 * Required when nested (becomes the subagent's name). Rejected at the root —
	 * a root agent definition has no name, so Flue throws the same
	 * "unknown runtime config field name" it would for a hand-written config.
	 */
	name?: string;
	children?: unknown;
};

/**
 * An agent element. Its ROLE is decided by position, not markup:
 * - at the root (`toDefinition(<Agent/>)`) it becomes an `AgentDefinition`;
 * - nested inside another `<Agent>` it becomes a subagent profile.
 * One primitive, composed by nesting — no `<Subagent>` needed.
 */
export function Agent(props: AgentProps): Tagged<AgentRuntimeConfig> {
	const { children, ...rest } = props;
	const config = build(rest as Record<string, unknown>, collectChildren(children)) as AgentRuntimeConfig;
	return tag('agentNode', config);
}

type SubagentProps = Omit<AgentProfile, 'skills' | 'tools' | 'actions' | 'subagents'> & {
	children?: unknown;
};

/**
 * @deprecated Explicit alias — just nest an `<Agent name=…>` instead; a nested
 * `<Agent>` already buckets into the parent's `subagents`. Kept for clarity.
 */
export function Subagent(props: SubagentProps): Tagged<AgentProfile> {
	const { children, ...rest } = props;
	const profile = build(rest as Record<string, unknown>, collectChildren(children)) as AgentProfile;
	return tag('subagent', profile);
}

type ToolRun = (args: { input: never; signal: AbortSignal }) => unknown | Promise<unknown>;

type ToolProps = {
	/** Wrap an existing `defineTool()` value. */
	def?: ToolDefinition;
	/** …or author inline (compiles to `defineTool`, validation inherited). */
	name?: string;
	description?: string;
	input?: ToolInputSchema;
	output?: ToolOutputSchema;
	run?: ToolRun;
	/**
	 * …or a **modelSlot**: a stable `capability` whose engine is swappable.
	 * Provide `<Engine>` children; one `default`, plus an optional runtime
	 * `select`. Compiles to a single `defineTool` that dispatches over the
	 * engines — the swap mechanic, authorable in one element.
	 */
	capability?: string;
	/** Human-readable IO contract label, e.g. "page-image -> md+json" (metadata). */
	io?: string;
	/** Runtime engine selector — called INSIDE the run thunk, once per call. */
	select?: (input: never) => string | undefined;
	children?: unknown;
};

/**
 * A model-callable tool. Three forms:
 * - wrap an existing tool: `<Tool def={…} />`
 * - author inline: `<Tool name="…" description="…" run={…} />`
 * - **modelSlot**: `<Tool capability="parse"><Engine name="gemini-flash" default run={…}/>…</Tool>`
 * All compile to `defineTool`, so validation is inherited.
 */
export function Tool(props: ToolProps): Tagged<ToolDefinition> {
	if (props.def) return tag('tool', props.def);
	if (props.capability) return tag('tool', buildModelSlot(props));
	const { def, capability, io, select, children, ...spec } = props;
	return tag('tool', defineTool(spec as Parameters<typeof defineTool>[0]));
}

interface EngineSpec {
	name: string;
	default?: boolean;
	run: ToolRun;
}

/** One swappable engine behind a `<Tool capability>` slot. */
export function Engine(props: EngineSpec): Tagged<EngineSpec> {
	return tag('engine', props);
}

function collectEngines(children: unknown): EngineSpec[] {
	const engines: EngineSpec[] = [];
	for (const child of flatten(children)) {
		if (child == null || child === false || child === true || child === '') continue;
		if (isTagged(child) && child[KIND] === 'engine') {
			engines.push(child.value as EngineSpec);
			continue;
		}
		throw new Error('[flue-jsx] <Tool capability> children must be <Engine name=… run=… />.');
	}
	return engines;
}

// modelSlot → ONE defineTool. The default is resolved at authoring time; the
// optional `select` runs INSIDE the single run thunk (never a re-evaluated
// declaration → no reconciler). The shared `output` schema enforces the IO
// contract uniformly across whichever engine answered.
function buildModelSlot(props: ToolProps): ToolDefinition {
	const engines = collectEngines(props.children);
	if (engines.length === 0) {
		throw new Error('[flue-jsx] <Tool capability> needs at least one <Engine>.');
	}
	const seen = new Set<string>();
	for (const e of engines) {
		if (!e.name) throw new Error('[flue-jsx] <Engine> requires a name.');
		if (seen.has(e.name)) {
			throw new Error(
				`[flue-jsx] <Tool capability="${props.capability}"> has a duplicate engine "${e.name}".`,
			);
		}
		seen.add(e.name);
	}
	const defaults = engines.filter((e) => e.default);
	if (defaults.length > 1) {
		throw new Error(
			`[flue-jsx] <Tool capability="${props.capability}"> has multiple default engines.`,
		);
	}
	// engines.length > 0 was asserted above, so this is non-null.
	const defaultEngine = (defaults[0] ?? engines[0])!.name;
	const map = new Map(engines.map((e) => [e.name, e] as const));
	const select = props.select;
	return defineTool({
		name: props.capability as string,
		description:
			props.description ?? `${props.capability} — engines: ${engines.map((e) => e.name).join(', ')}`,
		input: props.input,
		output: props.output,
		run: ((args: { input: never; signal: AbortSignal }) => {
			const name = select?.(args.input) ?? defaultEngine;
			const engine = map.get(name);
			if (!engine) {
				throw new Error(
					`[flue-jsx] <Tool capability="${props.capability}"> selected unknown engine "${name}".`,
				);
			}
			return engine.run(args);
		}) as Parameters<typeof defineTool>[0]['run'],
	});
}

/** An Action. Pass an existing `defineAction()` value via `def`. */
export function Action(props: { def: unknown }): Tagged {
	return tag('action', props.def);
}

/** A skill. Pass a `defineSkill()` value via `def`, or inline name/description. */
export function Skill(props: { def?: Skill; name?: string; description?: string }): Tagged<Skill> {
	const value = props.def ?? ({ name: props.name, description: props.description } as Skill);
	return tag('skill', value);
}

// ─── component(): lift an existing Flue value into a JSX component ──────────

type Liftable = AgentDefinition | AgentProfile | ToolDefinition | Skill | { __flueAction: true };

function detectKind(value: unknown): Kind {
	const v = value as Record<string, unknown>;
	if (isAgentDefinition(value)) return 'agent';
	if (v && v.__flueAction === true) return 'action';
	if (v && typeof v.run === 'function' && typeof v.name === 'string') return 'tool';
	if (
		v &&
		typeof v.name === 'string' &&
		typeof v.description === 'string' &&
		!('model' in v) &&
		!('instructions' in v) &&
		!('subagents' in v)
	) {
		return 'skill';
	}
	return 'subagent';
}

/**
 * Lift an existing Flue value — `defineAgent(...)`, a profile, a tool, an
 * action, or a skill — into a JSX component usable as `<MyAgent />`.
 * The inverse of authoring with `<Agent>`: Flue value → component.
 */
export function component(value: Liftable, kindHint?: Kind): (props?: Record<string, unknown>) => unknown {
	const kind = kindHint ?? detectKind(value);
	return function FlueComponent(): unknown {
		// A lifted full agent definition stays itself at the root (identity);
		// everything else is a tagged child for its parent to bucket.
		if (kind === 'agent') return value;
		return tag(kind, value);
	};
}

// ─── Normalizers ──────────────────────────────────────────────────────────

/** Normalize a root JSX result into a Flue `AgentDefinition`. */
export function toDefinition(node: unknown): AgentDefinition {
	if (isAgentDefinition(node)) return node;
	if (isTagged(node)) {
		const t: Tagged = node;
		if (t[KIND] === 'agent') return t.value as AgentDefinition;
		if (t[KIND] === 'agentNode') {
			const config = t.value as AgentRuntimeConfig;
			return defineAgent(() => config);
		}
		if (t[KIND] === 'subagent') {
			const profile = t.value as AgentProfile;
			return defineAgent(() => ({ profile }));
		}
	}
	throw new Error('[flue-jsx] toDefinition() expects an <Agent> or a lifted agent component.');
}

/**
 * Normalize a JSX result into a validated Flue `AgentProfile`. Runs the exact
 * `defineAgentProfile()` validation, so authoring errors are identical.
 */
export function toProfile(node: unknown): AgentProfile {
	const profile = isTagged(node) ? (node.value as AgentProfile) : (node as AgentProfile);
	if (!profile || typeof profile !== 'object') {
		throw new Error('[flue-jsx] toProfile() expects a <Subagent> or a lifted profile component.');
	}
	return defineAgentProfile(profile);
}
