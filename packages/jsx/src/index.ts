import { defineAgent, defineAgentProfile } from '@flue/runtime';
import type {
	AgentDefinition,
	AgentProfile,
	AgentRuntimeConfig,
	Skill,
	ToolDefinition,
} from '@flue/runtime';

export { Fragment } from './jsx-runtime.ts';
export { type AgentContext, createAgentContext } from './context.ts';

// ─── Tagged builder nodes ─────────────────────────────────────────────────
// Builder components return a small wrapper so a parent can bucket each child
// by role. The wrapper is internal; toDefinition()/toProfile() unwrap it.

const KIND = Symbol('flue.jsx.kind');
type Kind = 'agent' | 'subagent' | 'tool' | 'action' | 'skill';

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
				case 'subagent':
				case 'agent':
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

// Drop undefined-valued props, then attach only the buckets that have entries —
// so the produced object matches a hand-written defineAgent()/defineAgentProfile()
// that omits empty arrays and unset fields.
function build(rest: Record<string, unknown>, buckets: Buckets): Record<string, unknown> {
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

type AgentProps = Omit<
	AgentRuntimeConfig,
	'skills' | 'tools' | 'actions' | 'subagents'
> & {
	children?: unknown;
};

/**
 * Root agent element. Compiles to the identical value `defineAgent(() => …)`
 * produces, so its default export is a drop-in Flue agent definition.
 */
export function Agent(props: AgentProps): AgentDefinition {
	const { children, ...rest } = props;
	const config = build(rest as Record<string, unknown>, collectChildren(children)) as AgentRuntimeConfig;
	return defineAgent(() => config);
}

type SubagentProps = Omit<AgentProfile, 'skills' | 'tools' | 'actions' | 'subagents'> & {
	children?: unknown;
};

/** A nested agent profile. Buckets into the parent's `subagents`. */
export function Subagent(props: SubagentProps): Tagged<AgentProfile> {
	const { children, ...rest } = props;
	const profile = build(rest as Record<string, unknown>, collectChildren(children)) as AgentProfile;
	return tag('subagent', profile);
}

/** A model-callable tool. Pass an existing `defineTool()` value via `def`. */
export function Tool(props: { def: ToolDefinition }): Tagged<ToolDefinition> {
	return tag('tool', props.def);
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
