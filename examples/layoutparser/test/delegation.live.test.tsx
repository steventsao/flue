/** @jsxImportSource @flue/jsx */
import { readFileSync } from 'node:fs';
import { createFlueContext, resolveModel } from '@flue/runtime/internal';
import type { SessionEnv } from '@flue/runtime';
import { describe, expect, it } from 'vitest';
import triage from '../src/agents/triage.tsx';
import '../src/app.ts'; // side effect: registerProvider('openrouter', …)

// Reproduces the live validation as a (gated) test: the parent agent delegates the
// detection to its `layoutparser` subagent, with the page image forwarded through
// session.task(). Skipped unless OPENROUTER_API_KEY and LAYOUTPARSER_IMAGE are set:
//   LAYOUTPARSER_IMAGE=/path/page.png OPENROUTER_API_KEY=… pnpm test
const KEY = process.env.OPENROUTER_API_KEY;
const IMG = process.env.LAYOUTPARSER_IMAGE ?? process.env.PARSEBENCH_IMAGE;

const DETECT_TASK =
	'Detect the layout of this document page. Output one empty ' +
	'<div data-bbox="[y_min,x_min,y_max,x_max]" data-label="Category"></div> per region ' +
	'in reading order — do not transcribe any text.';

function noopEnv(): SessionEnv {
	const cwd = '/repo';
	return {
		cwd,
		resolvePath: (p: string) => (p.startsWith('/') ? p : `${cwd}/${p}`),
		exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
		readFile: async () => '',
		readFileBuffer: async () => new Uint8Array(),
		writeFile: async () => {},
		stat: async () => ({
			isFile: false,
			isDirectory: false,
			isSymbolicLink: false,
			size: 0,
			mtime: new Date(0),
		}),
		readdir: async () => [],
		exists: async () => false,
		mkdir: async () => {},
		rm: async () => {},
	};
}

describe.skipIf(!KEY || !IMG)('live: parent delegates detection to its layoutparser subagent', () => {
	it(
		'returns a JSON region map from the subagent',
		async () => {
			const ctx = createFlueContext({
				id: 'live-delegation',
				env: process.env,
				agentConfig: { resolveModel: (m: string) => resolveModel(m) },
				createDefaultEnv: async () => noopEnv(),
			});
			const harness = await ctx.initializeRootHarness(triage);
			const session = await harness.session();

			const data = readFileSync(IMG as string).toString('base64');
			const mimeType = /\.jpe?g$/i.test(IMG as string) ? 'image/jpeg' : 'image/png';
			const res = await session.task(DETECT_TASK, {
				agent: 'layoutparser',
				images: [{ type: 'image', data, mimeType }],
			});

			expect(res.text).toContain('bbox');
		},
		120_000,
	);
});
