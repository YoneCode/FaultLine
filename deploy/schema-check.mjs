// Free, read-only, no-gas contract check: ask a Bradbury node to LOAD the module
// and produce its schema (gen_getContractSchema with {code: base64}).
//
// Why this matters: a GenLayer deploy that returns FINISHED_WITH_ERROR gives no
// stderr through any public RPC. But schema generation runs the SAME GenVM
// module-load path as a deploy, on a real node, for free — so if the module
// cannot load, the error message shows up here instead of costing gas and
// leaving a dead address behind.
//
// Usage: node deploy/schema-check.mjs <file.py> [file2.py ...]
//
// No key is read and nothing is broadcast.
import { readFileSync } from "fs";
import path from "path";

const RPC = process.env.FAULTLINE_RPC || "https://rpc-bradbury.genlayer.com";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node deploy/schema-check.mjs <file.py> [file2.py ...]");
  process.exit(1);
}

async function schemaFor(bytes) {
  const codeB64 = Buffer.from(bytes).toString("base64");
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "gen_getContractSchema",
      params: [{ code: codeB64 }],
    }),
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { httpStatus: r.status, raw: text.slice(0, 400) };
  }
  return { httpStatus: r.status, ...j };
}

console.log("rpc:", RPC, "\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

for (const [i, f] of files.entries()) {
  if (i > 0) await sleep(4000); // the public RPC rate-limits this method
  const p = path.resolve(f);
  const bytes = readFileSync(p);
  console.log(`── ${path.basename(p)} (${bytes.length} bytes)`);
  const res = await schemaFor(bytes);
  if (res.error) {
    const msg = typeof res.error === "string" ? res.error : res.error.message || JSON.stringify(res.error);
    console.log("   ✕ MODULE LOAD FAILED");
    console.log("   error:", msg);
    const extra = JSON.stringify(res.error);
    if (extra && extra.length > msg.length + 20) console.log("   full :", extra.slice(0, 1500));
    failures++;
  } else if (res.result) {
    const methods = res.result.methods || {};
    console.log("   ✓ module loaded · schema ok");
    console.log("   methods:", Object.keys(methods).join(", ") || "(none listed)");
    if (res.result.ctor) console.log("   ctor   :", JSON.stringify(res.result.ctor));
  } else {
    console.log("   ? unexpected response:", JSON.stringify(res).slice(0, 600));
    failures++;
  }
  console.log("");
}

process.exit(failures ? 1 : 0);
