import { readFileSync } from 'node:fs';
import { defineWorkflow, type WorkflowRouteHandler } from '@flue/runtime';
import * as v from 'valibot';
import layoutparser from '../agents/layoutparser.tsx';

// Open the workflow to HTTP: `POST /workflows/detect-layout` (the JSON body is
// the input below). Tighten this middleware to add auth before exposing it.
export const route: WorkflowRouteHandler = async (_c, next) => next();

// Input is optional: pass `{ image, mimeType }` (base64, no data: prefix) over
// HTTP — required on a Worker, which has no local file to read. Omit it for local
// `flue run` and the workflow falls back to LAYOUTPARSER_IMAGE / PARSEBENCH_IMAGE.
const Input = v.object({
	image: v.optional(v.string()),
	mimeType: v.optional(v.string()),
});

// The per-page user nudge LayoutParser sends alongside the image.
const USER =
	'Detect the layout of this document page. Output one empty ' +
	'<div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"></div> per region ' +
	'in reading order — do not transcribe any text.';

// The distinct labels found, in the order they first appear.
function labelsOf(text: string): string[] {
	const found = [...text.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1] ?? '');
	return [...new Set(found)].filter(Boolean);
}

// Validation workflow: prompt the layout agent with a real page image and report
// the region map it returned. Set LAYOUTPARSER_IMAGE (or PARSEBENCH_IMAGE) to a
// page PNG/JPG path.
export default defineWorkflow({
	agent: layoutparser,
	input: Input,
	async run({ harness, input }) {
		let data: string;
		let mimeType: string;
		if (input?.image) {
			data = input.image;
			mimeType = input.mimeType ?? 'image/png';
		} else {
			const path = process.env.LAYOUTPARSER_IMAGE ?? process.env.PARSEBENCH_IMAGE;
			if (!path) throw new Error('Pass { image } in the request body, or set LAYOUTPARSER_IMAGE.');
			data = readFileSync(path).toString('base64');
			mimeType = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
		}

		const session = await harness.session();
		const res = await session.prompt(USER, {
			images: [{ type: 'image', data, mimeType }],
		});

		const text = res.text;
		return {
			ok: text.includes('data-bbox'),
			regions: (text.match(/data-bbox=/g) ?? []).length,
			labels: labelsOf(text),
			head: text.slice(0, 800),
		};
	},
});
