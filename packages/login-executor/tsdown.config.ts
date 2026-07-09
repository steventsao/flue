import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		cli: 'src/cli.ts',
	},
	format: ['esm'],
	dts: true,
	clean: true,
	deps: {
		neverBundle: ['@flue/runtime', '@earendil-works/pi-ai', 'hono'],
	},
});
