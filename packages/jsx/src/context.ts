/**
 * Authoring-time dependency injection for agent trees — a React-Context analog
 * that lowers entirely onto the eager evaluation pass. NO runtime, NO reconciler.
 *
 * The wrinkle: this runtime is EAGER (children evaluate before parents), so a
 * Provider cannot push a value "before" already-evaluated descendants. The fix
 * is **function-as-children**: the Provider's children are a thunk, so the
 * subtree is evaluated *inside* the Provider after it pushes the value:
 *
 *   <Model.Provider value="google/gemini-flash">
 *     {() => (
 *       <Agent model="anthropic/claude-sonnet-4-6">
 *         <Subagent name="parse" model={Model.use()} />
 *       </Agent>
 *     )}
 *   </Model.Provider>
 *
 * Because the whole subtree evaluates synchronously inside the thunk while the
 * value is on the stack, every descendant `use()` sees it — at any depth, with
 * a single thunk at the Provider boundary. This is the "fold over the authoring
 * tree" — one deterministic top-down pass, never re-evaluated on state change.
 */

export interface AgentContext<T> {
	/** Pushes `value` for the subtree built inside the children thunk. */
	Provider: (props: { value: T; children: () => unknown }) => unknown;
	/** Reads the nearest enclosing Provider's value. Throws if none and no default. */
	use: () => T;
	/** Identity of this context (for debugging / future auto-merge). */
	readonly id: symbol;
}

export function createAgentContext<T>(...args: [defaultValue?: T]): AgentContext<T> {
	const stack: T[] = [];
	const id = Symbol('flue.jsx.context');
	const hasDefault = args.length > 0;
	const defaultValue = args[0];

	function Provider(props: { value: T; children: () => unknown }): unknown {
		if (typeof props.children !== 'function') {
			throw new Error(
				'[flue-jsx] Context Provider children must be a function: ' +
					'<Ctx.Provider value={…}>{() => <Agent/>}</Ctx.Provider>. ' +
					'The thunk defers evaluation so the value flows down the subtree.',
			);
		}
		stack.push(props.value);
		try {
			return props.children();
		} finally {
			stack.pop();
		}
	}

	function use(): T {
		if (stack.length > 0) return stack[stack.length - 1] as T;
		if (hasDefault) return defaultValue as T;
		throw new Error(
			'[flue-jsx] useAgentContext(): no enclosing <Provider>. ' +
				'Wrap the consuming subtree in <Ctx.Provider value={…}>{() => …}</Ctx.Provider>.',
		);
	}

	return { Provider, use, id };
}
