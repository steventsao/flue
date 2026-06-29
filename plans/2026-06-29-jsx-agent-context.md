# 01 · Agent Context — authoring-time DI ✅ BUILT

**Status:** shipped in this branch (`src/context.ts`, `test/agent-context.test.tsx`, 14/14 green).
**Clock:** authoring-time. **Reconciler:** none.

## Problem

Thread a value — a redaction/rights policy, a default model, a citation-mode
flag — down a *subtree* of agents without prop-drilling. This is React Context's
job and there is no analog in Flue or CF Agents (CF sessions inject **per-conversation
runtime** state, not **per-subtree authoring** DI — orthogonal; see doc 03).

## API

```ts
const Model = createAgentContext<string>();         // optional default: createAgentContext<T>(defaultValue)

Model.Provider   // <Model.Provider value={…}>{() => <subtree/>}</Model.Provider>
Model.use()      // read nearest Provider value; throws if none and no default
```

```tsx
const Policy = createAgentContext<RedactionPolicy>();

export default toDefinition(
  <Policy.Provider value={strictPolicy}>
    {() => (
      <Agent model="anthropic/claude-sonnet-4-6" instructions="Coordinate redaction.">
        <Subagent name="detect"  model={Policy.use().detectorModel} instructions={detectPrompt(Policy.use())} />
        <Subagent name="redact"  instructions={redactPrompt(Policy.use())} />
      </Agent>
    )}
  </Policy.Provider>,
);
```

## The mechanism: function-as-children deferral

The wrinkle is that this runtime is **eager** — children evaluate *before*
parents — so a Provider can't push a value "before" its already-evaluated
descendants. React avoids this because JSX is lazy (elements are data, walked
top-down). We get the same top-down flow without a reconciler via
**function-as-children**:

1. `<Provider value={v}>{thunk}</Provider>` → `jsx(Provider, { value: v, children: thunk })`.
   The thunk is a function literal — **not** evaluated by `jsx`.
2. `Provider` pushes `v` onto a per-context stack, calls `thunk()`, pops in `finally`.
3. `thunk()` evaluates the *entire* subtree synchronously while `v` is on the
   stack, so every `use()` reached during that eager pass returns `v` — at any
   depth, with **one** thunk at the Provider boundary.

This is the "fold over the authoring tree": one deterministic top-down pass, never
re-evaluated on state change. Stack push/pop is lexical-scope-correct because the
subtree is built synchronously inside the thunk.

## Why this is not a reconciler

No diffing, no identity tracking, no re-evaluation. The thunk runs **once** during
construction. It's a `try { push; build } finally { pop }`, the same shape as a
scoped dynamic variable — not `ReactDOM.render`.

## The deliberate constraint (the foot-gun, fenced off)

**The Provider value must be authoring-time-known.** If you want a *runtime* value
(tenant id, live conversation memory, a per-session capability) in context, it goes
through the render-prop/`props` channel (doc 02) or session state (doc 03) — **not**
the Provider. The instant runtime values enter the Provider you'd need
re-evaluation-on-change → a reconciler. The Provider is deliberately static; that
constraint is the feature. (Type-safety bonus: missing-provider is an
eval-time error, surfaced at authoring, not a silent runtime undefined.)

## Tests (the proof)

`test/agent-context.test.tsx`:
- **downward propagation through nesting** — a value provided at the top appears
  in a nested subagent's resolved config (deep-equals the hand-written `defineAgent`).
- **static missing-provider guarantee** — `use()` with no enclosing Provider throws.
- default fallback; and **no leak across providers** (the stack pops — `use()`
  outside the subtree throws again).

## Future (not built)

- **Auto-merge:** have `<Agent>`/`<Subagent>` auto-read registered contexts and
  merge into initializer args (so authors don't call `use()` per prop). The
  `AgentContext.id` symbol exists for this. Minimal primitive ships explicit
  `use()` first.
- **Nested Provider inside `<Agent>`** (providing context to siblings/subagents
  mid-tree) — works today only at/near the root boundary; generalize when needed.
