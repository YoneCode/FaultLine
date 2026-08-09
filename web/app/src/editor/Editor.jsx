import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UNIT, WRAP, scan, teardown, applyDrafts } from "./scan.js";
import { matchingSelectors, preview } from "./cssom.js";
import * as layout from "./layout.js";
import {
  subscribe, getVersion, getState, changes, count,
  setText, setToken, setStyle, setLayout, revert, revertAll, clearSaved,
} from "./store.js";
import "./editor.css";

const APP_ROOT = () => document.getElementById("root");
const isColor = (v) => /^(#|rgb|hsl)/i.test(v.trim());
const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

/* ── in-place text editing ──────────────────────────────────────────────── */

function useInlineEditing(active, handlers) {
  // Held in a ref so changing a callback never tears down the listeners mid-edit.
  const cb = useRef(handlers);
  cb.current = handlers;

  useEffect(() => {
    const root = APP_ROOT();
    if (!active || !root) return undefined;

    const busy = { current: false };

    const refresh = () => {
      busy.current = true;
      const units = scan(root);
      const stale = applyDrafts(root, getState().text);
      cb.current.onUnits(units, stale);
      cb.current.onLayoutTick(root);
      requestAnimationFrame(() => { busy.current = false; });
    };
    refresh();

    // React re-renders (route change, HMR) wipe our markers and any previewed
    // section order — re-apply whenever the tree moves under us.
    const observer = new MutationObserver(() => {
      if (busy.current) return;
      if (document.activeElement?.hasAttribute?.("contenteditable")) return;
      refresh();
    });
    observer.observe(root, { childList: true, subtree: true });

    const finish = (el, commitEdit) => {
      el.removeAttribute("contenteditable");
      el.classList.remove("fl-active");
      if (commitEdit) {
        setText(el.getAttribute(UNIT), {
          original: el.dataset.flOriginal,
          next: el.textContent,
          path: el.getAttribute(UNIT),
          label: el.dataset.flLabel || "text",
        });
      } else if (el.dataset.flBefore !== undefined) {
        el.textContent = el.dataset.flBefore;
      }
      delete el.dataset.flBefore;
    };

    const onClick = (e) => {
      if (e.target.closest("[data-fl-ui]")) return;
      const el = e.target.closest?.(`[${UNIT}]`);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      // Selecting for the style inspector works even on text the editor cannot
      // rewrite, so data-driven copy is still stylable. A wrapper span exists only
      // to make loose text clickable and carries no styling of its own — the rule
      // worth inspecting belongs to the element it sits inside.
      const styled = el.classList.contains(WRAP) ? el.parentElement : el;
      cb.current.onSelect(styled);
      if (el.dataset.flLocked === "1" || el.hasAttribute("contenteditable")) return;
      el.dataset.flBefore = el.textContent;
      el.classList.add("fl-active");
      // plaintext-only keeps pasted markup out of the page; older engines fall back.
      el.setAttribute("contenteditable", "plaintext-only");
      if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
      el.focus();
      document.getSelection()?.selectAllChildren(el);
    };

    const onKeyDown = (e) => {
      const el = e.target.closest?.("[contenteditable]");
      if (!el) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(el, true); el.blur(); }
      if (e.key === "Escape") { e.preventDefault(); finish(el, false); el.blur(); }
    };

    const onBlur = (e) => {
      if (e.target?.hasAttribute?.("contenteditable")) finish(e.target, true);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("blur", onBlur, true);
    document.body.classList.add("fl-editing");

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("blur", onBlur, true);
      document.body.classList.remove("fl-editing");
      layout.reset(root);
      teardown(root);
    };
  }, [active]);
}

/* ── colours ────────────────────────────────────────────────────────────── */

function Colours({ tokens, draft }) {
  const entries = Object.entries(tokens).filter(([, v]) => isColor(v));
  if (entries.length === 0) return <p className="fl-empty">No colour tokens found in styles.css.</p>;
  return (
    <div className="fl-tokens">
      {entries.map(([name, original]) => {
        const value = draft[name]?.next ?? original;
        const push = (next) => {
          document.documentElement.style.setProperty(name, next);
          setToken(name, { original, next });
        };
        return (
          <label className={`fl-token${draft[name] ? " is-changed" : ""}`} key={name}>
            <input type="color" value={toHex(value)} onChange={(e) => push(e.target.value)} />
            <span className="fl-token-name">{name}</span>
            <input className="fl-token-hex" value={value} spellCheck={false} onChange={(e) => push(e.target.value)} />
          </label>
        );
      })}
    </div>
  );
}

/* ── style inspector ────────────────────────────────────────────────────── */

function Style({ selected, rules, draft, onAdd }) {
  const [adding, setAdding] = useState(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  if (!selected) {
    return <p className="fl-empty">Click anything on the page to inspect the CSS rules behind it.</p>;
  }
  const selectors = Object.keys(rules);
  return (
    <>
      <div className="fl-selected">
        <span className="fl-kind fl-kind--style">selected</span> {describe(selected)}
      </div>
      {selectors.length === 0 && (
        <p className="fl-empty">
          No editable rule in styles.css matches this element — its styling may be inline,
          or only defined inside a media query.
        </p>
      )}
      {selectors.map((selector) => (
        <div className="fl-rule" key={selector}>
          <div className="fl-rule-sel">{selector}</div>
          {rules[selector].map((d) => {
            const key = `${selector}|${d.name}`;
            const current = draft[key]?.next ?? d.value;
            return (
              <label className={`fl-decl${draft[key] ? " is-changed" : ""}`} key={d.name}>
                <span className="fl-decl-name">{d.name}</span>
                <input
                  value={current}
                  spellCheck={false}
                  onChange={(e) => {
                    preview(selector, d.name, e.target.value);
                    setStyle(selector, d.name, { original: d.value, next: e.target.value });
                  }}
                />
              </label>
            );
          })}
          {adding === selector ? (
            <div className="fl-add">
              <input placeholder="property" value={name} onChange={(e) => setName(e.target.value)} list="fl-props" />
              <input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
              <button
                className="fl-btn"
                onClick={() => {
                  if (!name.trim() || !value.trim()) return;
                  preview(selector, name.trim(), value.trim());
                  setStyle(selector, name.trim(), { original: "", next: value.trim() });
                  onAdd(selector, name.trim(), value.trim());
                  setAdding(null); setName(""); setValue("");
                }}
              >
                add
              </button>
            </div>
          ) : (
            <button className="fl-addlink" onClick={() => setAdding(selector)}>+ property</button>
          )}
        </div>
      ))}
      <datalist id="fl-props">
        {["font-size", "font-weight", "letter-spacing", "line-height", "color", "background",
          "padding", "margin", "max-width", "gap", "border-radius", "text-transform", "opacity"]
          .map((p) => <option key={p} value={p} />)}
      </datalist>
    </>
  );
}

/* ── section layout ─────────────────────────────────────────────────────── */

function Layout({ available, order, canonical, onOrder }) {
  if (!available) {
    return (
      <p className="fl-empty">
        Section controls work on the landing page. Open <b>#/</b> and reopen this tab.
      </p>
    );
  }
  const hidden = canonical.filter((n) => !order.includes(n));
  const move = (i, by) => {
    const next = [...order];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onOrder(next);
  };
  return (
    <>
      <div className="fl-sections">
        {order.map((name, i) => (
          <div className="fl-section" key={`${name}-${i}`}>
            <span className="fl-section-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="fl-section-name">
              {name}
              {order.indexOf(name) !== i && <em className="fl-dup">copy</em>}
            </span>
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} title="Move down">↓</button>
            {/* plain +/✕ rather than duplicate/delete glyphs — the mono stack has no
                box-drawing coverage and renders them as tofu */}
            <button
              onClick={() => onOrder([...order.slice(0, i + 1), name, ...order.slice(i + 1)])}
              title="Duplicate"
            >+</button>
            <button
              className="fl-section-x"
              onClick={() => onOrder(order.filter((_, k) => k !== i))}
              disabled={order.length === 1}
              title="Hide"
            >✕</button>
          </div>
        ))}
      </div>
      {hidden.length > 0 && (
        <div className="fl-hidden">
          <div className="fl-faint">HIDDEN</div>
          {hidden.map((name) => (
            <div className="fl-section is-hidden" key={name}>
              <span className="fl-section-name">{name}</span>
              <button onClick={() => onOrder([...order, name])} title="Show again">+ show</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── change list ────────────────────────────────────────────────────────── */

function Changes({ list, onSave, saving, result }) {
  if (list.length === 0 && !result) {
    return <p className="fl-empty">No changes yet. Click any text on the page to rewrite it.</p>;
  }
  return (
    <>
      {result && (
        <div className={`fl-result${result.failed.length ? " has-conflict" : ""}`}>
          <b>{result.saved} saved</b>
          {result.written.length > 0 && <span> → {result.written.join(", ")}</span>}
          {result.backup && <div className="fl-faint">backup: {result.backup}</div>}
          {result.failed.map((f, i) => (
            <div className="fl-conflict" key={`${f.id}-${i}`}><b>could not place</b> {reasonText(f)}</div>
          ))}
        </div>
      )}
      <div className="fl-changes">
        {list.map((c) => (
          <div className="fl-change" key={c.id}>
            <div className="fl-change-head">
              <span className={`fl-kind fl-kind--${c.kind}`}>{c.kind}</span>
              <span className="fl-change-title">{c.title}</span>
              <button className="fl-revert" onClick={() => revert(c.id)} title="Revert this change">↺</button>
            </div>
            <div className="fl-diff">
              <s>{truncate(c.original)}</s>
              <span className="fl-arrow">→</span>
              <b>{truncate(c.next)}</b>
            </div>
          </div>
        ))}
      </div>
      {list.length > 0 && (
        <div className="fl-actions">
          <button className="fl-btn fl-btn--primary" onClick={onSave} disabled={saving}>
            {saving ? "Writing…" : `Save ${list.length} to source`}
          </button>
          <button className="fl-btn" onClick={revertAll} disabled={saving}>Revert all</button>
        </div>
      )}
    </>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */

const TABS = [["changes", "Changes"], ["colours", "Colours"], ["style", "Style"], ["layout", "Layout"]];

export default function Editor() {
  const [on, setOn] = useState(() => new URLSearchParams(location.search).has("edit"));
  const [tab, setTab] = useState("changes");
  const [tokens, setTokens] = useState({});
  const [sections, setSections] = useState([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [rules, setRules] = useState({});
  const [stale, setStale] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const probed = useRef(new Set());

  useSyncExternalStore(subscribe, getVersion);
  const state = getState();
  const list = changes();
  const order = state.layout?.order ?? sections;

  const onUnits = useCallback((units, staleDrafts) => {
    setStale(staleDrafts);
    for (const u of units) u.el.dataset.flLabel = u.label;
    const unknown = units.filter((u) => !probed.current.has(u.original)).map((u) => u.original);
    if (unknown.length === 0) return;
    unknown.forEach((t) => probed.current.add(t));
    post("/__edit/probe", { texts: unknown })
      .then(({ status = {} }) => {
        for (const u of units) {
          const verdict = status[u.original];
          if (verdict && verdict !== "editable") {
            u.el.dataset.flLocked = "1";
            u.el.dataset.flWhy = verdict === "ambiguous"
              ? "appears more than once in source"
              : "comes from data, not a source literal";
          }
        }
      })
      .catch(() => { /* advisory only — save still reports real conflicts */ });
  }, []);

  // Keep the previewed section order alive across React's own renders. Only
  // re-capture when nothing is pending, so a preview order is never mistaken
  // for what the source says.
  const sectionsRef = useRef([]);
  sectionsRef.current = sections;
  const onLayoutTick = useCallback((root) => {
    const names = sectionsRef.current;
    if (names.length === 0) return;
    const pending = getState().layout;
    if (!pending || !layout.isCaptured()) setLayoutReady(layout.capture(root, names));
    if (pending) layout.applyOrder(root, pending.order);
  }, []);

  useInlineEditing(on, { onUnits, onSelect: setSelected, onLayoutTick });

  useEffect(() => {
    if (!on) return;
    fetch("/__edit/tokens").then((r) => r.json()).then((d) => setTokens(d.tokens || {})).catch(() => {});
    fetch("/__edit/sections").then((r) => r.json()).then((d) => setSections(d.sections || [])).catch(() => {});
  }, [on]);

  // Re-apply colour drafts after a reload so the page matches the change list.
  useEffect(() => {
    if (!on) return;
    for (const [name, c] of Object.entries(state.token)) {
      document.documentElement.style.setProperty(name, c.next);
    }
  }, [on, tokens]);

  // Ask the file what the matching selectors actually contain.
  useEffect(() => {
    if (!selected) return;
    const selectors = matchingSelectors(selected).map((m) => m.selector);
    if (selectors.length === 0) { setRules({}); return; }
    post("/__edit/rule", { selectors }).then((d) => setRules(d.rules || {})).catch(() => setRules({}));
  }, [selected]);

  const applyOrder = (next) => {
    setLayout(next, sections);
    layout.applyOrder(APP_ROOT(), next);
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const data = await post("/__edit/save", { changes: list.map((c) => ({ id: c.id, ...c.payload })) });
      const ok = (data.results || []).filter((r) => r.ok);
      const failed = (data.results || []).filter((r) => !r.ok);
      clearSaved(ok.map((r) => r.id));
      // Source is the truth now — drop the live overrides so the re-render shows through.
      for (const name of Object.keys(state.token)) {
        if (ok.some((r) => r.id === `token:${name}`)) document.documentElement.style.removeProperty(name);
      }
      if (ok.some((r) => r.id === "layout:main")) {
        fetch("/__edit/sections").then((r) => r.json()).then((d) => setSections(d.sections || []));
      }
      probed.current.clear();
      setResult({ saved: ok.length, failed, written: data.written || [], backup: data.backup });
    } catch (err) {
      setResult({ saved: 0, failed: [{ id: "-", reason: "error", detail: String(err.message || err) }], written: [] });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key?.toLowerCase() === "e" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setOn((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!on) {
    return (
      <button className="fl-launch" data-fl-ui onClick={() => setOn(true)} title="Edit this page (Ctrl+Shift+E)">
        ✎ EDIT{count() > 0 ? ` · ${count()}` : ""}
      </button>
    );
  }

  return (
    <aside className="fl-panel" data-fl-ui>
      <header className="fl-head">
        <div>
          <div className="fl-title">PAGE EDITOR</div>
          <div className="fl-sub">writes to src/ · dev only</div>
        </div>
        <button className="fl-close" onClick={() => setOn(false)} title="Close (Ctrl+Shift+E)">✕</button>
      </header>

      <nav className="fl-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id === "changes" && count() ? `${label} (${count()})` : label}
          </button>
        ))}
      </nav>

      {stale.length > 0 && (
        <div className="fl-stale">
          {stale.length} saved edit{stale.length > 1 ? "s" : ""} no longer match the page
          <div className="fl-faint">{stale[0].why} — revert in Changes</div>
        </div>
      )}

      <div className="fl-body">
        {tab === "colours" && <Colours tokens={tokens} draft={state.token} />}
        {tab === "style" && <Style selected={selected} rules={rules} draft={state.style} onAdd={addLocal(setRules)} />}
        {tab === "layout" && (
          <Layout available={layoutReady} order={order} canonical={sections} onOrder={applyOrder} />
        )}
        {tab === "changes" && <Changes list={list} onSave={save} saving={saving} result={result} />}
      </div>

      <footer className="fl-foot">
        Click text to edit · <b>Enter</b> commits · <b>Esc</b> cancels
      </footer>
    </aside>
  );
}

/* ── helpers ────────────────────────────────────────────────────────────── */

// Show a newly added property in the rule list straight away, so it can be
// tweaked further before saving.
const addLocal = (setRules) => (selector, name, value) =>
  setRules((prev) => ({
    ...prev,
    [selector]: [...(prev[selector] || []), { name, value }],
  }));

/** Name an element the way you'd say it out loud: h1.hero-title. */
const describe = (el) => {
  if (!el?.tagName) return "";
  const tag = el.tagName.toLowerCase();
  const cls = [...(el.classList || [])].find((c) => !c.startsWith("fl-"));
  return cls ? `${tag}.${cls}` : tag;
};

const truncate = (s, n = 90) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function reasonText(f) {
  if (f.reason === "not-found") return "that text is not a literal in any source file";
  if (f.reason === "ambiguous") return `it is not unique — ${f.detail}`;
  if (f.reason === "no-rule") return f.detail || "no matching CSS rule";
  return f.detail || f.reason;
}

/** <input type="color"> only speaks 6-digit hex; push anything else through a canvas. */
function toHex(value) {
  const v = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillStyle = v;
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : "#000000";
}
