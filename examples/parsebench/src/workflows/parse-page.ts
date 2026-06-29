import { readFileSync } from 'node:fs';
import { defineWorkflow, type WorkflowRouteHandler } from '@flue/runtime';
import parsebench from '../agents/parsebench.tsx';

export const route: WorkflowRouteHandler = async (_c, next) => next();

// The per-page user nudge ParseBench sends alongside the image.
const USER =
	'Parse this document page and output its content as clean markdown, with each layout element wrapped in a <div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"> tag.';

// Validation workflow: prompt the parse agent with a real page image and report
// what came back. Set PARSEBENCH_IMAGE to a page PNG/JPG path.
export default defineWorkflow({
	agent: parsebench,
	async run({ harness }) {
		const path = process.env.PARSEBENCH_IMAGE;
		if (!path) throw new Error('Set PARSEBENCH_IMAGE to a page image path.');
		const data = readFileSync(path).toString('base64');
		const mimeType = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';

		const session = await harness.session();
		const res = await session.prompt(USER, {
			images: [{ type: 'image', data, mimeType }],
		});

		const text = res.text;
		return {
			ok: text.includes('data-bbox'),
			chars: text.length,
			bboxes: (text.match(/data-bbox=/g) ?? []).length,
			head: text.slice(0, 800),
		};
	},
});
