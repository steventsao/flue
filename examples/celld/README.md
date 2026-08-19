# celld example

A Flue agent deployed to a self-hosted [celld](https://celld.dev) fleet —
Cloudflare's Durable Objects model (one object = one SQLite database,
addressed by name) running on your own machines, coordinated through an
S3-compatible or Google Cloud Storage bucket you own.

## Build and deploy

```sh
pnpm install
pnpm build          # vite build → dist/worker.mjs + dist/wrangler.json
celld deploy dist --bucket s3://my-cells-bucket
celld --bucket s3://my-cells-bucket --listen 0.0.0.0:8080
```

Then talk to the agent:

```sh
curl -X POST http://localhost:8080/agents/hello/my-first-chat \
  -H 'content-type: application/json' \
  -d '{"kind":"user","body":"Tell me a joke."}'
```

## Notes

- `vite dev` / `vite preview` are not supported on this target — a celld node
  needs a real bucket. Iterate against a running node.
- Cloudflare-only services (Workers AI, KV, R2, Queues, cron triggers) are not
  part of celld's surface; wrangler keys outside celld's subset fail the
  build with the offending key names.
- The generated Worker bundle is self-contained: `celld deploy` re-bundles
  `dist/worker.mjs` with esbuild as a pass-through.
