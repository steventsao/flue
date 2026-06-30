# layoutparser-example

okraPDF's LayoutParser as a Flue agent, **authored with `@flue/jsx`**.

LayoutParser is the **detection** half of the parse pipeline. Where
[`parsebench`](../parsebench/) transcribes a page into bbox-tagged markdown,
LayoutParser only **locates and labels** the regions — it emits one empty
`<div data-bbox="[y_min, x_min, y_max, x_max]" data-label="Category"></div>` per
region, in reading order, and never transcribes text. Same `data-bbox`/`data-label`
tag shape, same DocLayNet labels, and the same normalized 0–1000 coordinate
convention as ParseBench, so the boxes are drop-in compatible with the same bbox
overlay tooling — ParseBench fills the divs, LayoutParser leaves them empty.

- `src/agents/layoutparser.tsx` — the agent, written in the component style
  (`<Agent model=… instructions={LAYOUTPARSER_SYSTEM} thinkingLevel="off" />`), the
  detection prompt, on `gemini-3.1-flash-lite`.
- `src/agents/triage.tsx` — a parent agent that composes `<LayoutParser />` as a
  **subagent**; the hierarchy lives only at this composition site (see
  [`@flue/jsx`](../../packages/jsx/)).
- `src/app.ts` — registers OpenRouter as an `openai-completions` provider so
  `openrouter/google/gemini-3.1-flash-lite-preview` resolves.
- `src/workflows/detect-layout.ts` — drives a real page image straight through the agent.
- `src/workflows/triage-page.ts` — the parent delegates detection to its `layoutparser` subagent.

## Run (one-shot, validated)

```bash
LAYOUTPARSER_IMAGE=/path/to/page.png \
  pnpm exec flue run detect-layout --env .env
```

Returns `{ ok, regions, labels, head }` — the `data-bbox` count, the distinct
labels found, and the head of the raw `<div>` tags the model returned.
(`PARSEBENCH_IMAGE` is accepted as a fallback so you can point both examples at
the same page.)

Delegated variant — the `triage` parent invokes `layoutparser` as a tool:

```bash
LAYOUTPARSER_IMAGE=/path/to/page.png \
  pnpm exec flue run triage-page --env .env
```

## Test

```bash
pnpm test                         # deterministic composition contract (no model)
LAYOUTPARSER_IMAGE=/path/page.png OPENROUTER_API_KEY=… pnpm test   # + live delegation
```

The composition test asserts the authoring contract: `<LayoutParser />` resolves
to a named subagent and the parent exposes it in `subagents` — the exact surface
Flue turns into a delegation tool. The live test is skipped unless both env vars
are set.

## Deploy to Cloudflare

Flip `flue.config.ts` to `target: 'cloudflare'`, set the secret, and deploy — each
agent lowers onto its own Durable Object:

```bash
wrangler secret put OPENROUTER_API_KEY
pnpm exec flue build --target cloudflare && wrangler deploy
```
