import { AsyncLocalStorage } from 'node:async_hooks';
import { instrument } from '@flue/runtime';

interface AgentExecutionScope {
	toolTail: Promise<void>;
}

let installed = false;
let agentTail = Promise.resolve();
const executionScope = new AsyncLocalStorage<AgentExecutionScope>();

/**
 * Serialize agent operations process-wide for applications whose agents are
 * fulfilled by a login executor. An outer agent operation holds the slot
 * across all of its model turns, nested agents, and Flue tool execution.
 */
export function installGlobalAgentSerialization(): void {
	if (installed) return;
	instrument({
		key: Symbol.for('@flue/login-executor/global-serialization'),
		observe() {},
		async interceptor(operation, _context, next) {
			const scope = executionScope.getStore();
			if (scope) {
				if (operation.type === 'tool') return runToolInOrder(scope, next);
				return next();
			}
			if (operation.type !== 'agent') return next();
			return runAgentInOrder(() =>
				executionScope.run(
					{
						toolTail: Promise.resolve(),
					},
					next,
				),
			);
		},
		dispose() {},
	});
	installed = true;
}

async function runAgentInOrder<T>(run: () => Promise<T>): Promise<T> {
	let release!: () => void;
	const previous = agentTail;
	agentTail = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await run();
	} finally {
		release();
	}
}

async function runToolInOrder<T>(scope: AgentExecutionScope, run: () => Promise<T>): Promise<T> {
	let release!: () => void;
	const previous = scope.toolTail;
	scope.toolTail = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await run();
	} finally {
		release();
	}
}
