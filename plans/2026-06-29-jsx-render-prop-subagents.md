# 02 · Render-prop subagents — spawn-plan sugar 🟡 PROPOSED (build-second)

**Status:** proposed; gate on a shipping okra agent that static composition can't
express. **Clock:** runtime. **Reconciler:** none — *if* built as fire-once spawn
sugar (see the bright line).

## The target ergonomic

```tsx
<OrchestratorAgent query={userQuery}>
  {props => (
    <>
      <ResearchAgent task={props.researchTask} />
      <WriterAgent  harness={props.writerHarness} />
    </>
  )}
</OrchestratorAgent>
```

Children are a **function of the parent's props**, not a static value.

## Semantics: the props are RUNTIME

If `props` were authoring-time you wouldn't need a function — you'd write the
children with literal props. The function form is *only* motivated when
`props.researchTask` is **computed by the orchestrator during execution**. So:

`<OrchestratorAgent>{props => …}</OrchestratorAgent>` does **not** evaluate to a
static `AgentDefinition` with two static subagents. It evaluates to an orchestrator
definition carrying a **spawn plan**:

```ts
type SpawnPlan = (ctx) => SpawnDescriptor[];
type SpawnDescriptor = { profile: AgentProfile; input: unknown; stableId: string };
```

- **Authoring-time:** capture the closure + the *shapes* of the children
  (ResearchAgent/WriterAgent are still importable profiles, statically validated).
- **Runtime:** the harness calls the closure **once**, at the orchestrator's
  explicit fan-out point, with the parent's derived props, and spawns the named
  children via `getAgentByName(stableId)` / `session.task()`.

This is declarative sugar over dynamic spawn — **not** a lazy subtree.

## The bright line (keeps the reconciler out)

> The render-prop closure may be called **exactly once per spawn decision**, and
> its return value is consumed as a spawn list, **never retained as a declared
> child set to be reconciled.**

The moment someone wants "re-run the closure when orchestrator state changes and
reconcile the live children," the reconciler is back — **reject that feature.**
It's `Array.map(spawn)`, not `ReactDOM.render`.

## Foot-guns (name them in the API)

1. **Static/dynamic validation leak.** The child *profile* validates at authoring
   time; the *spawn input* (`props.researchTask`) only exists at runtime → validate
   it with a Zod/Valibot schema at the `session.task` boundary. Two validation moments.
2. **`props` is the sole runtime channel.** The closure may close over authoring
   imports (fine) and receives runtime `props` (fine); it must **not** read ambient
   runtime state. Forbid it.
3. **Idempotent stable id (the #1 production bug).** `getAgentByName` is
   singleton-per-id. The closure can run twice (retry, resumed workflow), so each
   descriptor MUST carry a deterministic id = `parentId + childRole + stableDiscriminator`
   — **never** an array index, never a random uuid. Double-spawn or id collision otherwise.
4. **Cardinality cap.** Render-props invite `props.items.map(i => <Worker task={i}/>)`.
   Dynamic-N is the power *and* an unbounded-cost hazard. Surface a concurrency/
   cardinality cap as a prop on the parent or a runaway orchestrator spawns 10k DOs.

## The one test that proves it

Given an orchestrator whose render-prop maps over a 3-item input: invoking the
spawn plan **twice** with the same parent context yields the **same** three
`stableId`s and spawns exactly three children (idempotent), and the plan is
**never** invoked on parent state change. If the second invocation double-spawns
or new ids appear, the primitive is wrong.

## okra relevance

`partition → N page-workers → verify` *is* a fan-out — on-thesis. But the v0
invoice-extractor ships fine with **static** subagents first. Build this when a
real okra workflow demonstrably can't be expressed statically — not before.

## Relationship to context (doc 01)

Same mechanism, two clocks: **function-as-children defers evaluation.** When the
*author/eager pass* calls the thunk → it's the [context fold](./2026-06-29-jsx-agent-context.md).
When the *harness* calls it with runtime props → it's a spawn plan. Producer side =
`Provider`; consumer side = render-prop. Keep the two channels separate: the static
spine carries policy *down*; the render-prop carries computed data *across*.
