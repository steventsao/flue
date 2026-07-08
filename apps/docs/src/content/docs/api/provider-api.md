---
title: Provider API
description: Register custom model providers and override built-in provider transport.
lastReviewedAt: 2026-05-31
---

The provider API configures model connection paths at runtime. Import ordinary provider APIs from `@flue/runtime`. For model selection, authentication setup, and Workers AI examples, see [Models & Providers](/docs/guide/models/).

## Imports

```ts
import {
  registerApiProvider,
  registerProvider,
  type HttpProviderRegistration,
  type ProviderRegistration,
} from '@flue/runtime';
```

## `registerProvider()`

```ts
function registerProvider(providerId: string, registration: ProviderRegistration): void;
```

Registers a model provider keyed by the provider ID used in model specifiers. The provider ID is the prefix used in model specifiers, such as `anthropic` in `anthropic/claude-sonnet-4-6`. Model telemetry preserves this registration identity as `request.providerId` separately from the semantic `request.providerName` used by observability integrations.

When the provider ID is a catalog provider, models resolve from the catalog — preserving metadata such as cost, context window, and wire protocol — with this call's options layered on top. That makes routing a built-in provider through a gateway one call:

```ts
registerProvider('anthropic', {
  baseUrl: 'https://gateway.example.com/anthropic',
  apiKey: process.env.GATEWAY_KEY,
});
```

Provider IDs the catalog doesn't know are registered from scratch and must supply `api` and `baseUrl`. For example, registering `ollama` makes model specifiers such as `ollama/llama3.1:8b` available to agents and operations:

```ts
registerProvider('ollama', {
  api: 'openai-completions',
  baseUrl: 'http://localhost:11434/v1',
});
```

Each call replaces the provider ID's previous registration; calls do not accumulate. The effective settings are always the catalog defaults (when the ID is known) plus the latest call's options.

### `ProviderRegistration`

```ts
type ProviderRegistration = HttpProviderRegistration | CloudflareAIBindingRegistration;
```

Use an HTTP registration for ordinary URL-backed providers. Workers AI binding registrations are Cloudflare-specific and described below.

### `HttpProviderRegistration`

```ts
interface HttpProviderRegistration {
  api?: Api;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  contextWindow?: number;
  maxTokens?: number;
  models?: Record<
    string,
    {
      contextWindow?: number;
      maxTokens?: number;
    }
  >;
  storeResponses?: boolean;
}
```

| Property         | Purpose                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`            | Wire protocol used for requests. Use a Pi-provided API slug or register one with `registerApiProvider()`. Required for non-catalog provider IDs; defaults to the catalog protocol. |
| `baseUrl`        | Endpoint root, such as `https://api.anthropic.com/v1`. Required for non-catalog provider IDs; defaults to the catalog endpoint.                                                    |
| `apiKey`         | Optional API key. When omitted, the underlying provider integration may use its normal environment-variable lookup.                                                                |
| `headers`        | Headers sent on outgoing requests. Merged per key over the catalog model's headers when the provider ID hydrates from the catalog; the registration's values win on conflict.      |
| `contextWindow`  | Default context-window size for models resolved through this registration. Falls back to the catalog value for catalog models, then to `0`, meaning unknown.                       |
| `maxTokens`      | Default output-token limit for models resolved through this registration. Falls back to the catalog value for catalog models, then to `0`.                                         |
| `models`         | Per-model `contextWindow` and `maxTokens` overrides keyed by model ID. Per-model values override provider-level defaults.                                                          |
| `storeResponses` | Send `store: true` for OpenAI Responses API providers. Enable only when your application accepts the provider's retention policy.                                                  |

Registering a non-catalog provider ID without `api` and `baseUrl` throws a `ProviderRegistrationError`.

## `registerApiProvider()`

```ts
const registerApiProvider: typeof import('@earendil-works/pi-ai').registerApiProvider;
```

Registers a wire-protocol handler for an API slug not shipped by Pi. Register the protocol first, then pass its `api` slug to `registerProvider()`.

Pi's API-provider registry is module-scoped and last-write-wins. Registering the same API slug again replaces the previous handler.

## Cloudflare binding registrations

Import Workers AI binding registration types from `@flue/runtime/cloudflare`:

```ts
import {
  type CloudflareAIBinding,
  type CloudflareAIBindingRegistration,
  type CloudflareGatewayOptions,
} from '@flue/runtime/cloudflare';
```

`CloudflareAIBindingRegistration` registers a provider backed by an `env.AI` Workers AI binding instead of an HTTP endpoint. Its optional `gateway` setting forwards AI Gateway options to each `env.AI.run(...)` call; set `gateway: false` to omit the gateway option.

Cloudflare builds register the `cloudflare` provider ID automatically unless `app.ts` registers it first. Register that provider ID in `app.ts` when you intentionally want an authored binding registration to take precedence over the generated default. See [Cloudflare Workers AI](/docs/guide/models/#cloudflare-workers-ai-cloudflare-only) for setup and gateway examples.

## Local harness providers (Node only)

Import local harness helpers from `@flue/runtime/node`:

```ts
import { registerLocalHarnessProvider } from '@flue/runtime/node';
```

`registerLocalHarnessProvider(providerId, options)` registers a Node-only provider that shells out to an installed local agent CLI. Supported harness kinds are `pi`, `codex`, `claude`, and `opencode`. The helper uses each CLI's noninteractive mode and its existing local authentication, such as Codex login, Claude Code OAuth, or Pi's configured tokens.

```ts title="src/app.ts"
import { registerLocalHarnessProvider } from '@flue/runtime/node';

registerLocalHarnessProvider('codex', { kind: 'codex' });
registerLocalHarnessProvider('claude', { kind: 'claude' });
registerLocalHarnessProvider('pi', { kind: 'pi' });
```

After registration, select the provider with normal model specifiers:

```ts title="src/agents/local-assistant.ts"
import { defineAgent } from '@flue/runtime';

export default defineAgent(() => ({
  model: 'codex/default',
}));
```

Everything after the first slash is passed as the CLI model argument. Use `default` to let the CLI use its own configured default model, or use values such as `codex/gpt-5-codex`, `claude/sonnet`, or `pi/anthropic/claude-sonnet-4-6`.

The first version adapts final text only. It does not translate the CLI's internal tool calls, streaming events, or session files into Flue tool-call events. By default, the helper asks each CLI for an ephemeral, best-effort tool-disabled run where the CLI supports that mode. Set `disableTools: false` or pass CLI-specific `args` when you intentionally want the local harness to use its own tools.
