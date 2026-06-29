# parsebench-example

okraPDF's ParseBench parser as a Flue agent, **authored with `@flue/jsx`**.

- `src/agents/parsebench.tsx` — the agent, written in the component style
  (`<Agent model=… instructions={PARSEBENCH_SYSTEM} thinkingLevel="off" />`), the
  verbatim ParseBench parse prompt, on `gemini-3.1-flash-lite`.
- `src/app.ts` — registers OpenRouter as an `openai-completions` provider so
  `openrouter/google/gemini-3.1-flash-lite-preview` resolves.
- `src/workflows/parse-page.ts` — drives a real page image through the agent.

## Run (one-shot, validated)

```bash
PARSEBENCH_IMAGE=/path/to/page.png \
  pnpm exec flue run parse-page --env ~/dev/apikeys/.env
```

Returns `{ ok, chars, bboxes, head }` — the bbox-tagged markdown ParseBench expects.
Verified live: a 294 KB directory page → 24 `data-bbox` elements, correct labels and
reading order.

## Deploy to Cloudflare

Flip `flue.config.ts` to `target: 'cloudflare'`, set the secret, and deploy — each
agent lowers onto its own Durable Object:

```bash
wrangler secret put OPENROUTER_API_KEY
pnpm exec flue build --target cloudflare && wrangler deploy
```
