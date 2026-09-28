import type { Operation } from "./types.js";

const DANGER_KEYWORDS = ["delete", "terminate", "destroy", "remove", "purge", "format"];

export interface FilterResult {
  readonly allowed: boolean;
  readonly reason: string;
}

export function keywordFilter(op: Operation): FilterResult {
  const actionLower = op.action.toLowerCase();
  for (const kw of DANGER_KEYWORDS) {
    if (actionLower.includes(kw)) {
      return {
        allowed: false,
        reason: `Action "${op.action}" contains dangerous keyword "${kw}"`,
      };
    }
  }
  return {
    allowed: true,
    reason: `Action "${op.action}" does not match any dangerous keyword`,
  };
}
