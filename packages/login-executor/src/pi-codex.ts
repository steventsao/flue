import { type CredentialStore, createModels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { JsonCredentialStore } from './credentials.ts';
import type { LoginExecutorJob } from './protocol.ts';

export function createPiCodexExecutor(
	options: {
		authFile?: string;
		credentials?: CredentialStore;
	} = {},
) {
	const models = createModels({
		credentials: options.credentials ?? new JsonCredentialStore(options.authFile),
	});
	models.setProvider(openaiCodexProvider());
	return async (job: LoginExecutorJob, signal?: AbortSignal) => {
		const model = models.getModel('openai-codex', job.model);
		if (!model) throw new TypeError(`Unknown OpenAI Codex model: ${job.model}`);
		const auth = await models.getAuth(model);
		if (!auth) {
			throw new Error('OpenAI Codex OAuth is not configured in the Pi credential file.');
		}
		return models.completeSimple(model, job.context, { ...job.options, signal });
	};
}
