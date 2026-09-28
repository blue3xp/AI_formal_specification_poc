import { keywordFilter } from "../src/guard/keywordFilter.js";
import { checkOperation } from "../src/guard/guard.js";
import type { Operation } from "../src/guard/types.js";

const cases: { label: string; op: Operation }[] = [
  {
    label: "SetScheduledRelease on prod-api-01 (tags env=staging)",
    op: {
      action: "ecs:SetScheduledRelease",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
      params: { release_after_days: 3 },
    },
  },
  {
    label: "DescribeInstances on prod-api-01 (safe read-only)",
    op: {
      action: "ecs:DescribeInstances",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
    },
  },
  {
    label: "DeleteInstance on dev-sandbox-01 (non-production)",
    op: {
      action: "ecs:DeleteInstance",
      resourceId: "dev-sandbox-01",
      resourceTags: { env: "development" },
    },
  },
  {
    label: "DeleteInstance on prod-api-01 (tags env=staging, disguised)",
    op: {
      action: "ecs:DeleteInstance",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
    },
  },
];

async function main() {
  console.log("=".repeat(80));
  console.log("Formal Verification Guard vs Keyword Filter — Offline Comparison");
  console.log("=".repeat(80));
  console.log();

  for (const { label, op } of cases) {
    console.log(`Case: ${label}`);
    console.log(`  Action: ${op.action}`);
    console.log(`  Resource: ${op.resourceId}`);
    console.log(`  Tags: ${JSON.stringify(op.resourceTags)}`);
    console.log();

    const kf = keywordFilter(op);
    const gv = await checkOperation(op);

    console.log("  ┌─────────────────────────────────────────────────────────────┐");
    console.log(`  │ Keyword Filter:                                              │`);
    console.log(`  │   Allowed: ${String(kf.allowed).padEnd(5)}                                             │`);
    console.log(`  │   Reason:  ${kf.reason.slice(0, 54).padEnd(54)} │`);
    console.log("  ├─────────────────────────────────────────────────────────────┤");
    console.log(`  │ Formal Guard (SMT):                                          │`);
    console.log(`  │   Allowed:        ${String(gv.allowed).padEnd(5)}                                        │`);
    console.log(`  │   Solver Result:  ${gv.solverResult.padEnd(5)}                                        │`);
    console.log(`  │   Matched Specs:  ${JSON.stringify(gv.matchedSpecIds).padEnd(54).slice(0, 54)} │`);
    console.log(`  │   Elapsed:        ${String(gv.elapsedMs + " ms").padEnd(54)} │`);
    console.log(`  │   Report ID:      ${gv.reportId.padEnd(54)} │`);
    if (gv.counterexample) {
      console.log(`  │   Counterexample:                                            │`);
      const cex = gv.counterexample;
      console.log(`  │     isProduction=${String(cex.isProduction).padEnd(5)} isDeletionEffect=${String(cex.isDeletionEffect).padEnd(5)}               │`);
      console.log(`  │     nameMatchesProd=${String(cex.nameMatchesProd).padEnd(5)} envTagIsProduction=${String(cex.envTagIsProduction).padEnd(5)}              │`);
    }
    console.log(`  │   Reason: ${gv.reason.slice(0, 56).padEnd(56)} │`);
    console.log("  └─────────────────────────────────────────────────────────────┘");
    console.log();

    const divergence = kf.allowed !== gv.allowed;
    if (divergence) {
      console.log(`  ⚠ DIVERGENCE: Keyword filter ${kf.allowed ? "ALLOWED" : "REJECTED"}, but formal guard ${gv.allowed ? "ALLOWED" : "REJECTED"}`);
    } else {
      console.log(`  ✓ Both methods agree: ${gv.allowed ? "ALLOWED" : "REJECTED"}`);
    }
    console.log();
    console.log("-".repeat(80));
    console.log();
  }
}

main().catch(console.error);
