/** @jsxImportSource @flue/jsx */
import { Agent, toDefinition } from '@flue/jsx';

// okraPDF's ParseBench parser, authored with @flue/jsx — the verbatim parse system
// prompt as instructions, on gemini-3.1-flash-lite via the OpenRouter provider
// (see src/app.ts), reasoning effort none → thinkingLevel "off".
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

export default toDefinition(
	<Agent
		model="openrouter/google/gemini-3.1-flash-lite-preview"
		instructions={PARSEBENCH_SYSTEM}
		thinkingLevel="off"
	/>,
);
