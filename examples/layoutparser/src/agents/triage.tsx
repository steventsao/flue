/** @jsxImportSource @flue/jsx */
import { Agent, toDefinition } from '@flue/jsx';
import { LayoutParser } from './layoutparser.tsx';

// A parent agent that composes LayoutParser as a SUBAGENT. The harness exposes the
// `layoutparser` subagent to this agent's model as a delegation tool — so the parent
// "knows it can use this agent as a tool" and delegates region detection to it,
// then reasons over the structural layout map it gets back (e.g. "does this page
// have a table?", "how many columns?", "where is the title?") without ever needing
// the transcribed text.
export default toDefinition(
	<Agent
		model="openrouter/google/gemini-3.1-flash-lite-preview"
		instructions={
			'You are a document triage agent. You have a `layoutparser` subagent that ' +
			'returns a page image\'s layout map as JSON regions (label, bbox, reading order). ' +
			'Delegate region detection to it, then answer the question about the page ' +
			'structure using only the returned layout map.'
		}
	>
		<LayoutParser />
	</Agent>,
);
