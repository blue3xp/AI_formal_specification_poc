export interface Operation {
  readonly action: string;
  readonly resourceId: string;
  readonly resourceTags: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly region?: string;
}

export interface Verdict {
  readonly allowed: boolean;
  readonly reason: string;
  readonly counterexample: Record<string, unknown> | null;
  readonly matchedSpecIds: readonly string[];
  readonly solverResult: "sat" | "unsat" | "unknown" | "not-modeled";
  readonly elapsedMs: number;
  readonly reportId: string;
}
