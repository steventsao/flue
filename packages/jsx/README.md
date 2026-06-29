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

## Authoring (JSX → Flue)

```tsx
/** @jsxImportSource @flue/jsx */
import { Agent, Subagent, Tool, toDefinition } from '@flue/jsx';
import { recropCitation } from '../tools/recrop.ts';

export default toDefinition(
  <Agent model="anthropic/claude-sonnet-4-6" instructions="Coordinate document parsing.">
    <Subagent name="partition" model="google/gemini-flash" instructions="Tokenize the page into regions." />
    <Subagent name="parse"     model="google/gemini-flash" instructions="Transcribe literally — never fix typos." />
    <Subagent name="extract"   model="anthropic/claude-sonnet-4-6" instructions="Null over guess. Cite every value." />
    <Subagent name="verify"    instructions="Re-crop the cited bbox and refute.">
      <Tool def={recropCitation} />
    </Subagent>
  </Agent>,
);
```

This is identical to the hand-written `defineAgent(() => ({ model, instructions, subagents: […], … }))`.

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

## API

| Element / fn | Compiles to |
| --- | --- |
| `<Agent …>` | `AgentDefinition` (drop-in for `defineAgent`) |
| `<Subagent name=… …>` | an `AgentProfile` in the parent's `subagents` |
| `<Tool def={…} />` | a `ToolDefinition` in `tools` |
| `<Action def={…} />` | an action in `actions` |
| `<Skill def={…} />` | a `Skill` in `skills` |
| `component(value)` | lifts a Flue value into a JSX component |
| `toDefinition(node)` | normalize a root result to `AgentDefinition` |
| `toProfile(node)` | normalize + validate to `AgentProfile` |

Validation is inherited: `<Subagent>`/`toProfile` run Flue's own
`defineAgentProfile()`, so unknown fields, bad names, and duplicate
tool/skill/subagent names throw the **same errors** as hand-written definitions
(see `test/agent-jsx.test.tsx`, which mirrors `runtime/test/agent-definition.test.ts`).
