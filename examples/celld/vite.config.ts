import { flue } from '@flue/vite';
import { defineConfig } from 'vite';

// No @cloudflare/vite-plugin sibling on the celld target: flue() owns the
// build itself — bundling virtual:flue/worker and writing dist/wrangler.json.
export default defineConfig({
	plugins: [flue()],
});
