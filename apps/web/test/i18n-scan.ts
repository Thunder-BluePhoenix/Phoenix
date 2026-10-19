// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The scanner behind i18n-coverage.test.ts: finds user-visible text that is written into a component
// instead of coming from `t()`. It reads the syntax tree (never a regular expression over source), so
// comments, imports, class names and strings that are not shown are not reported.
import ts from "typescript";

export type FindingKind = "jsx-text" | "attribute" | "message-prop" | "message-call";

export interface Finding {
  kind: FindingKind;
  line: number;
  /** The text, whitespace collapsed. */
  text: string;
}

/** Attributes whose value a screen reader or a tooltip shows. */
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
]);

/** Props that carry an alert, toast or notice sentence to show. */
const MESSAGE_PROPS: ReadonlySet<string> = new Set([
  "error",
  "saved",
  "message",
  "notice",
  "toast",
  "alert",
  "success",
  "warning",
  "hint",
  "description",
  "tooltip",
  "helperText",
]);

/** Calls that show or store a sentence: `alert("…")`, `setError("…")`. */
const MESSAGE_CALLS: ReadonlySet<string> = new Set([
  "alert",
  "toast",
  "setError",
  "setNotice",
  "setMessage",
  "setSaved",
  "setToast",
  "setStatus",
]);

const hasLetters = (text: string) => /\p{L}/u.test(text.replace(/&#?\w+;/g, ""));
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Every piece of literal text an expression can show: its string branches, not its variables. */
function literals(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteralLike(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) out.push(span.literal.text);
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    literals(node.expression, out);
  } else if (ts.isConditionalExpression(node)) {
    literals(node.whenTrue, out);
    literals(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      if (op !== ts.SyntaxKind.AmpersandAmpersandToken) literals(node.left, out);
      literals(node.right, out);
    }
  }
}

function attributeValue(attr: ts.JsxAttribute): string[] {
  const out: string[] = [];
  const init = attr.initializer;
  if (!init) return out;
  if (ts.isStringLiteral(init)) out.push(init.text);
  else if (ts.isJsxExpression(init) && init.expression) literals(init.expression, out);
  return out;
}

/** Everything in `source` (a .tsx file) that shows English the user cannot translate. */
export function scanSource(fileName: string, source: string): Finding[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Finding[] = [];
  const add = (kind: FindingKind, node: ts.Node, text: string) => {
    if (!hasLetters(text)) return;
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push({ kind, line: line + 1, text: collapse(text) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      add("jsx-text", node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)) {
      // {"text"} or {cond && "text"} as a child shows text just like plain JSX text.
      const out: string[] = [];
      literals(node.expression, out);
      for (const text of out) add("jsx-text", node, text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      const kind = TEXT_ATTRIBUTES.has(name)
        ? "attribute"
        : MESSAGE_PROPS.has(name)
          ? "message-prop"
          : null;
      if (kind) for (const text of attributeValue(node)) add(kind, node, text);
    } else if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (MESSAGE_CALLS.has(callee) && node.arguments[0]) {
        const out: string[] = [];
        literals(node.arguments[0], out);
        for (const text of out) add("message-call", node, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The allow-list file: file path (relative to apps/web) or "*" → texts that are not translatable. */
export type Allowlist = Readonly<Record<string, readonly { text: string; reason: string }[]>>;

export function isAllowed(allow: Allowlist, file: string, finding: Finding): boolean {
  return [...(allow["*"] ?? []), ...(allow[file] ?? [])].some((a) => a.text === finding.text);
}

/** Findings of one file that are not in the allow-list. */
export function unlisted(allow: Allowlist, file: string, source: string): Finding[] {
  return scanSource(file, source).filter((f) => !isAllowed(allow, file, f));
}
