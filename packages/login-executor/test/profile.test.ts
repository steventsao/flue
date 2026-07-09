import { describe, expect, it } from 'vitest';
import { defineLoginBoundProfile } from '../src/profile.ts';

describe('defineLoginBoundProfile()', () => {
	it('pins a profile tree to one login provider when subagents are declared', () => {
		const profile = defineLoginBoundProfile({
			name: 'parent',
			harness: 'codex',
			model: 'gpt-test',
			subagents: [
				{
					name: 'reviewer',
					harness: 'codex',
					model: 'gpt-review',
				},
			],
		});

		expect(profile.model).toBe('codex-login/gpt-test');
		expect(profile.subagents?.[0]?.model).toBe('codex-login/gpt-review');
	});

	it('rejects a direct-provider compaction model when the profile is login-bound', () => {
		expect(() =>
			defineLoginBoundProfile({
				harness: 'claude',
				model: 'sonnet',
				compaction: { model: 'anthropic/claude-sonnet-4-6' },
			}),
		).toThrow('Compaction model must use the "claude-login" provider.');
	});
});
