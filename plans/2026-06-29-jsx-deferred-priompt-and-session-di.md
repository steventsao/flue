# 03 · Deferred ideas — priompt-budgeted context & CF-sessions runtime DI ⏸️

Recorded so the design is not re-derived later, each with the **tripwire** that
says "now it's worth building."

---

## A · priompt-style budgeted context assembly

[priompt](https://github.com/anysphere/priompt) uses JSX to compose **prompts**,
rendered **lazily to a token budget** by priority cutoff (`<scope p>`, `<first>`
fallback, `<isolate>` independent-budget+cache, `<empty>` reserve; binary-search
the cutoff). Notably CF sessions already ship a crude version — budgeted
`withContext("…", { maxTokens })` blocks.

### Verdict: partly a category error; the useful half is a SEPARATE product

"JSX → lazy budgeted render" does **not** map onto *agent selection/composition*:
agents are stateful actors with identity and side effects — you can't "drop half
an agent under budget pressure." Treating subagent-selection as priompt-style
budgeted render is the category error (and a lazy renderer that re-evaluates under
budget pressure is reconciler-shaped — keep it out of the actor tree).

It **does** map, perfectly, onto exactly one spot: **the context window each agent
assembles before an LLM call** — instructions + injected skills + retrieved
bbox-cited document nodes + prior-turn summary. That is text, it is budget-
constrained, and for okraPDF it's *very* on-thesis (it's the rendering policy for
the bbox-cited proof layer into a prompt). The agent analogs:

| priompt | agent-context analog |
|---|---|
| `priority` (`p`/`prel`) | relevance / citation-confidence rank of a fragment (a verified cited-bbox node outranks ambient page text) |
| `<first>` | pinned context that must survive any trim (the user's question, the schema, the active citation) |
| `<scope>` / `<isolate>` | atomically included-or-excluded fragment with independently-computed token cost (drop the whole "appendix tables" block or none) |
| token limit | token *or cost* budget per call |

### Why deferred

It's a **context-assembly / prompt layer**, categorically *below* the agent-
composition layer, and its own product surface (think `@okra/context-jsx`, or just
adopt priompt directly). It doesn't unblock agent composition, and building it now
is elegance-chasing without a felt problem.

### Tripwire

The first time a shipping okra agent must **drop or rank context to fit a token/cost
budget** — i.e. you catch yourself writing ad-hoc "if too long, slice" logic in an
agent's pre-call assembly. When it trips: strongly prefer **adopting priompt
directly** over inventing a dialect, and keep it a separate prompt layer — never in
the actor tree.

---

## B · CF-sessions runtime DI (runtime context inheritance)

CF [sessions](https://developers.cloudflare.com/agents/runtime/lifecycle/sessions/)
are per-conversation runtime state: builder `Session.create(agent).withContext(…)`,
four provider types (read-only / writable / skill / search), `.forSession(id)`
isolation, `manager.fork(sessionId, atMessageId)` parent linkage, SessionManager
shared templates. But: **"no built-in mechanism for declarative context cascading
to sub-agents."**

### Verdict: orthogonal to authoring-time DI — different primitive, different clock

Sessions are **runtime, per-connection, mutable** — `useState`/conversation memory,
not DI. Using sessions as the DI mechanism couples static policy to a runtime
connection lifecycle (you'd have no policy until a session exists) — backwards.
The authoring-time [context fold](./2026-06-29-jsx-agent-context.md) is the right substrate for
tree-scoped *config/policy*. Sessions are the right substrate for tree-scoped
*runtime state* — later.

### Tripwire

The first time a sub-agent must **inherit a value that only exists at runtime**
(tenant id, live conversation memory, an auth capability minted per session) **and**
that value must be scoped to a subtree (not just passed as a single prop). Until
then, runtime values ride the `props`/render-prop channel ([doc 02](./2026-06-29-jsx-render-prop-subagents.md)).
Likely implemented on session `fork` + SessionManager templates (the existing
parent→child propagation), exposed declaratively.
