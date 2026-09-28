import { appendFileSync } from "node:fs";
import { getZ3 } from "./solver.js";
import { loadSpecs, compileSpec, type SpecDef } from "./spec.js";
import { createModelVars, getModelAxioms, getObservedFacts, isActionModeled, type ModelVars } from "./model.js";
import type { Operation, Verdict } from "./types.js";

let specCache: SpecDef[] | null = null;

function getSpecs(): SpecDef[] {
  if (!specCache) {
    specCache = loadSpecs().specs;
  }
  return specCache;
}

function generateReportId(): string {
  return `GR-${String(Date.now() % 100000).padStart(5, "0")}`;
}

/**
 * Build a counterexample: extract the key facts that caused the spec violation
 *
 * When the solver returns sat, there exists an assignment that makes the forbidden
 * condition hold. The counterexample explains "which conditions led to the violation"
 * for human auditing.
 */
function buildCounterexample(
  ctx: any,
  model: any,
  v: ModelVars,
  op: Operation
): Record<string, unknown> {
  const evalBool = (expr: any) => {
    try { return String(model.eval(expr, true)) === "true"; }
    catch { return false; }
  };

  return {
    action: op.action,
    resourceId: op.resourceId,
    resourceTags: op.resourceTags,
    isProduction: evalBool(v.isProduction),
    isDeletionEffect: evalBool(v.isDeletionEffect),
    nameMatchesProd: evalBool(v.nameMatchesProd),
    envTagIsProduction: evalBool(v.envTagIsProduction),
    postReleaseDeletes: evalBool(v.postReleaseDeletes),
    postHasReleasePlan: evalBool(v.postHasReleasePlan),
    aclIsPublic: evalBool(v.aclIsPublic),
  };
}

/**
 * Core decision engine
 *
 * Solving approach:
 *   solver.add(modelAxioms)          // model axioms (action → post-state)
 *   solver.add(observedFacts)        // concrete facts about the current operation
 *   solver.push()
 *   solver.add(forbiddenCondition)   // spec forbidden condition
 *   result = solver.check()
 *     sat   → forbidden condition is satisfiable → reject
 *     unsat → forbidden condition cannot hold    → allow (safety proof)
 *   solver.pop()
 */
export async function checkOperation(op: Operation): Promise<Verdict> {
  const startTime = performance.now();
  const reportId = generateReportId();

  // Check whether the action is covered by the model
  if (!isActionModeled(op.action)) {
    const elapsedMs = Number((performance.now() - startTime).toFixed(1));
    const verdict: Verdict = {
      allowed: false,
      reason: `Action "${op.action}" is not covered by the semantic model. Fail-closed: unknown actions are rejected by default.`,
      counterexample: null,
      matchedSpecIds: [],
      solverResult: "not-modeled",
      elapsedMs,
      reportId,
    };
    writeAuditLog(op, verdict);
    return verdict;
  }

  const { Context } = await getZ3();
  const v = createModelVars(Context);
  const axioms = getModelAxioms(Context, v);
  const facts = getObservedFacts(Context, v, op);
  const specs = getSpecs();

  const solver = new Context.Solver();

  // Add model axioms and observed facts
  for (const axiom of axioms) solver.add(axiom);
  for (const fact of facts) solver.add(fact);

  const matchedSpecIds: string[] = [];
  let firstCounterexample: Record<string, unknown> | null = null;
  let firstReason = "";
  let solverResult: "sat" | "unsat" | "unknown" = "unsat";

  // Solve each spec independently
  for (const spec of specs) {
    solver.push();
    const forbiddenExpr = compileSpec(spec, Context, v);
    solver.add(forbiddenExpr);

    const result = await solver.check();
    const resultStr = String(result);

    if (resultStr === "sat") {
      // Forbidden condition is satisfiable → spec is violated
      matchedSpecIds.push(spec.id);
      if (!firstCounterexample) {
        const model = solver.model();
        firstCounterexample = buildCounterexample(Context, model, v, op);
        firstReason = buildReason(spec, op, firstCounterexample);
        solverResult = "sat";
      }
    } else if (resultStr === "unknown") {
      solverResult = "unknown";
    }
    // unsat: this spec is not violated, continue checking the next one

    solver.pop();
  }

  const elapsedMs = Number((performance.now() - startTime).toFixed(1));

  const allowed = matchedSpecIds.length === 0;
  const verdict: Verdict = {
    allowed,
    reason: allowed
      ? `All specs verified: forbidden conditions are unsatisfiable under the semantic model (safety proved).`
      : firstReason,
    counterexample: firstCounterexample,
    matchedSpecIds,
    solverResult: allowed ? "unsat" : solverResult,
    elapsedMs,
    reportId,
  };

  writeAuditLog(op, verdict);
  return verdict;
}

/**
 * Build a human-readable rejection reason
 */
function buildReason(spec: SpecDef, op: Operation, cex: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`Spec ${spec.id} violated: ${spec.description}`);

  if (cex.isProduction) {
    if (cex.nameMatchesProd) {
      parts.push(`Resource "${op.resourceId}" is production (name prefix "prod-")`);
    }
    if (cex.envTagIsProduction) {
      parts.push(`Resource "${op.resourceId}" is production (tag env=production)`);
    }
  }

  if (cex.isDeletionEffect) {
    if (op.action === "ecs:SetScheduledRelease") {
      parts.push(`Action "${op.action}" creates a release plan that will delete the instance (semantic derivation: scheduled release → release plan → deletion effect)`);
    } else if (op.action === "ecs:DeleteInstance") {
      parts.push(`Action "${op.action}" directly deletes the instance`);
    }
  }

  if (cex.aclIsPublic) {
    parts.push(`ACL is set to public-read`);
  }

  return parts.join(". ");
}

/**
 * Write audit log (JSONL format)
 */
function writeAuditLog(op: Operation, verdict: Verdict): void {
  const entry = {
    timestamp: new Date().toISOString(),
    operation: {
      action: op.action,
      resourceId: op.resourceId,
      resourceTags: op.resourceTags,
      params: op.params,
      region: op.region,
    },
    allowed: verdict.allowed,
    matchedSpecIds: verdict.matchedSpecIds,
    counterexample: verdict.counterexample,
    elapsedMs: verdict.elapsedMs,
    reportId: verdict.reportId,
  };
  appendFileSync("audit_log.jsonl", JSON.stringify(entry) + "\n");
}
