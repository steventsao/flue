/** @jsxImportSource @flue/jsx */
import { toProfile } from '@flue/jsx';
import type { AgentDefinition } from '@flue/runtime';
import { describe, expect, it } from 'vitest';
import analyst from '../src/agents/analyst.tsx';
import { ParseBench } from '../src/agents/parsebench.tsx';

async function config(def: AgentDefinition) {
	return def.initialize({ id: 't', env: {} } as never);
}

// Captures the composition contract that makes delegation possible (deterministic,
// no live model): ParseBench is usable as a component → a named subagent, and the
// parent exposes it in `subagents` — which is exactly the delegation surface Flue
// turns into a tool the parent's model can call.
describe('ParseBench: component → subagent → parent delegation surface', () => {
	it('<ParseBench/> is usable as a component and resolves to a named subagent profile', () => {
		const profile = toProfile(<ParseBench />);
		expect(profile.name).toBe('parsebench');
		expect(profile.model).toContain('gemini-3.1-flash-lite');
		expect(profile.instructions).toContain('document parser');
	});

	it('the parent (analyst) exposes parsebench as a delegatable subagent', async () => {
		const cfg = await config(analyst);
		const names = cfg.subagents?.map((s) => s.name) ?? [];
		// A named subagent in the parent's config is what Flue exposes to the
		// parent's model as a `task`/delegation tool.
		expect(names).toContain('parsebench');
	});
});
