import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	// @flue/react is a workspace dep; without dedupe its hooks can bind to a second
	// React copy → "Cannot read properties of null (reading 'useContext')".
	resolve: { dedupe: ['react', 'react-dom'] },
	build: { outDir: 'dist', emptyOutDir: true },
});
