/**
 * Node-specific entry point for `@flue/runtime`. Exports the `local()`
 * sandbox factory for use in `defineAgent(() => ({ sandbox: local(...) }))`,
 * and the built-in `sqlite()` persistence adapter.
 *
 * Import platform-agnostic types (`FlueEventContext`, `PersistenceAdapter`, etc.)
 * from `@flue/runtime`.
 */
export { sqlite } from './agent-execution-store.ts';
export { type LocalSandboxOptions, local } from './local.ts';
export {
	getLocalHarnessApiProvider,
	LOCAL_HARNESS_API,
	type LocalHarnessKind,
	type LocalHarnessProviderOptions,
	registerLocalHarnessProvider,
} from './local-harness-provider.ts';
