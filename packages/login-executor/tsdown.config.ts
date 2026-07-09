import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		cli: 'src/cli.ts',
		'local-cli': 'src/local-cli.ts',
		'workflow-proof-cli': 'src/workflow-proof-cli.ts',
	},
	format: ['esm'],
	dts: true,
	clean: true,
	deps: {
		neverBundle: ['@flue/runtime', '@earendil-works/pi-ai', 'hono'],
	},
});
