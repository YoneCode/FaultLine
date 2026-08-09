// Dev-only Vite plugin backing the visual editor.
//
// This writes to your source tree, so it is deliberately unavailable in any
// production build: `apply: "serve"` keeps it out of `vite build` entirely, and
// the client half is behind a dynamic import guarded by import.meta.env.DEV.
//
// Every save snapshots the files it is about to touch into .faultline-backups/
// before writing a byte. Combined with git, a bad edit is always recoverable.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTextEdit, setDeclaration, readTokens, backupFile, listSourceFiles,
  readDeclarations, parseMainChildren, setMainChildren,
} from "./editor-writers.js";
import { replaceText, findAll } from "./editor-normalize.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(APP_ROOT, "src");
const STYLES = path.join(SRC, "styles.css");
const BACKUPS = path.join(APP_ROOT, ".faultline-backups");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const json = (res, code, payload) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

/**
 * Apply a batch of changes. Files are edited in memory first and written only
 * once every change has been placed, so a conflict halfway through a batch does
 * not leave a half-rewritten file behind.
 */
function applyChanges(changes) {
  const pending = new Map(); // absolute path -> current text
  const results = [];

  const load = (file) => {
    if (!pending.has(file)) pending.set(file, readFileSync(file, "utf8"));
    return pending.get(file);
  };

  for (const change of changes) {
    try {
      if (change.kind === "text") {
        // Resolve against the in-progress content so several edits to one file
        // stack correctly, rather than each being computed from the original.
        let placed = false;
        for (const [file, text] of [...pending.entries()]) {
          const attempt = replaceText(text, change.original, change.next);
          if (attempt.ok) {
            pending.set(file, attempt.source);
            results.push({ id: change.id, ok: true, file: path.relative(APP_ROOT, file) });
            placed = true;
            break;
          }
          if (attempt.reason === "ambiguous") {
            results.push({ id: change.id, ok: false, reason: "ambiguous", detail: `appears ${attempt.count}×` });
            placed = true;
            break;
          }
        }
        if (placed) continue;

        const out = applyTextEdit(SRC, change.original, change.next);
        if (!out.ok) results.push({ id: change.id, ok: false, reason: out.reason, detail: out.detail });
        else {
          pending.set(out.file, out.source);
          results.push({ id: change.id, ok: true, file: path.relative(APP_ROOT, out.file) });
        }
      } else if (change.kind === "token") {
        const out = setDeclaration(load(STYLES), ":root", change.token, change.value);
        if (!out.ok) results.push({ id: change.id, ok: false, reason: out.reason, detail: out.detail });
        else {
          pending.set(STYLES, out.css);
          results.push({ id: change.id, ok: true, file: "src/styles.css" });
        }
      } else if (change.kind === "style") {
        const out = setDeclaration(load(STYLES), change.selector, change.property, change.value);
        if (!out.ok) results.push({ id: change.id, ok: false, reason: out.reason, detail: out.detail });
        else {
          pending.set(STYLES, out.css);
          results.push({ id: change.id, ok: true, file: "src/styles.css" });
        }
      } else if (change.kind === "layout") {
        const file = path.join(SRC, "pages", "Landing.jsx");
        const out = setMainChildren(load(file), change.order);
        if (!out.ok) results.push({ id: change.id, ok: false, reason: out.reason, detail: out.detail });
        else {
          pending.set(file, out.source);
          results.push({ id: change.id, ok: true, file: "src/pages/Landing.jsx" });
        }
      } else {
        results.push({ id: change.id, ok: false, reason: "unknown-kind", detail: change.kind });
      }
    } catch (err) {
      results.push({ id: change.id, ok: false, reason: "error", detail: String(err.message || err) });
    }
  }

  const written = [];
  if (results.some((r) => r.ok)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(BACKUPS, stamp);
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of pending) {
      if (readFileSync(file, "utf8") === text) continue;
      backupFile(file, APP_ROOT, dir);
      writeFileSync(file, text);
      written.push(path.relative(APP_ROOT, file));
    }
    return { results, written, backup: path.relative(APP_ROOT, dir) };
  }
  return { results, written, backup: null };
}

export default function faultlineEditor() {
  return {
    name: "faultline-editor",
    apply: "serve", // never present in a production build
    configureServer(server) {
      server.middlewares.use("/__edit/tokens", (req, res) => {
        json(res, 200, { tokens: readTokens(readFileSync(STYLES, "utf8")) });
      });

      // Which of these strings could a save actually place? Lets the editor show
      // data-driven text (a fault percentage, an agent id) as read-only up front
      // instead of accepting an edit that could never be written.
      server.middlewares.use("/__edit/probe", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        try {
          const { texts = [] } = await readBody(req);
          const files = listSourceFiles(SRC).map((f) => readFileSync(f, "utf8"));
          const status = {};
          for (const text of texts) {
            let hits = 0;
            for (const source of files) hits += findAll(source, text).length;
            status[text] = hits === 1 ? "editable" : hits === 0 ? "not-in-source" : "ambiguous";
          }
          json(res, 200, { status });
        } catch (err) {
          json(res, 500, { error: String(err.message || err) });
        }
      });

      // The declarations actually written for a set of selectors. The client works
      // out which selectors match the clicked element; the file decides what is in them.
      server.middlewares.use("/__edit/rule", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        try {
          const { selectors = [] } = await readBody(req);
          const css = readFileSync(STYLES, "utf8");
          const rules = {};
          for (const selector of selectors) {
            const decls = readDeclarations(css, selector);
            if (decls) rules[selector] = decls;
          }
          json(res, 200, { rules });
        } catch (err) {
          json(res, 500, { error: String(err.message || err) });
        }
      });

      // The page's section list, straight from Landing()'s <main>. Its order is the
      // page order, so the client can map DOM sections to component names by index.
      server.middlewares.use("/__edit/sections", (req, res) => {
        const file = path.join(SRC, "pages", "Landing.jsx");
        const parsed = parseMainChildren(readFileSync(file, "utf8"));
        json(res, 200, { sections: parsed?.names ?? [], ok: Boolean(parsed) });
      });

      server.middlewares.use("/__edit/save", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        try {
          const body = await readBody(req);
          const changes = Array.isArray(body.changes) ? body.changes : [];
          if (changes.length === 0) return json(res, 400, { error: "no changes" });
          const out = applyChanges(changes);
          server.config.logger.info(
            `  [editor] saved ${out.results.filter((r) => r.ok).length}/${changes.length} → ${out.written.join(", ") || "nothing"}`,
          );
          json(res, 200, out);
        } catch (err) {
          json(res, 500, { error: String(err.message || err) });
        }
      });
    },
  };
}
