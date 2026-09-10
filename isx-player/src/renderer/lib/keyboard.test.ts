import { insertAtCursor, backspaceAtCursor, keyboardLayoutFor, keyRows } from "./keyboard";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

console.log("--- insertAtCursor ---");
{
  const r = insertAtCursor("hello", 5, 5, "!");
  check("appends at the end when cursor is at the end", r.value === "hello!" && r.selectionStart === 6 && r.selectionEnd === 6, JSON.stringify(r));
}
{
  const r = insertAtCursor("hello world", 5, 5, ",");
  check("inserts in the middle, cursor lands right after the inserted text", r.value === "hello, world" && r.selectionStart === 6, JSON.stringify(r));
}
{
  const r = insertAtCursor("hello world", 0, 5, "goodbye");
  check("inserting with an active selection replaces the selection", r.value === "goodbye world" && r.selectionStart === 7, JSON.stringify(r));
}
{
  const r = insertAtCursor("", 0, 0, "a");
  check("inserting into an empty field works", r.value === "a" && r.selectionStart === 1);
}
{
  const r = insertAtCursor("hello", 5, 5, "");
  check("inserting empty text is a no-op on value, cursor unchanged", r.value === "hello" && r.selectionStart === 5);
}

console.log("\n--- backspaceAtCursor ---");
{
  const r = backspaceAtCursor("hello", 5, 5);
  check("deletes the last character when cursor is at the end", r.value === "hell" && r.selectionStart === 4, JSON.stringify(r));
}
{
  const r = backspaceAtCursor("hello", 0, 0);
  check("backspace at position 0 is a safe no-op", r.value === "hello" && r.selectionStart === 0);
}
{
  const r = backspaceAtCursor("hello world", 0, 5);
  check("backspace with an active selection deletes the whole selection (not just one char)", r.value === " world" && r.selectionStart === 0, JSON.stringify(r));
}
{
  const r = backspaceAtCursor("hello", 2, 2);
  check("backspace in the middle removes the character just before the cursor", r.value === "hllo" && r.selectionStart === 1, JSON.stringify(r));
}

console.log("\n--- keyboardLayoutFor ---");
check("mode 'number' gets the numeric layout", keyboardLayoutFor("number") === "numeric");
check("mode 'email' gets the email layout", keyboardLayoutFor("email") === "email");
check("mode 'text' gets qwerty", keyboardLayoutFor("text") === "qwerty");
check("mode 'password' gets qwerty (still needs full alphabet)", keyboardLayoutFor("password") === "qwerty");
check("mode 'multiline' gets qwerty", keyboardLayoutFor("multiline") === "qwerty");
check("undefined mode defaults to qwerty", keyboardLayoutFor(undefined) === "qwerty");

console.log("\n--- keyRows ---");
check("qwerty lowercase rows", keyRows("qwerty", false).join("|") === "qwertyuiop|asdfghjkl|zxcvbnm");
check("qwerty uppercase (shift) rows", keyRows("qwerty", true).join("|") === "QWERTYUIOP|ASDFGHJKL|ZXCVBNM");
check("numeric rows ignore shift state", keyRows("numeric", true).join("|") === keyRows("numeric", false).join("|"));
check("numeric rows contain 0-9", keyRows("numeric", false).join("").split("").sort().join("") === "0123456789".split("").sort().join(""));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
