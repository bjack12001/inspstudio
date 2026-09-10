// Eval-free expression tokenizer/parser/evaluator for .isx bindings and
// expr actions. No `eval`/`new Function` involved — a real tokenizer +
// Pratt parser + tree-walking evaluator. Extended with a small curated
// set of built-in function calls (round/toFixed/upper/lower/trim/dateFormat/
// linear/etc.) so no-code "value converters" (Number Format, Text
// Manipulation, Date Format, Linear, Math & Logic) can be expressed as
// plain expression strings rather than needing a separate runtime concept.

type Tok = { t: "num" | "str" | "bool" | "null" | "id" | "op" | "eof"; v?: string | number | boolean | null };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const two = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||"];
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { s += src[j]; j++; }
      toks.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i, s = "";
      while (j < src.length && /[0-9.]/.test(src[j])) { s += src[j]; j++; }
      toks.push({ t: "num", v: parseFloat(s) }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i, s = "";
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) { s += src[j]; j++; }
      if (s === "true") toks.push({ t: "bool", v: true });
      else if (s === "false") toks.push({ t: "bool", v: false });
      else if (s === "null") toks.push({ t: "null", v: null });
      else toks.push({ t: "id", v: s });
      i = j; continue;
    }
    if (src.substr(i, 3) === "===" || src.substr(i, 3) === "!==") { toks.push({ t: "op", v: src.substr(i, 3) }); i += 3; continue; }
    const p2 = two.find((o) => src.substr(i, 2) === o);
    if (p2) { toks.push({ t: "op", v: p2 }); i += 2; continue; }
    if ("+-*/%<>!().?:,".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`unexpected character "${c}" in expression: ${src}`);
  }
  toks.push({ t: "eof" });
  return toks;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "===": 3, "!==": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

type Node =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "member"; o: Node; name: string }
  | { k: "un"; op: string; e: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "bin"; op: string; left: Node; right: Node }
  | { k: "call"; name: string; args: Node[] };

function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function parseExpr(): Node {
    const cond = parseBinary(0);
    if (peek().t === "op" && peek().v === "?") {
      next();
      const a = parseExpr();
      if (!(peek().t === "op" && peek().v === ":")) throw new Error("expected ':' in ternary expression");
      next();
      const b = parseExpr();
      return { k: "cond", c: cond, a, b };
    }
    return cond;
  }
  function parseBinary(min: number): Node {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.t === "op" && typeof t.v === "string" && PREC[t.v] !== undefined && PREC[t.v] >= min) {
        const op = next().v as string;
        const right = parseBinary(PREC[op] + 1);
        left = { k: "bin", op, left, right };
      } else break;
    }
    return left;
  }
  function parseUnary(): Node {
    const t = peek();
    if (t.t === "op" && (t.v === "!" || t.v === "-")) { next(); return { k: "un", op: t.v as string, e: parseUnary() }; }
    return parsePostfix();
  }
  function parsePostfix(): Node {
    let e = parsePrimary();
    while (peek().t === "op" && peek().v === ".") { next(); const id = next(); e = { k: "member", o: e, name: String(id.v) }; }
    return e;
  }
  function parseArgs(): Node[] {
    const args: Node[] = [];
    if (peek().t === "op" && peek().v === ")") return args;
    args.push(parseExpr());
    while (peek().t === "op" && peek().v === ",") { next(); args.push(parseExpr()); }
    return args;
  }
  function parsePrimary(): Node {
    const t = next();
    if (t.t === "num" || t.t === "str" || t.t === "bool") return { k: "lit", v: t.v };
    if (t.t === "null") return { k: "lit", v: null };
    if (t.t === "id") {
      const name = String(t.v);
      if (peek().t === "op" && peek().v === "(") {
        next();
        const args = parseArgs();
        if (!(peek().t === "op" && peek().v === ")")) throw new Error(`expected ')' closing call to ${name}(...)`);
        next();
        return { k: "call", name, args };
      }
      return { k: "id", name };
    }
    if (t.t === "op" && t.v === "(") { const e = parseExpr(); if (!(peek().v === ")")) throw new Error("expected ')'"); next(); return e; }
    throw new Error(`unexpected token in expression`);
  }
  return parseExpr();
}

// ---- curated built-in function library (converters) ----
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new Error(`dateFormat: could not parse "${v}" as a date`);
  return d;
}

/** Supports YYYY, MM, DD, HH, mm, ss tokens — deliberately small, not a full strftime. */
function formatDate(d: Date, pattern: string): string {
  return pattern
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad2(d.getMonth() + 1))
    .replace(/DD/g, pad2(d.getDate()))
    .replace(/HH/g, pad2(d.getHours()))
    .replace(/mm/g, pad2(d.getMinutes()))
    .replace(/ss/g, pad2(d.getSeconds()));
}

const BUILTINS: Record<string, (...args: any[]) => any> = {
  // Math & Logic
  round: (x: number, decimals = 0) => { const f = Math.pow(10, decimals); return Math.round(x * f) / f; },
  floor: (x: number) => Math.floor(x),
  ceil: (x: number) => Math.ceil(x),
  abs: (x: number) => Math.abs(x),
  min: (...xs: number[]) => Math.min(...xs),
  max: (...xs: number[]) => Math.max(...xs),
  // Linear (maps a value from one range to another — Intuiface's "Linear" converter)
  linear: (x: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
    if (inMax === inMin) throw new Error("linear: inMin and inMax must differ");
    return ((x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
  },
  // Number Format
  toFixed: (x: number, decimals = 0) => Number(x).toFixed(decimals),
  numberFormat: (x: number, decimals = 0, prefix = "", suffix = "") => `${prefix}${Number(x).toFixed(decimals)}${suffix}`,
  // Text Manipulation
  upper: (s: unknown) => String(s).toUpperCase(),
  lower: (s: unknown) => String(s).toLowerCase(),
  trim: (s: unknown) => String(s).trim(),
  concat: (...parts: unknown[]) => parts.map(String).join(""),
  substring: (s: unknown, start: number, end?: number) => String(s).substring(start, end),
  replace: (s: unknown, find: string, repl: string) => String(s).split(find).join(repl),
  // Date Format
  dateFormat: (v: unknown, pattern: string) => formatDate(toDate(v), pattern),
  now: () => Date.now(),
};

function evalNode(n: Node, scope: Record<string, any>): any {
  switch (n.k) {
    case "lit": return n.v;
    case "id": return scope[n.name];
    case "member": { const o = evalNode(n.o, scope); return o == null ? undefined : o[n.name]; }
    case "un": { const v = evalNode(n.e, scope); return n.op === "!" ? !v : -v; }
    case "cond": return evalNode(n.c, scope) ? evalNode(n.a, scope) : evalNode(n.b, scope);
    case "bin": {
      const a = evalNode(n.left, scope), b = evalNode(n.right, scope);
      switch (n.op) {
        case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "%": return a % b;
        case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b;
        case "==": return a == b; case "!=": return a != b; case "===": return a === b; case "!==": return a !== b;
        case "&&": return a && b; case "||": return a || b;
      }
      break;
    }
    case "call": {
      const fn = BUILTINS[n.name];
      if (!fn) throw new Error(`unknown function "${n.name}(...)" in expression — allowed: ${Object.keys(BUILTINS).join(", ")}`);
      const args = n.args.map((a) => evalNode(a, scope));
      return fn(...args);
    }
  }
}

export function evalExpr(src: string, scope: Record<string, any>): any {
  return evalNode(parse(tokenize(src)), scope);
}

export function evalValue(exprObj: { value?: unknown; expr?: string } | undefined, scope: Record<string, any>): unknown {
  if (!exprObj) return undefined;
  if ("value" in exprObj) return exprObj.value;
  if ("expr" in exprObj && exprObj.expr) return evalExpr(exprObj.expr, scope);
  return undefined;
}
