# `@flue/login-executor`

Experimental Node-only model executor for running Flue agents through an existing local Codex or Claude login. The Flue server never receives the provider OAuth credential: it queues model turns, and a user-owned worker fulfills them by invoking the selected CLI.

The broker is globally single-threaded by default. It also installs a Flue execution interceptor that holds one process-wide slot across each agent operation, including model turns, nested agents, and Flue-owned tool calls. Other operations remain admitted and queued.

## Server

Create the broker in `src/app.ts`, mount its authenticated worker routes, then mount Flue:

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

An agent selects a login-backed provider through its ordinary model field. This means normal prompts, delegated tasks, tools, compaction, durable retries, and canonical conversation events continue to use Flue's existing runtime:

```ts
import { defineLoginBoundProfile } from '@flue/login-executor';
import { defineAgent } from '@flue/runtime';

export default defineAgent(() => ({
  profile: defineLoginBoundProfile({
    harness: 'codex',
    model: 'gpt-5.4',
    instructions: 'Work carefully and keep responses concise.',
    durability: { timeoutMs: 21_600_000 },
  }),
}));
```

Use `claude-login/sonnet` for Claude. Custom provider IDs and model metadata can be supplied through the broker's `providers` option.

## One-shot local Codex CLI

Build the package, then run this proof against the Codex login on the current machine:

```console
$ node packages/login-executor/dist/local-cli.mjs \
    --model gpt-5.4 \
    --json \
    "Reply with exactly this text and nothing else: LOGIN_EXECUTOR_PROOF_OK"
claimed 80cbba6b-b257-4da7-aa1e-2aea69023f8c
completed 80cbba6b-b257-4da7-aa1e-2aea69023f8c
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "LOGIN_EXECUTOR_PROOF_OK"
    }
  ],
  "api": "flue-login-executor",
  "provider": "codex-login",
  "model": "gpt-5.4",
  "usage": {
    "input": 105,
    "output": 21,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalTokens": 126,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  },
  "stopReason": "stop",
  "timestamp": 1783629005485
}
```

The matching `claimed` and `completed` IDs show the fenced lease lifecycle. The `api` and `provider` fields prove the response returned through the login executor rather than a direct provider API. Job IDs, usage estimates, and timestamps vary between runs.

The command runs one model turn through the custom Flue provider, authenticated broker, fenced worker lease, isolated Codex CLI process, and result validator. The broker stays in-process and opens no network listener. Once installed as a package, use the shorter `flue-login-local` binary. Omit the prompt to read it from stdin.

## Local worker

The worker uses the selected CLI's existing local login. It does not read or upload the CLI's OAuth files.

```sh
export FLUE_LOGIN_EXECUTOR_TOKEN='replace-with-a-long-random-secret'

flue-login-worker \
  --url http://localhost:3583/_flue/login-executor \
  --harness codex
```

Or run a Claude worker:

```sh
flue-login-worker \
  --url http://localhost:3583/_flue/login-executor \
  --harness claude
```

Only one worker lease is active at a time, even if multiple workers are polling. Every claim receives a monotonic fencing number; heartbeats extend the lease, and stale completions are rejected.

## Execution model

- Flue remains the canonical harness and executes profile tools itself.
- Codex runs with an ephemeral session, read-only sandbox, and no approvals.
- Claude runs without session persistence and with its built-in tools disabled.
- Each CLI receives the complete Flue model context and a validated JSON wire contract. Codex also enforces that contract through its native output-schema option.
- The CLI returns assistant text or structured Flue tool calls.
- With no compatible logged-in worker, the model turn remains queued until the agent's durability timeout or cancellation.

## Current limits

- Node only; the broker is process-local and intended for a continuously running personal server.
- Text context only. Image turns fail before a job is admitted.
- Input and output tokens are estimated from character counts for compaction; cost remains zero because subscription CLIs do not expose compatible per-turn accounting here.
- Broker jobs are ephemeral. The outer Flue submission remains durable and may reconstruct the model turn after restart, so side-effecting behavior must stay in Flue tools rather than the CLI harness.
- Do not configure a direct-provider `compaction.model` or subagent model if every turn must remain subscription-bound. Use the inherited `codex-login/*` or `claude-login/*` model.
- The worker route is an administrative execution surface. Protect it with a strong token and an application-owned network/auth policy.
