import { type AgentProfile, defineAgentProfile } from '@flue/runtime';
import type { LoginHarness } from './protocol.ts';

export type LoginBoundProfile = Omit<AgentProfile, 'model' | 'subagents'> & {
	harness: LoginHarness;
	/** Harness-native model id, such as `gpt-5.4` or `sonnet`. */
	model: string;
	subagents?: LoginBoundProfile[];
};

/**
 * Define a profile whose root, delegated profiles, and explicit compaction
 * model can only resolve through a login-backed provider.
 */
export function defineLoginBoundProfile(profile: LoginBoundProfile): AgentProfile {
	return defineAgentProfile(toAgentProfile(profile, profile.harness));
}

function toAgentProfile(profile: LoginBoundProfile, rootHarness: LoginHarness): AgentProfile {
	if (profile.harness !== rootHarness) {
		throw new TypeError('A login-bound profile tree must use one harness.');
	}
	const { harness, model, subagents, compaction, ...rest } = profile;
	const provider = `${harness}-login`;
	if (model.trim().length === 0)
		throw new TypeError('Login-bound profile model must not be empty.');
	if (
		compaction &&
		compaction.model !== undefined &&
		!compaction.model.startsWith(`${provider}/`)
	) {
		throw new TypeError(`Compaction model must use the "${provider}" provider.`);
	}
	return {
		...rest,
		model: `${provider}/${model}`,
		...(compaction ? { compaction } : {}),
		...(subagents
			? { subagents: subagents.map((subagent) => toAgentProfile(subagent, rootHarness)) }
			: {}),
	};
}
