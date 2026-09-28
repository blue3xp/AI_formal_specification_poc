import type { Operation } from "./types.js";

export interface ModelVars {
  is_action_SetScheduledRelease: any;
  is_action_DeleteInstance: any;
  is_action_DescribeInstances: any;
  is_action_PutBucketAcl: any;
  postHasReleasePlan: any;
  postReleaseDeletes: any;
  aclApplied: any;
  isDeletionEffect: any;
  isProduction: any;
  nameMatchesProd: any;
  envTagIsProduction: any;
  criticalityIsHigh: any;
  aclIsPublic: any;
}

export function createModelVars(ctx: any): ModelVars {
  return {
    is_action_SetScheduledRelease: ctx.Bool.const("is_action_SetScheduledRelease"),
    is_action_DeleteInstance: ctx.Bool.const("is_action_DeleteInstance"),
    is_action_DescribeInstances: ctx.Bool.const("is_action_DescribeInstances"),
    is_action_PutBucketAcl: ctx.Bool.const("is_action_PutBucketAcl"),
    postHasReleasePlan: ctx.Bool.const("postHasReleasePlan"),
    postReleaseDeletes: ctx.Bool.const("postReleaseDeletes"),
    aclApplied: ctx.Bool.const("aclApplied"),
    isDeletionEffect: ctx.Bool.const("isDeletionEffect"),
    isProduction: ctx.Bool.const("isProduction"),
    nameMatchesProd: ctx.Bool.const("nameMatchesProd"),
    envTagIsProduction: ctx.Bool.const("envTagIsProduction"),
    criticalityIsHigh: ctx.Bool.const("criticalityIsHigh"),
    aclIsPublic: ctx.Bool.const("aclIsPublic"),
  };
}

/**
 * Semantic axioms: express "action → post-state" using Implies
 *
 * These axioms encode domain knowledge symbolically:
 * - SetScheduledRelease creates a release plan, and a release plan eventually deletes the instance
 * - DeleteInstance directly deletes the instance
 * - DescribeInstances is a read-only operation with no side effects
 * - PutBucketAcl applies an ACL configuration
 */
export function getModelAxioms(ctx: any, v: ModelVars): any[] {
  const { Implies, And, Not, Or } = ctx;

  return [
    // SetScheduledRelease → creates release plan ∧ release plan deletes instance
    Implies(v.is_action_SetScheduledRelease, And(v.postHasReleasePlan, v.postReleaseDeletes)),

    // DeleteInstance → deletes instance
    Implies(v.is_action_DeleteInstance, v.postReleaseDeletes),

    // DescribeInstances → no deletion effect ∧ no release plan
    Implies(v.is_action_DescribeInstances, And(Not(v.postReleaseDeletes), Not(v.postHasReleasePlan))),

    // PutBucketAcl → ACL is applied
    Implies(v.is_action_PutBucketAcl, v.aclApplied),

    // Derived predicate: deletion effect = release deletes ∨ direct deletion
    v.isDeletionEffect.eq(Or(v.postReleaseDeletes, v.is_action_DeleteInstance)),

    // Derived predicate: production resource = env tag is production ∨ name starts with prod- ∨ high criticality
    v.isProduction.eq(Or(v.envTagIsProduction, v.nameMatchesProd, v.criticalityIsHigh)),
  ];
}

/**
 * Observed facts: assert the concrete attributes of the current operation as true
 *
 * Design tradeoff: nameMatchesProd and envTagIsProduction are pre-computed in JS
 * and asserted into the solver. This is "concrete fact assertion" rather than
 * "symbolic derivation", but the solver still independently determines whether
 * the forbidden condition is satisfiable. See README limitations section.
 */
export function getObservedFacts(ctx: any, v: ModelVars, op: Operation): any[] {
  const facts: any[] = [];

  // Action facts: assert the current action in a mutually exclusive way
  facts.push(v.is_action_SetScheduledRelease.eq(op.action === "ecs:SetScheduledRelease"));
  facts.push(v.is_action_DeleteInstance.eq(op.action === "ecs:DeleteInstance"));
  facts.push(v.is_action_DescribeInstances.eq(op.action === "ecs:DescribeInstances"));
  facts.push(v.is_action_PutBucketAcl.eq(op.action === "oss:PutBucketAcl"));

  // Resource name fact: whether it starts with prod-
  const nameMatches = op.resourceId.startsWith("prod-");
  facts.push(v.nameMatchesProd.eq(nameMatches));

  // Environment tag fact
  const envIsProd = op.resourceTags.env === "production";
  facts.push(v.envTagIsProduction.eq(envIsProd));

  // Criticality tag fact (defaults to false)
  const critIsHigh = op.resourceTags.criticality === "high";
  facts.push(v.criticalityIsHigh.eq(critIsHigh));

  // ACL public-read fact
  const aclIsPublic = op.params?.acl === "public-read";
  facts.push(v.aclIsPublic.eq(aclIsPublic));

  return facts;
}

/**
 * Check whether an action is covered by the semantic model
 */
export function isActionModeled(action: string): boolean {
  const modeledActions = [
    "ecs:SetScheduledRelease",
    "ecs:DeleteInstance",
    "ecs:DescribeInstances",
    "oss:PutBucketAcl",
  ];
  return modeledActions.includes(action);
}
