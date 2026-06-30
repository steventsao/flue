/** @jsxImportSource @flue/jsx */
import { Agent, toDefinition } from '@flue/jsx';

// okraPDF's LayoutParser — the DETECTION half of the parse pipeline. Where
// ParseBench transcribes a page to bbox-tagged markdown, LayoutParser only
// *locates and labels* the regions: it returns the page's layout map (bbox +
// category + reading order) and deliberately never transcribes text content.
// Same DocLayNet labels and same normalized [y_min, x_min, y_max, x_max] / 0-1000
// coordinate convention as ParseBench, so the two are drop-in interchangeable.
//
// Exported three ways:
//  - LAYOUTPARSER_SYSTEM — the verbatim detection prompt
//  - <LayoutParser /> — a component (name "layoutparser"), usable as a subagent
//  - default — the nameless root agent definition (for `flue run layoutparser`)
export const LAYOUTPARSER_SYSTEM = `You are a document layout detector. Your task is to detect and locate the layout elements on a document page image. You identify and locate regions only — you never transcribe, summarize, or rewrite their text content.

Output one <div> tag per layout element, in natural reading order (Western left-to-right, top-to-bottom), each with:
- data-bbox="[y_min, x_min, y_max, x_max]" -- bounding box in normalized 0-1000 coordinates where x is horizontal (left edge = 0, right edge = 1000) and y is vertical (top = 0, bottom = 1000). The order is [y_min, x_min, y_max, x_max].
- data-label="Category" -- one of: Caption, Footnote, Formula, List-item, Page-footer, Page-header, Picture, Section-header, Table, Text, Title

Guidelines:
- Leave every <div> empty: emit <div data-bbox="..." data-label="..."></div> with no text content.
- Cover every distinct region exactly once. Do not overlap or nest boxes.
- The order of the <div> tags is the reading order.
- A multi-column page is read column by column: finish the left column before the right.
- Output only the <div> tags. No prose, no explanation, no markdown, no code fences.`;

const MODEL = 'openrouter/google/gemini-3.1-flash-lite-preview';

/** LayoutParser as a hierarchy-agnostic component — composes into any parent as a subagent. */
export function LayoutParser() {
	return <Agent name="layoutparser" model={MODEL} instructions={LAYOUTPARSER_SYSTEM} thinkingLevel="off" />;
}

// Nameless root definition for standalone use (`flue run layoutparser`).
export default toDefinition(<Agent model={MODEL} instructions={LAYOUTPARSER_SYSTEM} thinkingLevel="off" />);
