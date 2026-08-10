// Cloudflare Pages Function: /rpc — same-origin JSON-RPC proxy for GenLayer
// Bradbury that normalizes request ids.
//
// Why this exists: some wallets (notably MetaMask, via json-rpc-engine v7)
// broadcast eth_sendRawTransaction with STRING JSON-RPC ids. Bradbury's Go
// gateway only accepts integer ids ("cannot unmarshal string into Go struct
// field Request.id of type int"), which kills every wallet-signed write before
// it reaches consensus. This proxy swaps non-int ids for ints on the way out
// and restores the original ids on the way back, so the wallet's own
// response-id equality check still passes.
//
// The dapp registers Bradbury in the user's wallet with rpcUrls pointing here
// (wallet_addEthereumChain, one-time prompt). Everything else about the RPC
// traffic is passed through untouched.
//
// Keep in sync with the dev-server twin: web/app/tools/rpc-middleware.js.

const UPSTREAM = "https://rpc-bradbury.genlayer.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Health/discovery endpoint — also proves the function deployed (a static 404
// would mean the functions/ directory wasn't picked up).
export function onRequestGet() {
  return json({ status: "ok", upstream: UPSTREAM, purpose: "JSON-RPC id normalizer for GenLayer Bradbury" });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];

  // Int ids already satisfy the gateway; only non-int ids get remapped, to
  // ints that don't collide with any int id already present in the batch.
  const usedInts = new Set(
    requests.filter((r) => r && typeof r.id === "number" && Number.isInteger(r.id)).map((r) => r.id)
  );
  const restore = new Map(); // proxy int id -> original client id
  let nextId = 1;
  const freshInt = () => {
    while (usedInts.has(nextId)) nextId += 1;
    usedInts.add(nextId);
    return nextId;
  };

  const outRequests = requests.map((req) => {
    if (!req || typeof req !== "object" || Array.isArray(req)) return req; // malformed — let the gateway say so
    if (req.id === undefined || req.id === null) return req;               // notification — no response expected
    if (typeof req.id === "number" && Number.isInteger(req.id)) return req; // already gateway-compatible
    const proxyId = freshInt();
    restore.set(proxyId, req.id);
    return { ...req, id: proxyId };
  });

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(isBatch ? outRequests : outRequests[0]),
    });
  } catch (e) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: `upstream unreachable: ${e && e.message ? e.message : e}` } },
      502
    );
  }

  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // Non-JSON upstream response (gateway HTML error page, empty body for a
    // notification-only batch, …) — pass it through untouched.
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": upstream.headers.get("Content-Type") || "text/plain" },
    });
  }

  const responses = Array.isArray(payload) ? payload : [payload];
  const outResponses = responses.map((res) => {
    if (res && typeof res === "object" && !Array.isArray(res) && restore.has(res.id)) {
      return { ...res, id: restore.get(res.id) };
    }
    return res;
  });

  return json(Array.isArray(payload) ? outResponses : outResponses[0], upstream.status);
}
