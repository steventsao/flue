# `@flue/login-executor`

Experimental Node-only executor that runs every Flue model turn through Pi's native OpenAI Codex provider and a user-owned ChatGPT Plus/Pro OAuth credential. The Flue server never receives the OAuth credential: it queues native Pi contexts, and a local worker fulfills them one fenced lease at a time.

The package is intentionally Codex-only. Pi already owns OAuth login, refresh locking, model metadata, the Codex Responses transport, tool calls, reasoning signatures, images, and usage. This package adds only the remote execution queue and Flue-wide serialization semantics.

## Authenticate the local worker

Pi's OAuth credential is separate from the Codex CLI login. If `~/.pi/agent/auth.json` already contains `openai-codex`, the worker uses it by default. Otherwise create a dedicated credential file:

```sh
mkdir -p ~/.flue/codex-worker
cd ~/.flue/codex-worker
npx @earendil-works/pi-ai login openai-codex
```

The login command writes `auth.json` in the current directory. Token refreshes are serialized and persisted atomically with mode `0600`. Give each worker its own credential file.

## Server

Mount the authenticated broker routes before mounting Flue:

```ts
import { createLoginExecutorBroker } from '@flue/login-executor';
import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';

const broker = createLoginExecutorBroker({
  token: process.env.FLUE_LOGIN_EXECUTOR_TOKEN!,
});

const app = new Hono();
app.route('/_flue/login-executor', broker.routes);
app.route('/', flue());

export default app;
```

Define a profile that cannot escape to a direct provider through a subagent or explicit compaction model:

```ts
import { defineCodexLoginProfile } from '@flue/login-executor';
import { defineAgent } from '@flue/runtime';

export default defineAgent(() => ({
  profile: defineCodexLoginProfile({
    model: 'gpt-5.4',
    instructions: 'Work carefully and keep responses concise.',
    durability: { timeoutMs: 21_600_000 },
  }),
}));
```

## Local worker

Run the worker on the machine that owns the Pi OAuth credential:

```sh
export FLUE_LOGIN_EXECUTOR_TOKEN='replace-with-a-long-random-secret'

flue-login-worker \
  --url https://server.example/_flue/login-executor \
  --auth-file ~/.flue/codex-worker/auth.json
```

`--auth-file` defaults to `FLUE_PI_AUTH_FILE`, then `~/.pi/agent/auth.json` when present, then `./auth.json`.

Only one model lease is active globally, even if multiple workers poll. Every claim receives a monotonic fencing number; heartbeats extend its lease, expired jobs are requeued, and stale completions are rejected.

## One-shot local proof

The local command exercises the complete provider → broker → fenced lease → Pi OAuth worker path without opening a network listener:

```sh
pnpm --dir packages/login-executor build

node packages/login-executor/dist/local-cli.mjs \
  --model gpt-5.4 \
  --json \
  "Reply with exactly this text and nothing else: PI_CODEX_OAUTH_PROOF_OK"
claimed 2aaf893d-37ea-4a23-8f55-699566627dfb
completed 2aaf893d-37ea-4a23-8f55-699566627dfb
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "PI_CODEX_OAUTH_PROOF_OK",
      "textSignature": "{\"v\":1,\"id\":\"msg_...\",\"phase\":\"final_answer\"}"
    }
  ],
  "api": "openai-codex-responses",
  "provider": "openai-codex",
  "model": "gpt-5.4",
  "usage": {
    "input": 33,
    "output": 12,
    "totalTokens": 45
  },
  "stopReason": "stop",
  "responseId": "resp_..."
}
```

The matching `claimed` and `completed` IDs prove the lease lifecycle. Native text signatures, response IDs, usage, `api: "openai-codex-responses"`, and `provider: "openai-codex"` prove the worker used Pi's OAuth provider rather than the Codex subprocess or a direct OpenAI API key. IDs, usage, and timestamps vary between runs.

## Execution model

- Flue remains the canonical harness and executes profile tools itself.
- The server sends native Pi `Context` values; the worker returns native Pi `AssistantMessage` values.
- OAuth credentials, headers, environment values, callbacks, and abort signals never cross the worker route.
- Pi preserves Codex tool-call IDs, thinking signatures, response IDs, images, stop reasons, and actual usage.
- Agent operations are globally serialized process-wide, including nested agents and Flue-owned tool calls. Later operations remain admitted and queued.
- With no worker, the model turn remains queued until cancellation or the agent's durability timeout.

## Current limits

- Node only; broker jobs are process-local and ephemeral. The outer Flue submission remains durable and can reconstruct a turn after server restart.
- The broker buffers each Pi turn rather than relaying live token deltas.
- A lease expiry can briefly duplicate subscription work if an unreachable worker ignores cancellation; fencing prevents its stale result from being accepted.
- The native message wire is version-coupled to Pi, so the package pins `@earendil-works/pi-ai` exactly.
- Protect the worker route with a strong token and an application-owned network policy.
