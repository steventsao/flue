/**
 * Flue JSX automatic runtime.
 *
 * Unlike React, there is no reconciler and no element tree: `jsx()` EAGERLY
 * invokes the builder component and returns its value. Because JSX evaluates
 * children before parents (they are ordinary call arguments), a tree like
 *
 *   <Agent model="…"><Subagent name="parse" /></Agent>
 *
 * evaluates bottom-up straight into the exact value `defineAgent(() => …)`
 * would produce. JSX is pure constructor sugar over Flue's authoring API.
 */

type Component = (props: Record<string, unknown>) => unknown;

export function jsx(type: unknown, props: Record<string, unknown>): unknown {
	if (typeof type === 'function') {
		return (type as Component)(props ?? {});
	}
	throw new Error(
		`[flue-jsx] Unsupported JSX element. Use <Agent>/<Subagent>/<Tool>/<Action>/<Skill> ` +
			`or a component() from @flue/jsx. Received: ${String(type)}`,
	);
}

// Multiple children vs single child differ only in how the compiler packs
// `props.children`; both lower to the same eager call.
export const jsxs = jsx;

export function Fragment(props: { children?: unknown }): unknown {
	return props?.children;
}

// Minimal JSX typing surface. No intrinsic (lowercase) elements: only builder
// components and lifted component() functions are valid element types.
export namespace JSX {
	export type Element = unknown;
	export interface IntrinsicElements {
		[elemName: string]: never;
	}
	export interface ElementChildrenAttribute {
		children: Record<string, never>;
	}
}
