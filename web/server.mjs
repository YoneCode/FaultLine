// Minimal static server for local preview of the built FaultLine app.
// The app reads the chain directly in the browser (or demo data), so no API
// layer is needed here — production is served statically.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const DIST = path.resolve(__dirname, "app/dist");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
  ".json": "application/json", ".woff2": "font/woff2", ".map": "application/json",
  // media — a <video> served as application/octet-stream is refused by browsers
  ".webm": "video/webm", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".avif": "image/avif",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url.split("?")[0]) || "/");
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(DIST, rel);
  if (!file.startsWith(DIST + path.sep) && file !== path.join(DIST, "index.html")) {
    res.writeHead(403).end("forbidden"); return; // path-traversal guard
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : path.join(DIST, "index.html");
  if (!existsSync(target)) { res.writeHead(404).end("build missing — run: cd web/app && npm run build"); return; }
  const ext = path.extname(target);
  // Only Vite's /assets/* files carry a content hash in the name, so only they are
  // safe to mark immutable. Files from public/ keep stable names — caching those for
  // a year means swapping one leaves the browser showing the old asset indefinitely.
  const hashed = target.startsWith(path.join(DIST, "assets") + path.sep);
  const cache = ext === ".html" ? "no-store"
    : hashed ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
  const type = TYPES[ext] || "application/octet-stream";
  const body = readFileSync(target);

  // byte-range support — video elements request ranges, and some browsers will
  // not start playback from a server that ignores them
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && type.startsWith("video/")) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    if (start >= body.length || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${body.length}` }).end(); return;
    }
    res.writeHead(206, {
      "Content-Type": type, "Cache-Control": cache, "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1,
    }).end(body.subarray(start, end + 1));
    return;
  }

  res.writeHead(200, {
    "Content-Type": type, "Cache-Control": cache,
    "Accept-Ranges": "bytes", "Content-Length": body.length,
  }).end(body);
}).listen(PORT, HOST, () => console.log(`FaultLine preview on http://${HOST}:${PORT}`));
