import { defineConfig } from '@flue/cli/config';

// Node target — run one-shot with `flue run`. Switch to `target: 'cloudflare'`
// to lower the agent onto a Durable Object and `flue deploy`.
export default defineConfig({ target: 'node' });
