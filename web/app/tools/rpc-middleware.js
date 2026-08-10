// Vite dev-server twin of functions/rpc.js (Cloudflare Pages Function).
// Serves POST /rpc on the local dev origin so wallet writes behave the same
// on localhost as on the deployed site. Keep the normalization logic in sync
// with functions/rpc.js — it is intentionally duplicated (Pages Functions are
// bundled standalone; importing app code from them is fragile).
//
// Note: the proxy forwards server-side, so on a host that cannot reach the
// Bradbury RPC (e.g. a Cloudflare-blocked IP) local writes will fail upstream
// exactly as a direct connection would — the deployed /rpc is unaffected.

const UPSTREAM = "https://rpc-bradbury.genlayer.com";

export default function rpcIdNormalizer() {
  return {
    name: "faultline-rpc-id-normalizer",
    configureServer(server) {
      server.middlewares.use("/rpc", async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "POST only" }));
          return;
        }

        let body;
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
          return;
        }

        const isBatch = Array.isArray(body);
        const requests = isBatch ? body : [body];
        const usedInts = new Set(
          requests.filter((r) => r && typeof r.id === "number" && Number.isInteger(r.id)).map((r) => r.id)
        );
        const restore = new Map();
        let nextId = 1;
        const freshInt = () => {
          while (usedInts.has(nextId)) nextId += 1;
          usedInts.add(nextId);
          return nextId;
        };
        const outRequests = requests.map((r) => {
          if (!r || typeof r !== "object" || Array.isArray(r)) return r;
          if (r.id === undefined || r.id === null) return r;
          if (typeof r.id === "number" && Number.isInteger(r.id)) return r;
          const proxyId = freshInt();
          restore.set(proxyId, r.id);
          return { ...r, id: proxyId };
        });

        let upstream;
        try {
          upstream = await fetch(UPSTREAM, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(isBatch ? outRequests : outRequests[0]),
          });
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `upstream unreachable: ${e && e.message ? e.message : e}` } }));
          return;
        }

        const text = await upstream.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "text/plain" });
          res.end(text);
          return;
        }
        const responses = Array.isArray(payload) ? payload : [payload];
        const outResponses = responses.map((r) => {
          if (r && typeof r === "object" && !Array.isArray(r) && restore.has(r.id)) {
            return { ...r, id: restore.get(r.id) };
          }
          return r;
        });
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(Array.isArray(payload) ? outResponses : outResponses[0]));
      });
    },
  };
}
