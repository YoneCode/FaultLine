// Finding the editable units on the page, and keeping them stable across renders.
//
// Two kinds of unit:
//   · an element whose children are all text — the element itself is editable,
//     so the DOM React rendered is left completely alone.
//   · a bare text node sitting alongside elements (the first line of the hero
//     title, which shares its <h1> with a <br> and a <span>) — only that node is
//     wrapped, in an inline span, so it can be targeted on its own.
//
// Anything whose text is produced from data rather than written in a source file
// is marked separately: the server tells us which strings it can actually find,
// and the rest are shown as read-only instead of failing later at save time.

export const WRAP = "fl-wrap";
export const UNIT = "data-fl-unit";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "PATH", "VIDEO", "BR", "IMG"]);

const meaningful = (s) => s && s.replace(/\s+/g, " ").trim().length > 0;

/** Stable-ish identity: the chain of tag + index from the scan root. */
function pathOf(node, root) {
  const parts = [];
  let cur = node;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) break;
    if (cur.nodeType === Node.TEXT_NODE) {
      parts.unshift(`t${[...parent.childNodes].indexOf(cur)}`);
    } else {
      const tag = cur.tagName.toLowerCase();
      const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}[${sameTag.indexOf(cur)}]` : tag);
    }
    cur = parent;
  }
  return parts.join("/");
}

/** A short human label for the change list — the element and its class, if any. */
function labelOf(el) {
  const tag = el.tagName.toLowerCase();
  const cls = (typeof el.className === "string" ? el.className : "")
    .split(/\s+/)
    .filter((c) => c && c !== WRAP)[0];
  return cls ? `${tag}.${cls}` : tag;
}

/**
 * Mark every editable unit under `root`. Returns the units found.
 * Safe to call repeatedly — previously marked units are reused.
 */
export function scan(root) {
  const units = [];

  const visit = (el) => {
    // Clones exist only to preview a duplicated section — editing one would
    // record a change against text that has no second home in the source.
    if (SKIP_TAGS.has(el.tagName) || el.dataset?.flClone || el.closest("[data-fl-ui]")) return;

    const kids = [...el.childNodes];
    const hasElementChild = kids.some((n) => n.nodeType === Node.ELEMENT_NODE);
    const textKids = kids.filter((n) => n.nodeType === Node.TEXT_NODE && meaningful(n.nodeValue));

    if (!hasElementChild) {
      if (textKids.length > 0) units.push(mark(el, root));
      return;
    }

    // Mixed content: wrap the loose text so it can be edited independently of
    // its element siblings, then recurse into the real children.
    for (const node of textKids) {
      const wrapper = node.parentNode.querySelector?.(`:scope > .${WRAP}`);
      if (wrapper && wrapper.firstChild === node) continue;
      const span = document.createElement("span");
      span.className = WRAP;
      node.parentNode.replaceChild(span, node);
      span.appendChild(node);
      units.push(mark(span, root));
    }
    for (const child of el.children) {
      if (!child.classList?.contains(WRAP)) visit(child);
    }
  };

  visit(root);
  return units;
}

function mark(el, root) {
  const path = el.getAttribute(UNIT) || pathOf(el, root);
  el.setAttribute(UNIT, path);
  // The first text we ever see for a unit is what the source says, and that is
  // what a save has to match against — so it is captured once and kept.
  if (!el.dataset.flOriginal) el.dataset.flOriginal = el.textContent;
  return { path, el, original: el.dataset.flOriginal, label: labelOf(el) };
}

/** Remove every trace of the editor from the DOM. */
export function teardown(root) {
  for (const el of root.querySelectorAll(`[${UNIT}]`)) {
    el.removeAttribute(UNIT);
    el.removeAttribute("contenteditable");
    delete el.dataset.flOriginal;
    delete el.dataset.flLocked;
  }
  for (const w of root.querySelectorAll(`.${WRAP}`)) {
    const parent = w.parentNode;
    while (w.firstChild) parent.insertBefore(w.firstChild, w);
    parent.removeChild(w);
    parent.normalize();
  }
}

/**
 * Re-apply pending text drafts after a render. A draft whose unit no longer
 * holds the original text is stale — reported rather than force-applied, so an
 * edit never silently lands on the wrong element.
 */
export function applyDrafts(root, textDrafts) {
  const stale = [];
  for (const draft of Object.values(textDrafts)) {
    const el = root.querySelector(`[${UNIT}="${CSS.escape(draft.path)}"]`);
    if (!el) {
      stale.push({ ...draft, why: "element no longer on this page" });
      continue;
    }
    const source = el.dataset.flOriginal ?? el.textContent;
    if (norm(source) !== norm(draft.original) && norm(el.textContent) !== norm(draft.next)) {
      stale.push({ ...draft, why: "underlying text changed" });
      continue;
    }
    if (el.textContent !== draft.next) el.textContent = draft.next;
  }
  return stale;
}

const norm = (s) => String(s).replace(/\s+/g, " ").trim();
