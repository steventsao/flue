import { readFileSync } from 'node:fs';
import { defineWorkflow, type WorkflowRouteHandler } from '@flue/runtime';
import analyst from '../agents/analyst.tsx';

export const route: WorkflowRouteHandler = async (_c, next) => next();

const PARSE_TASK =
	'Parse this document page and output its content as clean markdown, with each layout element wrapped in a <div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"> tag.';

// The PARENT (analyst) delegates the parse to its `parsebench` subagent — invoking
// it as a tool, with the page image forwarded through session.task().
export default defineWorkflow({
	agent: analyst,
	async run({ harness }) {
		const path = process.env.PARSEBENCH_IMAGE;
		if (!path) throw new Error('Set PARSEBENCH_IMAGE to a page image path.');
		const data = readFileSync(path).toString('base64');
		const mimeType = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';

		const session = await harness.session();
		const delegated = await session.task(PARSE_TASK, {
			agent: 'parsebench',
			images: [{ type: 'image', data, mimeType }],
		});

		const text = delegated.text;
		return {
			delegatedToSubagent: 'parsebench',
			ok: text.includes('data-bbox'),
			bboxes: (text.match(/data-bbox=/g) ?? []).length,
			head: text.slice(0, 400),
		};
	},
});
