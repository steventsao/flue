import { defineConfig } from 'vitest/config';

// Local config so vitest doesn't walk up to a stray parent-dir config. JSX
// transpile (jsxImportSource @flue/jsx) is read from tsconfig.json by oxc.
export default defineConfig({});
