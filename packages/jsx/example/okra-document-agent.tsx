/** @jsxImportSource @flue/jsx */
import { defineTool } from '@flue/runtime';
import { Agent, Tool, toDefinition } from '../src/index.ts';

// A verifier tool: re-crop a cited bbox so the council can refute an extraction.
const recropCitation = defineTool({
	name: 'recrop_citation',
	description: 'Re-crop the cited bbox region of the page for verification.',
	run: async () => ({ ok: true }),
});

// okraPDF's DocumentAgent council (partition · parse · extract · verify),
// authored as a JSX tree. Compiles to the same AgentDefinition a hand-written
// defineAgent() would — ready to default-export from agents/document.ts.
export default toDefinition(
	<Agent
		model="anthropic/claude-sonnet-4-6"
		instructions="Coordinate document parsing; escalate uncertainty to a human."
	>
		<Agent
			name="partition"
			model="google/gemini-flash"
			instructions="Tokenize each page into spatial regions."
		/>
		<Agent
			name="parse"
			model="google/gemini-flash"
			instructions="Transcribe literally — never fix typos."
		/>
		<Agent
			name="extract"
			model="anthropic/claude-sonnet-4-6"
			instructions="Null over guess. Cite every value with a bbox."
		/>
		<Agent
			name="verify"
			model="anthropic/claude-sonnet-4-6"
			instructions="Re-crop the cited bbox and refute the extraction."
		>
			<Tool def={recropCitation} />
		</Agent>
	</Agent>,
);
