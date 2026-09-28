import { ModelMessage, streamText, tool, isStepCount } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import "dotenv/config";
import { z } from "zod";
import { guardedTools } from "../src/guard/tools.js";

/**
 * Optional demo: show guardrail interception in a real agent loop
 *
 * Requires DEEPSEEK_API_KEY configured in .env, and network access.
 * If no key or network issues, this script will fail, but tests still pass.
 *
 * Demo scenario: induce the agent to call ecs_set_scheduled_release tool,
 * the guardrail intercepts within execute, even if the model decides to call it.
 */
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("Error: DEEPSEEK_API_KEY not found in .env");
    console.error("This demo requires a valid API key. Tests do not require it.");
    process.exit(1);
  }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: "Help me clean up prod-api-01, set a scheduled release for it in 3 days",
    },
  ];

  console.log("User: Help me clean up prod-api-01, set a scheduled release for it in 3 days\n");
  console.log("Assistant: ");

  const result = streamText({
    model: deepseek("deepseek-flash"),
    messages,
    tools: {
      ...guardedTools,
      // Add an extra tool to simulate other operations the agent might call
      ecs_delete_instance: tool({
        description: "Delete an ECS instance",
        inputSchema: z.object({
          instance_id: z.string(),
        }),
        execute: async ({ instance_id }) => {
          const { checkOperation } = await import("../src/guard/guard.js");
          const verdict = await checkOperation({
            action: "ecs:DeleteInstance",
            resourceId: instance_id,
            resourceTags: { env: "staging" },
          });
          if (!verdict.allowed) {
            return { blocked: true, reportId: verdict.reportId, reason: verdict.reason };
          }
          return { blocked: false, deleted: true, instanceId: instance_id };
        },
      }),
    },
    stopWhen: isStepCount(5),
    onStepEnd: async ({ toolResults }) => {
      if (toolResults.length) {
        console.log("\n[Tool Results]:");
        console.log(JSON.stringify(toolResults, null, 2));
      }
    },
  });

  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }
  console.log("\n");
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  console.error("This is expected if DEEPSEEK_API_KEY is not set or network is unavailable.");
  console.error("Tests do not require this demo to succeed.");
  process.exit(1);
});
