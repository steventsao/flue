import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Resolve @flue/* to source (no build step). The .tsx transform reads jsx /
// jsxImportSource from tsconfig.json (vitest 4 transpiles via oxc), pointing at
// the Flue JSX runtime — the same automatic-runtime config consumers will use.
export default defineConfig({
	resolve: {
		alias: {
			'@flue/jsx/jsx-runtime': resolve(__dirname, 'src/jsx-runtime.ts'),
			'@flue/jsx/jsx-dev-runtime': resolve(__dirname, 'src/jsx-dev-runtime.ts'),
			'@flue/jsx': resolve(__dirname, 'src/index.ts'),
			'@flue/runtime/internal': resolve(__dirname, '../runtime/src/internal.ts'),
			'@flue/runtime': resolve(__dirname, '../runtime/src/index.ts'),
		},
	},
});
