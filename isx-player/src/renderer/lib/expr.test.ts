import { evalExpr } from "./expr";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

// ---- existing arithmetic/logic still work after the parser restructure ----
const baseline: [string, Record<string, any>, any][] = [
  ["'Taps: ' + count", { count: 3 }, "Taps: 3"],
  ["count + 1", { count: 3 }, 4],
  ["count > 5 ? 'big' : 'small'", { count: 9 }, "big"],
  ["(count + 2) * 3", { count: 1 }, 9],
];
console.log("--- baseline arithmetic (regression check) ---");
for (const [src, scope, want] of baseline) {
  const got = evalExpr(src, scope);
  check(`baseline: ${src}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
}

console.log("\n--- Math & Logic converter functions ---");
check("round(x) with no decimals", evalExpr("round(4.6)", {}) === 5);
check("round(x, decimals)", evalExpr("round(3.14159, 2)", {}) === 3.14);
check("floor()", evalExpr("floor(4.9)", {}) === 4);
check("ceil()", evalExpr("ceil(4.1)", {}) === 5);
check("abs() on a negative", evalExpr("abs(-7)", {}) === 7);
check("min() across multiple args", evalExpr("min(5, 2, 8)", {}) === 2);
check("max() across multiple args", evalExpr("max(5, 2, 8)", {}) === 8);
check("functions compose with variables from scope", evalExpr("round(price * 1.2, 2)", { price: 10 }) === 12);

console.log("\n--- Linear converter (Intuiface's 'Linear' value converter) ---");
check("linear() maps 0-100 input to 0-1 output at midpoint", evalExpr("linear(50, 0, 100, 0, 1)", {}) === 0.5);
check("linear() maps to an inverted output range correctly", evalExpr("linear(25, 0, 100, 100, 0)", {}) === 75);
check("linear() throws a clear error when inMin===inMax", (() => { try { evalExpr("linear(5, 10, 10, 0, 1)", {}); return false; } catch (e) { return String(e).includes("must differ"); } })());

console.log("\n--- Number Format converter ---");
check("toFixed() matches JS semantics (returns a string)", evalExpr("toFixed(3.14159, 2)", {}) === "3.14");
check("numberFormat() with prefix/suffix", evalExpr("numberFormat(19.5, 2, '$', ' USD')", {}) === "$19.50 USD");
check("numberFormat() with defaults (no prefix/suffix)", evalExpr("numberFormat(7, 0)", {}) === "7");

console.log("\n--- Text Manipulation converter ---");
check("upper()", evalExpr("upper('hello')", {}) === "HELLO");
check("lower()", evalExpr("lower('WORLD')", {}) === "world");
check("trim()", evalExpr("trim('  padded  ')", {}) === "padded");
check("concat() joins multiple values, coercing non-strings", evalExpr("concat('Count: ', count, ' items')", { count: 5 }) === "Count: 5 items");
check("substring()", evalExpr("substring('Hello World', 0, 5)", {}) === "Hello");
check("replace()", evalExpr("replace('foo-bar-foo', 'foo', 'baz')", {}) === "baz-bar-baz");
check("text functions compose with member access", evalExpr("upper(data.name)", { data: { name: "melvyn" } }) === "MELVYN");

console.log("\n--- Date Format converter ---");
const fixedDate = new Date(2026, 8, 8, 14, 30, 5).getTime(); // Sep 8 2026, 14:30:05 local
check("dateFormat() with YYYY-MM-DD", evalExpr("dateFormat(ts, 'YYYY-MM-DD')", { ts: fixedDate }) === "2026-09-08");
check("dateFormat() with time tokens", evalExpr("dateFormat(ts, 'HH:mm:ss')", { ts: fixedDate }) === "14:30:05");
check("dateFormat() rejects an unparseable value with a clear error", (() => { try { evalExpr("dateFormat('not a date', 'YYYY')", {}); return false; } catch (e) { return String(e).includes("could not parse"); } })());
check("now() returns a number (current timestamp)", typeof evalExpr("now()", {}) === "number");

console.log("\n--- error handling for unknown/malformed calls ---");
check("calling an unknown function name throws a clear, listable error", (() => { try { evalExpr("bogus(1,2)", {}); return false; } catch (e) { return String(e).includes('unknown function "bogus'); } })());
check("a call missing its closing paren throws a parse error, not a crash", (() => { try { evalExpr("round(1, 2", {}); return false; } catch { return true; } })());

console.log("\n--- nested / composed converter calls (realistic authoring use) ---");
check("nesting text + number converters", evalExpr("concat(upper(name), ': $', toFixed(price, 2))", { name: "widget", price: 9.5 }) === "WIDGET: $9.50");
check("linear feeding into round", evalExpr("round(linear(value, 0, 10, 0, 100))", { value: 3.4 }) === 34);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
