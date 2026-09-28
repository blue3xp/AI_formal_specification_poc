import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ModelVars } from "./model.js";

export interface SpecDef {
  id: string;
  description: string;
  forbid: string;
}

export interface SpecSet {
  specs: SpecDef[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadSpecs(): SpecSet {
  const specPath = join(__dirname, "../../specs/cloud_guard.json");
  const raw = readFileSync(specPath, "utf-8");
  return JSON.parse(raw) as SpecSet;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { type: "LPAREN" }
  | { type: "RPAREN" }
  | { type: "AND" }
  | { type: "OR" }
  | { type: "NOT" }
  | { type: "EQ" }
  | { type: "STRING"; value: string }
  | { type: "IDENT"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === " " || input[i] === "\t" || input[i] === "\n") {
      i++;
      continue;
    }
    if (input[i] === "(") { tokens.push({ type: "LPAREN" }); i++; continue; }
    if (input[i] === ")") { tokens.push({ type: "RPAREN" }); i++; continue; }
    if (input[i] === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== "'") j++;
      if (j >= input.length) throw new Error(`Unterminated string in spec: ${input}`);
      tokens.push({ type: "STRING", value: input.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[a-zA-Z_]/.test(input[i])) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_:.-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      if (word === "AND") tokens.push({ type: "AND" });
      else if (word === "OR") tokens.push({ type: "OR" });
      else if (word === "NOT") tokens.push({ type: "NOT" });
      else tokens.push({ type: "IDENT", value: word });
      i = j;
      continue;
    }
    if (input[i] === "=" && input[i + 1] === "=") {
      tokens.push({ type: "EQ" });
      i += 2;
      continue;
    }
    throw new Error(`Unexpected character '${input[i]}' in spec expression: ${input}`);
  }
  return tokens;
}

// ─── AST ─────────────────────────────────────────────────────────────────────

type AST =
  | { kind: "and"; left: AST; right: AST }
  | { kind: "or"; left: AST; right: AST }
  | { kind: "not"; operand: AST }
  | { kind: "eq"; left: AST; right: AST }
  | { kind: "ident"; name: string }
  | { kind: "string"; value: string };

// ─── Parser (recursive descent) ──────────────────────────────────────────────

function parse(tokens: Token[]): AST {
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function advance(): Token { return tokens[pos++]; }

  function parseOr(): AST {
    let left = parseAnd();
    while (peek()?.type === "OR") {
      advance();
      const right = parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  function parseAnd(): AST {
    let left = parseNot();
    while (peek()?.type === "AND") {
      advance();
      const right = parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  function parseNot(): AST {
    if (peek()?.type === "NOT") {
      advance();
      return { kind: "not", operand: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary(): AST {
    const t = peek();
    if (!t) throw new Error("Unexpected end of spec expression");

    if (t.type === "LPAREN") {
      advance();
      const expr = parseOr();
      if (peek()?.type !== "RPAREN") throw new Error("Missing closing parenthesis");
      advance();
      return expr;
    }

    if (t.type === "STRING") {
      advance();
      return { kind: "string", value: t.value };
    }

    if (t.type === "IDENT") {
      advance();
      if (peek()?.type === "EQ") {
        advance();
        const right = parsePrimary();
        return { kind: "eq", left: { kind: "ident", name: t.value }, right };
      }
      return { kind: "ident", name: t.value };
    }

    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }

  const result = parseOr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after end of expression: ${JSON.stringify(tokens[pos])}`);
  }
  return result;
}

// ─── Compiler: AST → Z3 Bool expression ──────────────────────────────────────

/**
 * Registered boolean predicate names → corresponding ModelVars fields
 */
const REGISTERED_PREDICATES: Record<string, keyof ModelVars> = {
  isProduction: "isProduction",
  isDeletionEffect: "isDeletionEffect",
  aclIsPublic: "aclIsPublic",
  postHasReleasePlan: "postHasReleasePlan",
  postReleaseDeletes: "postReleaseDeletes",
  aclApplied: "aclApplied",
  nameMatchesProd: "nameMatchesProd",
  envTagIsProduction: "envTagIsProduction",
  criticalityIsHigh: "criticalityIsHigh",
};

const ACTION_VARS: Record<string, keyof ModelVars> = {
  "ecs:SetScheduledRelease": "is_action_SetScheduledRelease",
  "ecs:DeleteInstance": "is_action_DeleteInstance",
  "ecs:DescribeInstances": "is_action_DescribeInstances",
  "oss:PutBucketAcl": "is_action_PutBucketAcl",
};

function compile(ast: AST, ctx: any, v: ModelVars): any {
  switch (ast.kind) {
    case "and":
      return ctx.And(compile(ast.left, ctx, v), compile(ast.right, ctx, v));
    case "or":
      return ctx.Or(compile(ast.left, ctx, v), compile(ast.right, ctx, v));
    case "not":
      return ctx.Not(compile(ast.operand, ctx, v));
    case "eq": {
      const left = compile(ast.left, ctx, v);
      const right = compile(ast.right, ctx, v);
      return left.eq(right);
    }
    case "ident": {
      const name = ast.name;
      if (name in REGISTERED_PREDICATES) {
        return v[REGISTERED_PREDICATES[name]];
      }
      if (name === "action") {
        // action is encoded as mutually exclusive boolean variables in Z3, not a direct Z3 variable
        throw new Error(`'action' cannot be used as a bare boolean; use action == 'value'`);
      }
      throw new Error(`Unknown identifier in spec: "${name}". Registered: ${Object.keys(REGISTERED_PREDICATES).join(", ")}`);
    }
    case "string":
      return ctx.Bool.val(ast.value);
  }
}

/**
 * Compile action == 'xxx' into the corresponding boolean variable
 * Special handling: when the left side of the equality is 'action', return the action boolean variable
 */
export function compileActionEq(actionValue: string, ctx: any, v: ModelVars): any {
  const varName = ACTION_VARS[actionValue];
  if (!varName) {
    // Unknown action: return a false constant (action not in the model)
    return ctx.Bool.val(false);
  }
  return v[varName];
}

/**
 * Compile a spec's forbid expression into a Z3 Bool expression
 */
export function compileSpec(spec: SpecDef, ctx: any, v: ModelVars): any {
  const tokens = tokenize(spec.forbid);
  const ast = parse(tokens);
  return compileWithActionEq(ast, ctx, v);
}

/**
 * Compile AST with special handling for action == 'xxx' patterns
 */
function compileWithActionEq(ast: AST, ctx: any, v: ModelVars): any {
  switch (ast.kind) {
    case "and":
      return ctx.And(compileWithActionEq(ast.left, ctx, v), compileWithActionEq(ast.right, ctx, v));
    case "or":
      return ctx.Or(compileWithActionEq(ast.left, ctx, v), compileWithActionEq(ast.right, ctx, v));
    case "not":
      return ctx.Not(compileWithActionEq(ast.operand, ctx, v));
    case "eq": {
      // Special handling: action == 'value'
      if (ast.left.kind === "ident" && ast.left.name === "action" && ast.right.kind === "string") {
        return compileActionEq(ast.right.value, ctx, v);
      }
      // Other equalities
      return compile(ast, ctx, v);
    }
    case "ident":
    case "string":
      return compile(ast, ctx, v);
  }
}
