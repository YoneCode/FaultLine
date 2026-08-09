// Section order, live.
//
// Landing() renders a flat list of components inside <main>, so the Nth child of
// <main> in the DOM is the Nth component in the source list. That correspondence
// is the whole mapping — no marker attributes need to be added to your JSX.
//
// Preview moves the real section elements rather than re-rendering. React will
// reclaim them on its next render of that subtree, which is why the editor
// re-applies the order whenever it sees the DOM change.

let canonical = [];
let nodes = new Map();

export const canonicalOrder = () => canonical;

/**
 * Pair the section names from source with the elements React rendered.
 * Refuses if the counts disagree — that means the page no longer matches the
 * source list, and guessing an alignment would reorder the wrong sections.
 */
export function capture(root, names) {
  const main = root.querySelector("main");
  if (!main) return false;
  const kids = [...main.children].filter((el) => !el.dataset.flClone);
  if (kids.length !== names.length) return false;
  canonical = names;
  nodes = new Map(names.map((name, i) => [name, kids[i]]));
  return true;
}

export const isCaptured = () => nodes.size > 0;

/** Render `order` — appendChild moves an existing node, so this both sorts and restores. */
export function applyOrder(root, order) {
  const main = root.querySelector("main");
  if (!main || nodes.size === 0) return;

  for (const clone of main.querySelectorAll(":scope > [data-fl-clone]")) clone.remove();

  const placed = new Set();
  for (const name of order) {
    const base = nodes.get(name);
    if (!base) continue;
    if (placed.has(name)) {
      // A duplicated section has no second element of its own; a clone stands in
      // for the preview and is marked so the text scanner skips it.
      const clone = base.cloneNode(true);
      clone.dataset.flClone = "1";
      main.appendChild(clone);
    } else {
      main.appendChild(base);
      placed.add(name);
    }
  }
  // Anything left out is hidden — detached, but still held so it can come back.
  for (const name of canonical) {
    if (!order.includes(name)) nodes.get(name)?.remove();
  }
}

/** Put every section back where the source has it. */
export function reset(root) {
  applyOrder(root, canonical);
}
