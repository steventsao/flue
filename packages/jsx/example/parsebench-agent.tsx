/** @jsxImportSource @flue/jsx */
import { Agent, Engine, Tool, toDefinition } from '../src/index.ts';

// okraPDF's ParseBench, authored in the component style. Each concern is a
// standalone component that knows nothing about its parent; the hierarchy
// (parse + eval under a coordinator) is derived from composition at the bottom.
//
// Real artifacts (verbatim from scripts/openrouter-parsebench-fanout.py):
//  - the parse system/user prompts
//  - the engine: google/gemini-3.1-flash-lite-preview (temperature 0, reasoning effort none)
//  - the scores: reading-order Kendall tau-b vs gold, plus bbox_count / content_chars.

// ── ParseBench prompts (verbatim) ─────────────────────────────────────────────
const PARSEBENCH_SYSTEM = `You are a document parser. Your task is to convert document images to clean, well-structured markdown.

Wrap each layout element in a <div> tag with:
- data-bbox="[y_min, x_min, y_max, x_max]" -- bounding box in normalized 0-1000 coordinates where x is horizontal (left edge = 0, right edge = 1000) and y is vertical (top = 0, bottom = 1000). The order is [y_min, x_min, y_max, x_max].
- data-label="Category" -- one of: Caption, Footnote, Formula, List-item, Page-footer, Page-header, Picture, Section-header, Table, Text, Title

Guidelines:
- Preserve document structure and reading order (Western left-to-right, top-to-bottom).
- Convert tables to HTML <table> with colspan/rowspan for merged cells.
- Convert charts to HTML <table> with flat combined column headers.
- Describe images in brackets, e.g. [bar chart of revenue].
- Preserve code blocks verbatim in fenced blocks.`;

const PARSEBENCH_USER =
	'Parse this document page and output its content as clean markdown, with each layout element wrapped in a <div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"> tag.';

// ── Engine impl: one factory per OpenRouter model (define in a file, compose here) ──
// The exact ParseBench request shape; POST to OpenRouter and return
// choices[0].message.content (the bbox-tagged markdown). Stubbed return here.
const parseWith = (model: string) => async (args: { input: unknown }): Promise<string> => {
	const { imageUrl } = args.input as { imageUrl: string };
	const request = {
		model,
		messages: [
			{ role: 'system', content: PARSEBENCH_SYSTEM },
			{
				role: 'user',
				content: [
					{ type: 'image_url', image_url: { url: imageUrl } },
					{ type: 'text', text: PARSEBENCH_USER },
				],
			},
		],
		temperature: 0,
		reasoning: { effort: 'none' },
	};
	void request; // → fetch('https://openrouter.ai/api/v1/chat/completions', …)
	return '<div data-bbox="[0,0,1000,1000]" data-label="Text">…</div>';
};

// ── Scoring (define in a file) ────────────────────────────────────────────────
function readingOrderTauB(predicted: string, gold: string): number {
	// Real impl: read <div> order from both, align elements, compute Kendall tau-b.
	void predicted;
	void gold;
	return 0.973; // okra's reading-order tau-b on the bench
}

// ── Components — each hierarchy-agnostic ──────────────────────────────────────

/** The `parse` capability as a modelSlot: one stable contract, swappable engine. */
function ParseEngine() {
	return (
		<Tool
			capability="parse"
			io="page-image -> bbox-tagged-markdown"
			select={(input: { scanned?: boolean }) =>
				input.scanned ? 'gemini-3-flash' : 'gemini-3.1-flash-lite'
			}
		>
			<Engine name="gemini-3.1-flash-lite" default run={parseWith('google/gemini-3.1-flash-lite-preview')} />
			<Engine name="gemini-3-flash" run={parseWith('google/gemini-3-flash')} />
			<Engine name="qwen-vl" run={parseWith('qwen/qwen3-vl-235b')} />
		</Tool>
	);
}

/** Reading-order score vs gold (parsebench's headline quality metric). */
function ReadingOrderScore() {
	return (
		<Tool
			name="score_reading_order"
			description="Kendall tau-b of predicted vs gold element reading order (higher is better)."
			run={async (args: { input: unknown }) => {
				const { predicted, gold } = args.input as { predicted: string; gold: string };
				return { tau_b: readingOrderTauB(predicted, gold) };
			}}
		/>
	);
}

/** Per-run telemetry parsebench records (bbox_count, content_chars). */
function TelemetryScore() {
	return (
		<Tool
			name="score_telemetry"
			description="ParseBench per-run telemetry: bbox_count and content_chars of a parse."
			run={async (args: { input: unknown }) => {
				const { markdown } = args.input as { markdown: string };
				return {
					bbox_count: (markdown.match(/data-bbox=/g) ?? []).length,
					content_chars: markdown.length,
				};
			}}
		/>
	);
}

/** The parser: ParseBench system prompt as instructions, the parse slot as its tool. */
function ParseAgent() {
	return (
		<Agent name="parse" model="google/gemini-3.1-flash-lite-preview" instructions={PARSEBENCH_SYSTEM}>
			<ParseEngine />
		</Agent>
	);
}

/** The judge: scores a parse against gold, flags regressions vs the prior run. */
function EvalAgent() {
	return (
		<Agent
			name="eval"
			model="anthropic/claude-haiku-4-5"
			instructions="Score each parse against the gold page: reading-order tau-b plus telemetry. Flag regressions vs the previous run."
		>
			<ReadingOrderScore />
			<TelemetryScore />
		</Agent>
	);
}

// ── Composition site: the ONLY place the hierarchy exists ─────────────────────
export default toDefinition(
	<Agent
		model="anthropic/claude-sonnet-4-6"
		instructions="Run ParseBench: for each page, parse it, score the parse against gold, and report the fidelity × cost frontier across engines."
	>
		<ParseAgent />
		<EvalAgent />
	</Agent>,
);
