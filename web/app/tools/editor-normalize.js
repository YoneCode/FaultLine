// Mapping rendered text back onto its source literal.
//
// The browser hands us text as the user sees it — one line, single spaces. In the
// source that same string is usually wrapped across several indented JSX lines:
//
//   <p className="hero-lede">
//     Multi-agent swarms now move real money. When one produces a costly
//     failure, every vendor's agent blames the others.
//   </p>
//
// A literal indexOf for the rendered string finds nothing. So we build a
// whitespace-collapsed projection of the file alongside an index map back to real
// offsets, search in that space, and translate the hit back.

/**
 * Collapse every whitespace run to a single space, recording for each character
 * of the projection the offset it came from in the original source.
 */
function project(source) {
  let norm = "";
  const map = [];
  let inRun = false;
  for (let i = 0; i < source.length; i++) {
    if (/\s/.test(source[i])) {
      if (!inRun) {
        norm += " ";
        map.push(i);
        inRun = true;
      }
    } else {
      norm += source[i];
      map.push(i);
      inRun = false;
    }
  }
  return { norm, map };
}

export function normalizeText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/**
 * Every place `needle` appears in `source`, ignoring how whitespace is wrapped.
 * Returns real [start, end) offsets, plus the indentation of the line each hit
 * starts on so a replacement can be re-wrapped to match the surrounding code.
 */
export function findAll(source, needle) {
  const target = normalizeText(needle);
  if (!target) return [];
  const { norm, map } = project(source);
  const hits = [];
  let from = 0;
  let at;
  while ((at = norm.indexOf(target, from)) !== -1) {
    const start = map[at];
    const end = map[at + target.length - 1] + 1;
    const lineStart = source.lastIndexOf("\n", start) + 1;
    const indent = /^[ \t]*/.exec(source.slice(lineStart, start))[0];
    hits.push({ start, end, indent });
    from = at + 1;
  }
  return hits;
}

/**
 * JSX text is not a string literal — a brace or angle bracket in the replacement
 * would be parsed as markup. When the new text carries any of those, emit it as
 * an explicit expression container instead, which is always safe.
 */
function asJsxText(text) {
  if (!/[{}<>]/.test(text)) return { text, literal: false };
  return { text: `{${JSON.stringify(text)}}`, literal: true };
}

/**
 * Re-wrap `text` to `width` columns at the given indentation, so a replacement
 * reads like the code around it rather than becoming one runaway line. JSX
 * collapses the whitespace again at render time, so this is purely cosmetic.
 */
function rewrap(text, indent, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${indent}`);
}

/**
 * Replace one occurrence of `original` with `next` inside `source`.
 * Refuses to guess: zero matches or more than one both return a reason instead
 * of a rewritten file, so the caller can surface a conflict rather than corrupt
 * the wrong line.
 */
export function replaceText(source, original, next, { width = 92 } = {}) {
  const hits = findAll(source, original);
  if (hits.length === 0) return { ok: false, reason: "not-found", count: 0 };
  if (hits.length > 1) return { ok: false, reason: "ambiguous", count: hits.length };

  const { start, end, indent } = hits[0];
  const clean = normalizeText(next);
  const { text, literal } = asJsxText(clean);
  // An expression container must stay on one line; plain text can be re-wrapped.
  const body = literal ? text : rewrap(text, indent, width);
  return { ok: true, source: source.slice(0, start) + body + source.slice(end), count: 1 };
}
