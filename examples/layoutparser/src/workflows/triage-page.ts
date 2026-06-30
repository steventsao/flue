import { readFileSync } from 'node:fs';
import { defineWorkflow, type WorkflowRouteHandler } from '@flue/runtime';
import triage from '../agents/triage.tsx';

export const route: WorkflowRouteHandler = async (_c, next) => next();

const DETECT_TASK =
	'Detect the layout of this document page. Output one empty ' +
	'<div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"></div> per region ' +
	'in reading order — do not transcribe any text.';

// The PARENT (triage) delegates the detection to its `layoutparser` subagent —
// invoking it as a tool, with the page image forwarded through session.task().
export default defineWorkflow({
	agent: triage,
	async run({ harness }) {
		const path = process.env.LAYOUTPARSER_IMAGE ?? process.env.PARSEBENCH_IMAGE;
		if (!path) throw new Error('Set LAYOUTPARSER_IMAGE to a page image path.');
		const data = readFileSync(path).toString('base64');
		const mimeType = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';

		const session = await harness.session();
		const delegated = await session.task(DETECT_TASK, {
			agent: 'layoutparser',
			images: [{ type: 'image', data, mimeType }],
		});

		const text = delegated.text;
		return {
			delegatedToSubagent: 'layoutparser',
			ok: text.includes('data-bbox'),
			head: text.slice(0, 400),
		};
	},
});
