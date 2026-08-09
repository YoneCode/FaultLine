// The change store. Everything the editor does lands here first — nothing
// touches your source until you hit Save, so the panel can always answer
// "what have I changed?" and undo any single item.
//
// Drafts persist to localStorage so a reload (or Vite's HMR) does not lose work.

const KEY = "faultline.editor.draft.v1";

const empty = () => ({ text: {}, token: {}, style: {}, layout: null });

let state = load();
let version = 0;
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

function commit() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — drafts simply stop surviving reloads */
  }
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;
// State is mutated in place, so the version counter is what tells React that
// something moved — useSyncExternalStore compares this, not the object.
export const getVersion = () => version;

/* ── text ───────────────────────────────────────────────────────────────── */

export function setText(key, { original, next, path, label }) {
  // Typing back to the original is not a change — drop it rather than record a no-op.
  if (normalize(original) === normalize(next)) {
    delete state.text[key];
  } else {
    state.text[key] = { key, original, next, path, label };
  }
  commit();
}

/* ── colour tokens ──────────────────────────────────────────────────────── */

export function setToken(token, { original, next }) {
  if (original.trim().toLowerCase() === next.trim().toLowerCase()) delete state.token[token];
  else state.token[token] = { token, original, next };
  commit();
}

/* ── css declarations (typography / spacing) ────────────────────────────── */

const styleKey = (selector, property) => `${selector}|${property}`;

export function setStyle(selector, property, { original, next }) {
  const k = styleKey(selector, property);
  if (normalize(original) === normalize(next)) delete state.style[k];
  else state.style[k] = { selector, property, original, next };
  commit();
}

/* ── section layout ─────────────────────────────────────────────────────── */

export function setLayout(order, original) {
  const same = order.length === original.length && order.every((n, i) => n === original[i]);
  state.layout = same ? null : { order, original };
  commit();
}

/* ── change list ────────────────────────────────────────────────────────── */

/** Every pending change, flattened into one list the panel can render. */
export function changes() {
  return [
    ...Object.values(state.text).map((c) => ({
      id: `text:${c.key}`,
      kind: "text",
      title: c.label || "text",
      original: c.original,
      next: c.next,
      payload: { kind: "text", original: c.original, next: c.next },
    })),
    ...Object.values(state.token).map((c) => ({
      id: `token:${c.token}`,
      kind: "token",
      title: c.token,
      original: c.original,
      next: c.next,
      payload: { kind: "token", token: c.token, value: c.next },
    })),
    ...Object.values(state.style).map((c) => ({
      id: `style:${styleKey(c.selector, c.property)}`,
      kind: "style",
      title: `${c.selector} · ${c.property}`,
      original: c.original,
      next: c.next,
      payload: { kind: "style", selector: c.selector, property: c.property, value: c.next },
    })),
    ...(state.layout
      ? [{
          id: "layout:main",
          kind: "layout",
          title: "section order",
          original: state.layout.original.join(" → "),
          next: state.layout.order.join(" → "),
          payload: { kind: "layout", order: state.layout.order },
        }]
      : []),
  ];
}

export const count = () =>
  Object.keys(state.text).length + Object.keys(state.token).length +
  Object.keys(state.style).length + (state.layout ? 1 : 0);

export function revert(id) {
  const [kind, ...rest] = id.split(":");
  const key = rest.join(":");
  if (kind === "text") delete state.text[key];
  if (kind === "token") delete state.token[key];
  if (kind === "style") delete state.style[key];
  if (kind === "layout") state.layout = null;
  commit();
}

export function revertAll() {
  state = empty();
  commit();
}

/** After a successful save the source matches the page, so drafts are spent. */
export function clearSaved(ids) {
  for (const id of ids) {
    const [kind, ...rest] = id.split(":");
    const key = rest.join(":");
    if (kind === "text") delete state.text[key];
    if (kind === "token") delete state.token[key];
    if (kind === "style") delete state.style[key];
    if (kind === "layout") state.layout = null;
  }
  commit();
}

const normalize = (s) => String(s).replace(/\s+/g, " ").trim();
