import { describe, expect, it } from 'vitest';
import { defineCodexLoginProfile } from '../src/profile.ts';

describe('defineCodexLoginProfile()', () => {
	it('pins a profile tree to the Codex login provider when subagents are declared', () => {
		const profile = defineCodexLoginProfile({
			name: 'parent',
			model: 'gpt-5.4',
			subagents: [{ name: 'reviewer', model: 'gpt-5.4-mini' }],
		});

		expect(profile.model).toBe('codex-login/gpt-5.4');
		expect(profile.subagents?.[0]?.model).toBe('codex-login/gpt-5.4-mini');
	});

	it('rejects a direct-provider compaction model when the profile is login-bound', () => {
		expect(() =>
			defineCodexLoginProfile({
				model: 'gpt-5.4',
				compaction: { model: 'openai-codex/gpt-5.4' },
			}),
		).toThrow('Compaction model must use the "codex-login" provider.');
	});
});
