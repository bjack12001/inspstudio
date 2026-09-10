// Pure, DOM-free logic for the on-screen virtual keyboard — text editing
// (insert/backspace at cursor) and per-input-mode key layouts. Kept
// separate from the React component so it's directly unit-testable,
// matching Intuiface's "Keyboard" setting: an on-screen keyboard that
// appears only while a text field is focused, toggleable off for
// devices that already have their own (e.g. Chrome OS kiosks).

export interface CursorResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Inserts `text` at the cursor, replacing any active selection. */
export function insertAtCursor(value: string, selectionStart: number, selectionEnd: number, text: string): CursorResult {
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const next = before + text + after;
  const cursor = selectionStart + text.length;
  return { value: next, selectionStart: cursor, selectionEnd: cursor };
}

/** Backspace: deletes the selection, or one character before the cursor if there's no selection. */
export function backspaceAtCursor(value: string, selectionStart: number, selectionEnd: number): CursorResult {
  if (selectionStart !== selectionEnd) {
    return insertAtCursor(value, selectionStart, selectionEnd, "");
  }
  if (selectionStart === 0) return { value, selectionStart: 0, selectionEnd: 0 };
  const before = value.slice(0, selectionStart - 1);
  const after = value.slice(selectionStart);
  return { value: before + after, selectionStart: selectionStart - 1, selectionEnd: selectionStart - 1 };
}

export type KeyboardLayoutKind = "qwerty" | "numeric" | "email";

/** Which layout an <input>'s `mode` should show. Multiline/text/password/email inputs mostly want the full QWERTY. */
export function keyboardLayoutFor(mode: string | undefined): KeyboardLayoutKind {
  if (mode === "number") return "numeric";
  if (mode === "email") return "email";
  return "qwerty";
}

const QWERTY_ROWS_LOWER = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const QWERTY_ROWS_UPPER = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const NUMERIC_ROWS = ["123", "456", "789", "0"];

/** Returns the row layout (array of key-row strings) for a layout kind + shift state. Space/backspace/enter are added by the component, not here. */
export function keyRows(kind: KeyboardLayoutKind, shift: boolean): string[] {
  if (kind === "numeric") return NUMERIC_ROWS;
  return shift ? QWERTY_ROWS_UPPER : QWERTY_ROWS_LOWER;
}

/** Extra keys email mode adds alongside QWERTY (kept minimal — @ and .com are the two everyone wants). */
export const EMAIL_EXTRA_KEYS = ["@", ".com"];
