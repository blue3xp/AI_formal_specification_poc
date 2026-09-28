import { ModelMessage, streamText, tool, isStepCount } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import "dotenv/config";
import { z } from "zod";
import * as readline from "node:readline/promises";
import { guardedTools } from "./src/guard/tools.js";

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages: ModelMessage[] = [];

async function main() {
  while (true) {
    const userInput = await terminal.question("You: ");

    messages.push({ role: "user", content: userInput });

    const result = streamText({
      model: deepseek("deepseek-flash"),
      messages,
      tools: {
        weather: tool({
          description: "Get the weather in a location (fahrenheit)",
          inputSchema: z.object({
            location: z
              .string()
              .describe("The location to get the weather for"),
          }),
          execute: async ({ location }) => {
            const temperature = Math.round(Math.random() * (90 - 32) + 32);
            return {
              location,
              temperature,
            };
          },
        }),
        convertFahrenheitToCelsius: tool({
          description: "Convert a temperature in fahrenheit to celsius",
          inputSchema: z.object({
            temperature: z
              .number()
              .describe("The temperature in fahrenheit to convert"),
          }),
          execute: async ({ temperature }) => {
            const celsius = Math.round((temperature - 32) * (5 / 9));
            return {
              celsius,
            };
          },
        }),
        ...guardedTools,
      },
      stopWhen: isStepCount(5),
      onStepEnd: async ({ toolResults }) => {
        if (toolResults.length) {
          console.log(JSON.stringify(toolResults, null, 2));
        }
      },
    });

    let fullResponse = "";
    process.stdout.write("\nAssistant: ");
    for await (const delta of result.textStream) {
      fullResponse += delta;
      process.stdout.write(delta);
    }
    process.stdout.write("\n\n");

    messages.push({ role: "assistant", content: fullResponse });
  }
}

main().catch(console.error);
