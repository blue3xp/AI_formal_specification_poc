# Formal Specification POC — Formal Verification Guardrail

This POC demonstrates that for the same dangerous operation, traditional keyword filtering allows it while the formal method rejects it — and the rejection happens before any real side effect occurs, with an explainable counterexample.

## Mechanism Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Spec (JSON) │     │ Model (axioms)│     │ Facts (observed) │
│  S-0101      │     │ Implies(...) │     │  action=...      │
│  S-0208      │     │ Derived preds│     │  resource=...    │
└──────┬───────┘     └──────┬───────┘     └──────┬──────────┘
       │                    │                     │
       └────────────────────┼─────────────────────┘
                            v
                   ┌────────────────┐
                   │  Z3 SMT Solver  │
                   │  solver.check() │
                   └────────┬───────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              v                           v
         ┌─────────┐                ┌──────────┐
         │  sat    │                │  unsat   │
         │ REJECT  │                │  ALLOW   │
         │ +cex    │                │(safety proof)
         └─────────┘                └──────────┘
              │
              v
       ┌──────────────┐
       │ audit_log.jsonl │
       └──────────────┘
```

## Semantics of sat/unsat

- **sat (satisfiable)**: There exists an assignment that makes the forbidden condition hold -> **REJECT**, and extract a counterexample explaining which conditions caused the violation
- **unsat (unsatisfiable)**: The forbidden condition cannot hold under the model -> **ALLOW**, this is a **safety proof**, not "rule didn't match"

Key distinction: unsat means "under the given model and specs, this operation is proven safe", whereas keyword filter's "allow" just means "blacklist didn't match" — the semantics are fundamentally different.

## How to Run

### Important: Path Limitation

The z3-solver WASM module cannot work in paths containing non-ASCII characters (e.g., Chinese). If the project path contains non-ASCII characters, first move it to a pure ASCII path or create a symlink:

```bash
# For example, if current path is /Users/xxx/docs/aliyun/FormalSpecification
ln -s "/Users/xxx/docs/aliyun/FormalSpecification" /tmp/formal-spec
cd /tmp/formal-spec
```

### Install and Test

```bash
pnpm install
pnpm test                    # Run all tests (9 cases)
```

### Demo Instructions

#### Demo 1: Offline Comparison (keyword filter vs formal guard)

```bash
pnpm tsx demo/compare.ts
```

This runs the same set of operations through both the keyword filter and the formal guard, printing a side-by-side comparison. Key output to look for:

```
Case: SetScheduledRelease on prod-api-01 (tags env=staging)

  Keyword Filter:
    Allowed: true    (no dangerous keywords found)

  Formal Guard (SMT):
    Allowed:        false
    Solver Result:  sat
    Matched Specs:  ["S-0101"]
    Counterexample:
      isProduction=true  isDeletionEffect=true
      nameMatchesProd=true  envTagIsProduction=false

  DIVERGENCE: Keyword filter ALLOWED, but formal guard REJECTED
```

This demonstrates the core thesis: keyword filter misses the semantic risk because "SetScheduledRelease" contains no dangerous keywords like "delete" or "terminate", while the formal guard derives the deletion effect through semantic axioms: scheduled release -> release plan -> instance deletion.

Other cases in the comparison:

- **DescribeInstances on prod-api-01**: Both allow (safe read-only operation, solver proves unsat)
- **DeleteInstance on dev-sandbox-01**: Both allow (non-production resource)
- **DeleteInstance on prod-api-01 (env=staging)**: Both reject (resource name prefix `prod-` triggers production condition despite staging tag)

#### Demo 2: Real Agent Loop (optional, requires LLM API key)

```bash
# First, configure your API key
echo "DEEPSEEK_API_KEY=your-key-here" > .env

# Then run the demo
pnpm tsx demo/demo-agent.ts
```

This demo runs a real agent loop with a DeepSeek LLM. The agent is prompted to set a scheduled release on `prod-api-01`. Even though the LLM decides to call the `ecs_set_scheduled_release` tool, the guardrail intercepts the call inside `execute` and returns a rejection with a report ID and reason.

Expected behavior:

1. The LLM receives the user request and decides to call `ecs_set_scheduled_release`
2. The tool's `execute` function runs `checkOperation()` before any side effect
3. The formal guard rejects the operation (sat, S-0101 violated)
4. The tool returns `{ blocked: true, reportId: "GR-xxxxx", reason: "..." }`
5. The agent sees the rejection and reports it to the user

**Note**: This demo requires a valid `DEEPSEEK_API_KEY` and network access. If unavailable, the offline comparison demo (`demo/compare.ts`) demonstrates the same guardrail logic without needing an LLM.

## Six Propositions — Test Output

Running `pnpm test`:

```
✓ tests/guard.test.ts (9 tests) 169ms

Test Files  1 passed (1)
     Tests  9 passed (9)
```

Six core proposition test cases:

1. **Proposition 1**: Semantic derivation — SetScheduledRelease on prod-api-01 should be rejected with S-0101
2. **Proposition 2**: Formal method outperforms keyword filter — keywordFilter allows SetScheduledRelease, guard rejects
3. **Proposition 3**: Allow means proof — DescribeInstances on prod-api-01 allowed with unsat
4. **Proposition 4**: Tag disguise cannot defeat derivation — DeleteInstance on prod-api-01 with env=staging still rejected
5. **Proposition 5**: Unknown action fail-closed — unknown action rejected with not-modeled
6. **Proposition 6**: Rejection is explainable + auditable — rejection has counterexample and audit log entry

## demo/compare.ts Example Output

```
================================================================================
Formal Verification Guard vs Keyword Filter — Offline Comparison
================================================================================

Case: SetScheduledRelease on prod-api-01 (tags env=staging)
  Action: ecs:SetScheduledRelease
  Resource: prod-api-01
  Tags: {"env":"staging"}

  Keyword Filter:
    Allowed: true
    Reason:  Action "ecs:SetScheduledRelease" does not match...

  Formal Guard (SMT):
    Allowed:        false
    Solver Result:  sat
    Matched Specs:  ["S-0101"]
    Counterexample:
      isProduction=true  isDeletionEffect=true
      nameMatchesProd=true  envTagIsProduction=false
    Reason: Spec S-0101 violated: Forbid deletion effects on production resources...

  DIVERGENCE: Keyword filter ALLOWED, but formal guard REJECTED
```

This case perfectly illustrates the value of the formal method:

- **Keyword filter allows**: Because "SetScheduledRelease" does not contain keywords like delete/terminate
- **Formal guard rejects**: Because the semantic model derives "scheduled release -> release plan -> equivalent deletion"

## Directory Structure

```
FormalSpecification/
├── index.ts                  # Existing entry point, integrates guardedTools
├── package.json              # Dependencies: z3-solver, vitest, ai, zod, etc.
├── tsconfig.json             # TypeScript config
├── vitest.config.ts          # Vitest config
├── specs/
│   └── cloud_guard.json      # Declarative specs (S-0101, S-0208)
├── src/guard/
│   ├── types.ts              # Operation / Verdict type definitions
│   ├── solver.ts             # Z3 init singleton (uses createRequire for ESM compat)
│   ├── spec.ts               # Spec loading and compilation: JSON to Z3 Bool expressions
│   ├── model.ts              # Operation semantic model: action to pre/post-state axioms
│   ├── guard.ts              # Decision engine: encode, solve, judge + counterexample + audit
│   ├── keywordFilter.ts      # Baseline: traditional keyword blacklist filter
│   └── tools.ts              # Export guarded AI SDK tool definitions
├── demo/
│   ├── compare.ts            # Offline comparison: same operation judged by both methods
│   └── demo-agent.ts         # Optional: real agent loop showing interception (needs LLM)
├── tests/
│   └── guard.test.ts         # vitest, covers six propositions + three extra scenarios
└── audit_log.jsonl           # Audit log (one entry appended per decision)
```

## Technical Implementation Notes

### Z3 Initialization and ESM Compatibility

z3-solver has compatibility issues in ESM environments; use `createRequire` as a workaround:

```typescript
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const z3Solver = require("z3-solver");
const binding = await z3Solver.init();
```

### String Predicate Degradation

Z3's high-level API doesn't directly support string prefix predicates (like `PrefixOf`), so we use **fact assertion degradation**:

```typescript
// Pre-compute in JS
const nameMatches = op.resourceId.startsWith("prod-");
// Assert into solver
facts.push(v.nameMatchesProd.eq(nameMatches));
```

This is "concrete fact assertion" rather than "symbolic derivation", but the solver still independently determines whether the forbidden condition is satisfiable. See limitations section.

### Semantic Axiom Examples

```typescript
// SetScheduledRelease -> creates release plan AND release plan deletes instance
Implies(
  v.is_action_SetScheduledRelease,
  And(v.postHasReleasePlan, v.postReleaseDeletes),
);

// Derived predicate: deletion effect = release deletes OR direct deletion
v.isDeletionEffect.eq(Or(v.postReleaseDeletes, v.is_action_DeleteInstance));

// Derived predicate: production = env tag is production OR name starts with prod- OR high criticality
v.isProduction.eq(
  Or(v.envTagIsProduction, v.nameMatchesProd, v.criticalityIsHigh),
);
```

## Dependencies

- **z3-solver**: Z3 official TS/WASM binding (core solver)
- **vitest**: Unit test framework
- **ai + @ai-sdk/deepseek**: Vercel AI SDK (agent integration, only used by demo-agent.ts)
- **zod**: Tool input schema validation
- **dotenv**: Environment variable loading (only used by demo-agent.ts)
