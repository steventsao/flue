import { type AgentProfile, defineAgentProfile } from '@flue/runtime';

export type CodexLoginProfile = Omit<AgentProfile, 'model' | 'subagents'> & {
	/** OpenAI Codex model id, such as `gpt-5.4` or `gpt-5.4-mini`. */
	model: string;
	subagents?: CodexLoginProfile[];
};

/** Pin a root profile, its subagents, and compaction to the Codex login worker. */
export function defineCodexLoginProfile(profile: CodexLoginProfile): AgentProfile {
	return defineAgentProfile(toAgentProfile(profile));
}

function toAgentProfile(profile: CodexLoginProfile): AgentProfile {
	const { model, subagents, compaction, ...rest } = profile;
	if (model.trim().length === 0)
		throw new TypeError('Codex login profile model must not be empty.');
	if (
		compaction &&
		compaction.model !== undefined &&
		!compaction.model.startsWith('codex-login/')
	) {
		throw new TypeError('Compaction model must use the "codex-login" provider.');
	}
	return {
		...rest,
		model: `codex-login/${model}`,
		...(compaction ? { compaction } : {}),
		...(subagents ? { subagents: subagents.map(toAgentProfile) } : {}),
	};
}
