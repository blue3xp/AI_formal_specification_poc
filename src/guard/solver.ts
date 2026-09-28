import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const z3Solver = require("z3-solver");

let z3Context: Awaited<ReturnType<typeof z3Solver.init>>["Context"] | null = null;
let z3Binding: Awaited<ReturnType<typeof z3Solver.init>> | null = null;

export async function getZ3() {
  if (!z3Context || !z3Binding) {
    const binding = await z3Solver.init();
    z3Binding = binding;
    z3Context = new binding.Context("main");
  }
  return { Context: z3Context, binding: z3Binding };
}
