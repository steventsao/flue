import { defineConfig } from '@flue/runtime/config';

// celld runs the same Worker + Durable Object code as the Cloudflare target,
// self-hosted on your own machines (https://celld.dev). `vite build` bundles
// the Worker to dist/worker.mjs and writes a celld-subset dist/wrangler.json;
// ship it with `celld deploy dist --bucket <s3-or-gs-bucket>`. `vite dev` is
// not supported on this target — a celld node coordinates through a real
// bucket, so iterate against a running node.
export default defineConfig({
	target: 'celld',
});
