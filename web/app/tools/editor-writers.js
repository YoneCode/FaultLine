// Source writers used by the editor plugin. Each one takes a change from the
// browser and produces a modified file — or an explicit refusal. Nothing here
// guesses: an edit that cannot be placed unambiguously is reported back so the
// panel can show a conflict instead of silently rewriting the wrong line.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { replaceText } from "./editor-normalize.js";

const SOURCE_EXT = new Set([".jsx", ".js"]);

export function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (SOURCE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

/* ── text ───────────────────────────────────────────────────────────────── */

/**
 * Find the one source file holding `original` and swap in `next`.
 * A string that appears in two files, or twice in one, is a conflict — the
 * caller is told where the collisions are rather than having one picked for it.
 */
export function applyTextEdit(srcDir, original, next) {
  const matches = [];
  for (const file of listSourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    const result = replaceText(source, original, next);
    if (result.ok) matches.push({ file, source: result.source });
    else if (result.reason === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous",
        detail: `appears ${result.count}× in ${path.basename(file)}`,
      };
    }
  }
  if (matches.length === 0) {
    return { ok: false, reason: "not-found", detail: "no source file contains this text" };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      detail: `appears in ${matches.length} files: ${matches.map((m) => path.basename(m.file)).join(", ")}`,
    };
  }
  return { ok: true, file: matches[0].file, source: matches[0].source };
}

/* ── css ────────────────────────────────────────────────────────────────── */

/**
 * Blank out comments while preserving every offset, so parsing sees neither the
 * braces inside a comment nor the comment text that would otherwise be swept up
 * into the following selector.
 */
function maskComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

/**
 * Walk the stylesheet tracking brace depth so rules nested in @media are
 * distinguishable from top-level ones. Returns each rule's selector text and the
 * offsets of its body. Offsets index the original stylesheet.
 */
function parseRules(source) {
  const css = maskComments(source);
  const rules = [];
  let depth = 0;
  let selStart = 0;
  const open = [];
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      const selector = css.slice(selStart, i).trim();
      open.push({ selector, bodyStart: i + 1, depth });
      depth++;
    } else if (ch === "}") {
      depth--;
      const frame = open.pop();
      if (frame && !frame.selector.startsWith("@")) {
        rules.push({ ...frame, bodyEnd: i });
      }
      selStart = i + 1;
    } else if (ch === ";" && depth === 0) {
      selStart = i + 1;
    }
    if (ch === "}" || ch === "{") selStart = i + 1;
  }
  return rules;
}

const normalizeSelector = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Set `property` inside the rule for `selector`. Only top-level rules are
 * targeted — a matching rule inside a media query is a responsive override and
 * changing it from the inspector would surprise. Adds the declaration if the
 * rule exists but does not set that property yet.
 */
export function setDeclaration(css, selector, property, value) {
  const wanted = normalizeSelector(selector);
  const candidates = parseRules(css).filter(
    (r) => r.depth === 0 && normalizeSelector(r.selector) === wanted,
  );
  if (candidates.length === 0) {
    return { ok: false, reason: "no-rule", detail: `no top-level rule for ${selector}` };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "ambiguous", detail: `${selector} is declared ${candidates.length}×` };
  }

  const rule = candidates[0];
  const body = css.slice(rule.bodyStart, rule.bodyEnd);
  // Match the property only where a declaration can start, so `font-size` does
  // not match inside `--x: font-size` or a longhand like `-webkit-font-size`.
  // Searched against a comment-masked copy so a commented-out declaration is not
  // mistaken for the live one; offsets are identical, so they apply to `body`.
  const decl = new RegExp(`(^|[;{\\s])(${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*:([^;}]*)`, "i");
  const found = decl.exec(maskComments(body));

  let nextBody;
  if (found) {
    const valueStart = found.index + found[0].length - found[3].length;
    nextBody = body.slice(0, valueStart) + ` ${value}`.replace(/^ +/, " ") + body.slice(valueStart + found[3].length);
  } else {
    // Insert before the closing brace, matching the indentation already in use.
    const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? "  ";
    const trimmedEnd = body.replace(/\s*$/, "");
    const spacer = trimmedEnd.endsWith(";") || trimmedEnd === "" ? "" : ";";
    nextBody = `${trimmedEnd}${spacer}\n${indent}${property}: ${value};\n`;
  }
  return { ok: true, css: css.slice(0, rule.bodyStart) + nextBody + css.slice(rule.bodyEnd) };
}

/**
 * The declarations literally written for `selector`, in source order.
 * Deliberately reads the file rather than the CSSOM: the browser expands
 * shorthands into longhands, which would show the inspector properties that do
 * not exist in the stylesheet and cannot be written back to it.
 * Top-level rules only — a responsive override lives in @media and is left alone.
 */
export function readDeclarations(css, selector) {
  const wanted = normalizeSelector(selector);
  const rules = parseRules(css).filter((r) => r.depth === 0 && normalizeSelector(r.selector) === wanted);
  if (rules.length !== 1) return null;
  const body = maskComments(css).slice(rules[0].bodyStart, rules[0].bodyEnd);
  const out = [];
  for (const m of body.matchAll(/([-\w]+)\s*:\s*([^;}]+)[;}]?/g)) {
    out.push({ name: m[1], value: m[2].trim() });
  }
  return out;
}

/** Read the design tokens declared on :root so the colour panel starts from truth. */
export function readTokens(css) {
  const root = parseRules(css).find((r) => r.depth === 0 && normalizeSelector(r.selector) === ":root");
  if (!root) return {};
  const tokens = {};
  const body = css.slice(root.bodyStart, root.bodyEnd);
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/* ── page layout ────────────────────────────────────────────────────────── */

// The landing page composes itself from a flat list of components inside a single
// <main>. That list is the page order, so reordering, hiding, and duplicating a
// section all reduce to rewriting it.

const LANDING_ANCHOR = "export default function Landing()";

export function parseMainChildren(source) {
  const anchor = source.indexOf(LANDING_ANCHOR);
  if (anchor === -1) return null;
  const open = source.indexOf("<main>", anchor);
  const close = source.indexOf("</main>", open);
  if (open === -1 || close === -1) return null;
  const start = open + "<main>".length;
  const names = [...source.slice(start, close).matchAll(/<([A-Z]\w*)\s*\/>/g)].map((m) => m[1]);
  return { names, start, end: close };
}

export function setMainChildren(source, names) {
  const parsed = parseMainChildren(source);
  if (!parsed) {
    return { ok: false, reason: "no-main", detail: `could not find <main> inside ${LANDING_ANCHOR}` };
  }
  if (!Array.isArray(names) || names.length === 0) {
    return { ok: false, reason: "empty", detail: "a page needs at least one section" };
  }
  const unknown = names.filter((n) => !/^[A-Z]\w*$/.test(n));
  if (unknown.length > 0) {
    return { ok: false, reason: "bad-name", detail: `not component names: ${unknown.join(", ")}` };
  }
  const body = `\n${names.map((n) => `      <${n} />`).join("\n")}\n    `;
  return { ok: true, source: source.slice(0, parsed.start) + body + source.slice(parsed.end) };
}

/* ── disk ───────────────────────────────────────────────────────────────── */

/** Snapshot a file into the backup directory, preserving its path, before writing. */
export function backupFile(file, projectRoot, backupDir) {
  const dest = path.join(backupDir, path.relative(projectRoot, file));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(file));
  return dest;
}
