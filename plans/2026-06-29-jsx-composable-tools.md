# @flue/jsx — composable tools (council-reviewed)

How far `<Tool>` composes, and where it stops. Same standing rule as the rest of
the layer: **eager runtime, no reconciler — every runtime-dynamic decision is a
thunk the harness calls once, never a declaration re-evaluated and diffed.**

## Verdict

| Reading | Status | Why |
|---|---|---|
| **1. Inline authoring** `<Tool name … run …/>` | ✅ **BUILT** | pure sugar over `defineTool` (validation inherited). The floor — generic, not okra-specific. |
| **2. Middleware/decorators** `<Tool><Retry/><Timeout/></Tool>` | ❌ **rejected as JSX** | `run` wrappers with no children/schema/identity — JSX buys nothing over `withRetry(withTimeout(x))` and adds ordering ambiguity. Ship as **HOFs** if ever needed. |
| **3. modelSlot tool** `<Tool capability><Engine/></Tool>` | ✅ **BUILT — THE unlock** | a stable capability + IO contract with swappable engines. **The swap mechanic *is* the okra product.** |
| **4. Pipeline / tool-of-tools** | ❌ **rejected** | a tool is a leaf capability; sequencing is the agent's job. Branch-on-results ⇒ it's a **Recipe**, not a Tool. |

## 1. Inline authoring ✅

`<Tool name="…" description="…" input={schema} output={schema} run={fn} />` →
`defineTool(...)`. `<Tool def={existing} />` still works. Foot-guns (handled / noted):
- inline path calls `defineTool` **internally** — never a side-door — so there's one
  validation regime (the both-ways equivalence test proves it).
- `run` is captured once at mount (harmless under the eager/no-reconciler model;
  a tripwire only if `<Tool>` ever became live-reauthorable).

## 3. modelSlot tool ✅ — the okra unlock

```tsx
<Tool capability="parse" io="page-image -> md+json" output={mdJsonSchema}
      select={(input) => input.scanned ? 'qwen-vl' : 'gemini-flash'}>
  <Engine name="gemini-flash" default run={geminiRun} />
  <Engine name="qwen-vl"            run={qwenRun} />
  <Engine name="docling"           run={doclingRun} />
</Tool>
```

Compiles to a **single `defineTool`** whose `run` dispatches over a frozen engine
map. This is the reframe spec's `modelSlots` made authorable in one element: a
stable IO contract, a default engine, swappable alternatives. Everything okra wants
to demo — "swap gemini-flash → qwen-vl → docling under the same `parse` contract and
`diff` the node graphs" — rides on this primitive.

**Why it's real composition, not cosplay (unlike #2):** the `<Engine>` children have
distinct identity, distinct `run`, and a shared validated contract. That's structural
composition.

**Why it's the tool layer, not the agent layer:** a modelSlot's defining property —
*stable IO while the engine swaps* — is a property of one capability. If selection
lived at the agent layer, every agent/recipe would re-declare the roster and the
swap would smear across the codebase.

### Mechanics (resolved)
- **default** resolved at **authoring time** → a plain string `defaultEngine`.
- **runtime selection** via the optional `select(input)` thunk, called **inside the
  single `run`** the harness invokes once per call — never a re-evaluated `<Engine when=…>`
  or a `<Policy>` sibling that re-renders.
- **contract enforcement:** all engines share the slot's one `output` schema, so
  whichever engine answers, Flue validates its output against the same contract at
  call time. **Mount-time** checks are structural: ≥1 engine, unique names, ≤1 default,
  each `<Engine>` has a `run`. (A `run` body can't be executed at mount to pre-check its
  output shape; the shared `output` schema is the runtime contract.)

### Tests (`<Tool capability>` describe block)
default dispatch · runtime `select()` dispatch · mount-time rejection of duplicate
engine / multiple defaults / empty slot.

## The two guardrails (verbatim)

1. **Engine/decorator selection lives inside the single `run` thunk the harness calls
   once — never as a re-evaluated declaration or a `when=`/`<Policy>` sibling that
   re-renders.** (Kills the reconciler in #2 and #3.)
2. **If composition needs to branch on intermediate results, it's a Recipe (agent/
   workflow layer), not a Tool.** (Kills the category error in #4.)

## Deferred, with tripwires
- **Middleware HOFs** (`withRetry`/`withTimeout`/`withTap`) — ship only if a real need
  appears; they compose through `<Tool def={withRetry(base)} />` for free, no new JSX.
  Tripwire: a decorator that must read live runtime context → if it can't be a once-called
  `run`-wrapper thunk, it wanted a reconciler → don't build it.
- **Pipeline** — route any demand to the **Recipe** layer the moment it branches on
  intermediate node-graph state.
