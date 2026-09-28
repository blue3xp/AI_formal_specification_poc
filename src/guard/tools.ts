import { tool } from "ai";
import { z } from "zod";
import { checkOperation } from "./guard.js";

export const guardedTools = {
  ecs_set_scheduled_release: tool({
    description: "Set a scheduled release time for an ECS instance",
    inputSchema: z.object({
      instance_id: z.string().describe("ECS instance name, e.g. prod-api-01"),
      release_after_days: z.number().int().positive().describe("Number of days after which the instance will be released"),
    }),
    execute: async ({ instance_id, release_after_days }) => {
      const verdict = await checkOperation({
        action: "ecs:SetScheduledRelease",
        resourceId: instance_id,
        resourceTags: inferTags(instance_id),
        params: { release_after_days },
      });

      if (!verdict.allowed) {
        return {
          blocked: true,
          reportId: verdict.reportId,
          reason: verdict.reason,
          matchedSpecIds: verdict.matchedSpecIds,
        };
      }

      // Simulate side effect: create release plan
      return {
        blocked: false,
        releasePlanId: `rel-${Date.now()}`,
        instanceId: instance_id,
        releaseAfterDays: release_after_days,
        reportId: verdict.reportId,
      };
    },
  }),

  ecs_describe_instances: tool({
    description: "Describe ECS instances (read-only, safe operation)",
    inputSchema: z.object({
      instance_id: z.string().describe("ECS instance name to describe, e.g. prod-api-01"),
    }),
    execute: async ({ instance_id }) => {
      const verdict = await checkOperation({
        action: "ecs:DescribeInstances",
        resourceId: instance_id,
        resourceTags: inferTags(instance_id),
      });

      if (!verdict.allowed) {
        return {
          blocked: true,
          reportId: verdict.reportId,
          reason: verdict.reason,
        };
      }

      // Simulate returning instance info
      return {
        blocked: false,
        instance: {
          instanceId: instance_id,
          status: "running",
          cpu: "2 vCPU",
          memory: "4 GB",
          tags: inferTags(instance_id),
        },
        reportId: verdict.reportId,
      };
    },
  }),
};

/**
 * Infer tags from instance name (simulated)
 * In a real scenario, tags come from CMDB or cloud API
 */
function inferTags(instanceId: string): Record<string, string> {
  // Simple simulation: instances with prod- prefix default to env=staging tag (for testing tag disguise scenarios)
  if (instanceId.startsWith("prod-")) {
    return { env: "staging" };
  }
  if (instanceId.startsWith("dev-")) {
    return { env: "development" };
  }
  return {};
}
