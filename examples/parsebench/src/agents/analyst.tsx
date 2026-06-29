/** @jsxImportSource @flue/jsx */
import { Agent, toDefinition } from '@flue/jsx';
import { ParseBench } from './parsebench.tsx';

// A parent agent that composes ParseBench as a SUBAGENT. The harness exposes the
// `parsebench` subagent to this agent's model as a delegation tool — so the parent
// "knows it can use this agent as a tool" and delegates raw page parsing to it,
// then reasons over the bbox-tagged markdown it gets back.
export default toDefinition(
	<Agent
		model="openrouter/google/gemini-3.1-flash-lite-preview"
		instructions={
			'You are a document analyst. You have a `parsebench` subagent that converts a ' +
			'page image into bbox-tagged markdown. Delegate the raw parsing to it, then ' +
			"answer the user's question using the parsed result."
		}
	>
		<ParseBench />
	</Agent>,
);
