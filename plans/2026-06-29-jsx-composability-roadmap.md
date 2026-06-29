# @flue/jsx — composability roadmap

Where the JSX authoring layer goes beyond v1's static `<Agent>/<Subagent>` trees,
and — just as importantly — where it deliberately **stops**.

## The frame: two clocks

Every idea here splits cleanly once you separate the two clocks:

- **Authoring-time** — when the JSX tree evaluates into an `AgentDefinition` value (v1's eager pass).
- **Runtime** — when a Durable Object instance executes inside the harness.

v1 collapsed them because static composition genuinely *is* authoring-time. The
new ideas each ask "which clock?", and the answer decides whether we stay
reconciler-free.

> **The line that keeps the reconciler out:** every runtime-dynamic decision is a
> *thunk the harness calls imperatively, once*, never a *declaration the framework
> re-evaluates and diffs*. Anything that wants re-evaluation-on-state-change is the
> reconciler in disguise — reject it.

We do **not** want a reconciler: Durable Objects are singleton-per-id, so identity
is native and there is no tree to diff (see the three-way map below).

## Three-way map (React / Flue / CF Agents)

| Concept | React | Flue | CF Agents SDK |
|---|---|---|---|
| Authoring primitive | `(props)=>JSX` | `defineAgent(init=>config)` | `class extends Agent<Env,State>` |
| Composition unit | importable value `<Child/>` | importable value `subagents:[…]` | deployed DO via binding/RPC |
| Pass config in | `props` (dynamic) | profile fields + initializer ctx | constructor `env`/`initialState` |
| Children / slots | `props.children` | role-bucketed children | — (none) |
| Context / DI down tree | `createContext`/`useContext` | — | — (sessions have **no** declarative cascade¹) |
| State | `useState` | managed session state | `this.state`/`setState`/`this.sql` |
| Lifecycle init | mount / `useEffect([])` | harness init / `extend({base}).onStart` | `onStart()` |
| Per-event "render" | re-render on state | harness loop (one turn) | `onMessage`/`onStateUpdate` |
| Effects / scheduling | `useEffect` | durable steps `runFiber`/`stash` | `schedule()`/`scheduleEvery()` |
| **Reconciliation / keys** | Fiber diff + `key` | **N/A** | **N/A** (DO id *is* the key) |
| Client mount | `createRoot().render` | `@flue/react` `useAgent` | `useAgent`/`AgentClient` |

The realization that started this: **CF Agents already ships the runtime half of
React** (lifecycle hooks, state, scheduling, identity); **Flue ships the
static-composition half** (value + `subagents` + tools). What's missing for
React-grade composability is the **data-flow half** — and that's this roadmap.

¹ CF sessions *do* have budgeted **context blocks** (`Session.create(agent).withContext("memory", { maxTokens })`,
four provider types), but the docs are explicit: *"no built-in mechanism for declarative
context cascading to sub-agents."* So CF gives budgeted context blocks, not the tree cascade.

## Sequencing (council verdict)

| Idea | Clock | Status | Why |
|---|---|---|---|
| **1. Context injection** (DI fold) | authoring | **BUILT** (`createAgentContext`) | cheapest, reconciler-proof, serves okra's tree-scoped rights/citation policy. Highest value/risk. |
| **2. Render-prop subagents** (spawn-plan) | runtime | **proposed, build-second** | dynamic fan-out (partition→N workers→verify) is the real okra workload, but gate on a shipping agent that static composition can't express. |
| **3. priompt-budgeted context** | per-call | **deferred** | category error against the *actor* tree; perfect for per-call **bbox-cited context assembly** — a *separate* prompt-layer product. Adopt priompt directly when an agent hits a budget wall. |
| **4. CF-sessions runtime DI** | runtime | **deferred** | per-conversation runtime state ≠ per-subtree DI. Earns a primitive only when a sub-agent must inherit a runtime-only, subtree-scoped value. |

The framework-building trap, named explicitly: 1+2+3 together start to look like
"React for agents." We're not building that. Each earns its place only when a
*shipping okra agent* can't be expressed without it. #1 clears that bar now; the
rest are speculative until a concrete agent demands them.

## Docs

- [`01-agent-context.md`](./2026-06-29-jsx-agent-context.md) — **built.** The DI fold + the eager/thunk mechanism.
- [`02-render-prop-subagents.md`](./2026-06-29-jsx-render-prop-subagents.md) — proposed. Spawn-plan sugar + the idempotent-id foot-gun.
- [`03-deferred-priompt-and-session-di.md`](./2026-06-29-jsx-deferred-priompt-and-session-di.md) — deferred, with tripwires.
