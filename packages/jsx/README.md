# @flue/jsx

A **JSX authoring layer for Flue agents**. It is to `defineAgent()` what JSX is
to `React.createElement` — pure constructor sugar, and it goes **both ways**:

- **JSX → Flue:** `<Agent>…</Agent>` compiles to the exact value
  `defineAgent(() => …)` produces. Default-export it from `agents/<name>.ts`
  and Flue treats it like any agent definition.
- **Flue → JSX (vice versa):** `component(defineAgent(...))` lifts an existing
  Flue value (agent, profile, tool, action, skill) into `<MyAgent />` so you can
  drop it into a tree.

There is **no reconciler and no runtime**: `jsx()` eagerly invokes the builder,
so a tree evaluates bottom-up straight into a plain Flue object. The component
analogy holds at the *authoring + composition* layer; nothing here re-renders.

## The core idea: components, not definitions — hierarchy is derived

Flue's `defineAgent({ subagents: [...] })` bakes the hierarchy **into the
definition**. This layer inverts that: write each agent and tool as a standalone
**component that knows nothing about its parent**, and let the JSX tree **derive**
the `subagents`/`tools` arrays at compile. The hierarchy lives at the *composition
site*, never in any definition — exactly like React.

```tsx
// tools/lookup.tsx        — knows nothing about any agent
export function LookupTool() {
  return <Tool name="lookup" description="Look up a value." run={lookup} />;
}
// agents/research.tsx     — knows nothing about any orchestrator
export function ResearchAgent() {
  return <Agent name="research" model="google/gemini-flash" instructions="Find sources." />;
}
// agents/writer.tsx       — a host forwards children, like any component
export function WriterAgent(props: { children?: unknown }) {
  return <Agent name="writer" model="…" instructions="Draft.">{props.children}</Agent>;
}

// agents/orchestrator.tsx — the ONLY place the hierarchy exists; derived at compile
export default toDefinition(
  <Agent model="anthropic/claude-sonnet-4-6" instructions="Coordinate.">
    <ResearchAgent />
    <WriterAgent />
    <LookupTool />
  </Agent>,
);
```

No `defineAgent` ever hand-writes `subagents`. Rearranging the tree — e.g. nesting
`<WriterAgent><ResearchAgent/></WriterAgent>` — yields a different hierarchy from
the **same** components. That's the whole point: composition is a property of the
tree, not the definition.

`component(value)` (below) is only for the inverse case — lifting a *pre-existing*
`defineAgent`/`defineTool` **value** into a component. When you author fresh, just
write the component.

## Authoring (JSX → Flue)

```tsx
/** @jsxImportSource @flue/jsx */
import { Agent, Subagent, Tool, toDefinition } from '@flue/jsx';
import { recropCitation } from '../tools/recrop.ts';

export default toDefinition(
  <Agent model="anthropic/claude-sonnet-4-6" instructions="Coordinate document parsing.">
    <Agent name="partition" model="google/gemini-flash" instructions="Tokenize the page into regions." />
    <Agent name="parse"     model="google/gemini-flash" instructions="Transcribe literally — never fix typos." />
    <Agent name="extract"   model="anthropic/claude-sonnet-4-6" instructions="Null over guess. Cite every value." />
    <Agent name="verify"    instructions="Re-crop the cited bbox and refute.">
      <Tool def={recropCitation} />
    </Agent>
  </Agent>,
);
```

**Role is decided by position, not markup:** a nested `<Agent name=…>` is automatically a
subagent (recursively), so you compose one primitive. This is identical to the hand-written
`defineAgent(() => ({ model, instructions, subagents: […], … }))`. (`<Subagent>` still exists as
a deprecated explicit alias.)

## Lifting (Flue → JSX)

```tsx
import { defineAgentProfile } from '@flue/runtime';
import { Agent, component, toDefinition } from '@flue/jsx';

const parse = defineAgentProfile({ name: 'parse', model: 'google/gemini-flash' });
const Parse = component(parse);            // existing Flue value → component

export default toDefinition(
  <Agent model="anthropic/claude-sonnet-4-6"><Parse /></Agent>,
);
```

## Reusability — define quality tools in a file, compose here

Prefer defining tools (and agents) in their own files — properly typed, tested,
reviewed — and composing the *imported* values. The JSX layer is for composition,
not a place to hide one-off tool bodies.

```tsx
// tools/lookup.ts — the canonical, tested definition
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
export const lookupTool = defineTool({
  name: 'lookup_order',
  description: 'Look up the status for one order id.',
  input: v.object({ orderId: v.string() }),
  run: async ({ input }) => statuses.get(input.orderId) ?? null,
});
```

```tsx
// agents/support.tsx — compose the imported tool, two equivalent ways
import { lookupTool } from '../tools/lookup.ts';
import { Agent, Tool, component, toDefinition } from '@flue/jsx';

const Lookup = component(lookupTool);            // lift → a component (same as agents)

export default toDefinition(
  <Agent model="anthropic/claude-sonnet-4-6">
    <Tool def={lookupTool} />                     {/* explicit */}
    {/* …or <Lookup /> — the symmetric lift */}
  </Agent>,
);
```

Inline `<Tool name=… run={…}/>` exists for genuine one-offs; reach for an imported
definition first. The same applies to modelSlot engines — each `<Engine run={…}/>`
takes an ordinary function, so define the engine impls in files and compose them.

## API

| Element / fn | Compiles to |
| --- | --- |
| `<Agent …>` (root) | `AgentDefinition` (drop-in for `defineAgent`) |
| `<Agent name=… …>` (nested) | an `AgentProfile` in the parent's `subagents` — recursive |
| `<Subagent name=… …>` | _deprecated_ — explicit alias for a nested `<Agent>` |
| `<Tool def={…} />` | a `ToolDefinition` in `tools` |
| `<Tool name=… description=… run={…} />` | inline-authored tool (compiles to `defineTool`) |
| `<Tool capability=… ><Engine name=… default run={…}/>…</Tool>` | a **modelSlot** — one capability, swappable engines, optional runtime `select` |
| `<Action def={…} />` | an action in `actions` |
| `<Skill def={…} />` | a `Skill` in `skills` |
| `component(value)` | lifts a Flue value into a JSX component |
| `toDefinition(node)` | normalize a root result to `AgentDefinition` |
| `toProfile(node)` | normalize + validate to `AgentProfile` |

Validation is inherited: `<Subagent>`/`toProfile` run Flue's own
`defineAgentProfile()`, so unknown fields, bad names, and duplicate
tool/skill/subagent names throw the **same errors** as hand-written definitions
(see `test/agent-jsx.test.tsx`, which mirrors `runtime/test/agent-definition.test.ts`).
