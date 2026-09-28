import { describe, it, expect, beforeAll } from "vitest";
import { checkOperation } from "../src/guard/guard.js";
import { keywordFilter } from "../src/guard/keywordFilter.js";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type { Operation } from "../src/guard/types.js";

// Clean up audit log from tests
const AUDIT_LOG = "audit_log.jsonl";
beforeAll(() => {
  if (existsSync(AUDIT_LOG)) {
    unlinkSync(AUDIT_LOG);
  }
});

describe("Formal Verification Guard", () => {
  it("Proposition 1: Semantic derivation - SetScheduledRelease on prod-api-01 should be rejected with S-0101", async () => {
    const op: Operation = {
      action: "ecs:SetScheduledRelease",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
      params: { release_after_days: 3 },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(false);
    expect(verdict.matchedSpecIds).toContain("S-0101");
    expect(verdict.solverResult).toBe("sat");
    // Reason must reflect semantic derivation: scheduled release → release plan → deletion effect
    expect(verdict.reason).toMatch(/release plan|deletion/i);
    expect(verdict.counterexample).not.toBeNull();
    expect(verdict.counterexample?.isProduction).toBe(true);
    expect(verdict.counterexample?.isDeletionEffect).toBe(true);
  });

  it("Proposition 2: Formal method outperforms keyword filter - keywordFilter allows SetScheduledRelease, guard rejects", async () => {
    const op: Operation = {
      action: "ecs:SetScheduledRelease",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
    };

    const kf = keywordFilter(op);
    const gv = await checkOperation(op);

    // Keyword filter allows (SetScheduledRelease doesn't contain delete/terminate keywords)
    expect(kf.allowed).toBe(true);
    // Formal guard rejects (semantic derivation discovers deletion effect)
    expect(gv.allowed).toBe(false);
    expect(gv.matchedSpecIds).toContain("S-0101");
  });

  it("Proposition 3: Allow means proof - DescribeInstances on prod-api-01 allowed with unsat", async () => {
    const op: Operation = {
      action: "ecs:DescribeInstances",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(true);
    // unsat = forbidden condition cannot hold under the model (safety proof), not "rule didn't match"
    expect(verdict.solverResult).toBe("unsat");
    expect(verdict.counterexample).toBeNull();
  });

  it("Proposition 4: Tag disguise cannot defeat derivation - DeleteInstance on prod-api-01 with env=staging still rejected", async () => {
    const op: Operation = {
      action: "ecs:DeleteInstance",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" }, // Disguised as staging, but resource name prefix prod- already triggers production condition
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(false);
    expect(verdict.matchedSpecIds).toContain("S-0101");
    expect(verdict.counterexample?.isProduction).toBe(true);
    expect(verdict.counterexample?.nameMatchesProd).toBe(true);
    // env tag is not production, but resource name prefix is sufficient
    expect(verdict.counterexample?.envTagIsProduction).toBe(false);
  });

  it("Proposition 5: Unknown action fail-closed - unknown action rejected with not-modeled", async () => {
    const op: Operation = {
      action: "ecs:UnknownAction",
      resourceId: "dev-sandbox-01",
      resourceTags: { env: "development" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(false);
    expect(verdict.solverResult).toBe("not-modeled");
    expect(verdict.reason).toMatch(/not covered|unknown/i);
  });

  it("Proposition 6: Rejection is explainable + auditable - rejection has counterexample and audit log entry", async () => {
    const op: Operation = {
      action: "ecs:SetScheduledRelease",
      resourceId: "prod-api-01",
      resourceTags: { env: "staging" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(false);
    expect(verdict.counterexample).not.toBeNull();
    expect(verdict.counterexample?.isProduction).toBe(true);
    expect(verdict.counterexample?.isDeletionEffect).toBe(true);
    expect(verdict.reportId).toMatch(/^GR-\d{5}$/);

    // Check audit log
    expect(existsSync(AUDIT_LOG)).toBe(true);
    const lines = readFileSync(AUDIT_LOG, "utf-8").trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.reportId).toBe(verdict.reportId);
    expect(lastEntry.allowed).toBe(false);
    expect(lastEntry.matchedSpecIds).toContain("S-0101");
    expect(lastEntry.counterexample).toBeDefined();
    expect(lastEntry.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(lastEntry.timestamp).toBeDefined();
  });
});

describe("Additional scenarios", () => {
  it("DeleteInstance on non-production resource should be allowed", async () => {
    const op: Operation = {
      action: "ecs:DeleteInstance",
      resourceId: "dev-sandbox-01",
      resourceTags: { env: "development" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(true);
    expect(verdict.solverResult).toBe("unsat");
  });

  it("PutBucketAcl with public-read should be rejected (S-0208)", async () => {
    const op: Operation = {
      action: "oss:PutBucketAcl",
      resourceId: "my-bucket",
      resourceTags: {},
      params: { acl: "public-read" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(false);
    expect(verdict.matchedSpecIds).toContain("S-0208");
    expect(verdict.counterexample?.aclIsPublic).toBe(true);
  });

  it("PutBucketAcl with private should be allowed", async () => {
    const op: Operation = {
      action: "oss:PutBucketAcl",
      resourceId: "my-bucket",
      resourceTags: {},
      params: { acl: "private" },
    };

    const verdict = await checkOperation(op);

    expect(verdict.allowed).toBe(true);
    expect(verdict.solverResult).toBe("unsat");
  });
});
