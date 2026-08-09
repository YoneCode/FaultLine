// Poll an investigation tx to a terminal consensus state on a given contract,
// then read the stored verdict and the deployer balance (to confirm bond refund).
// Usage: node deploy/_poll.mjs <txHash> [contractAddress] [incidentId]
import "dotenv/config";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const HASH = process.argv[2];
const ADDR = (process.argv[3] || process.env.FAULTLINE_CONTRACT_ADDRESS || "").trim();
const INC = process.argv[4] || "inc-2026-08-02-procure-7f3a";
if (!/^0x[0-9a-fA-F]{64}$/.test(HASH || "")) { console.error("bad tx hash"); process.exit(1); }

let key = process.env.ACCOUNT_PRIVATE_KEY.trim();
if (!key.startsWith("0x")) key = "0x" + key;
const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });

const balBefore = await client.getBalance({ address: account.address });
console.log("deployer balance at poll start:", balBefore.toString(), "wei");

// Genuinely terminal consensus statuses. REVEALING/COMMITTING/PENDING/PROPOSING/
// APPEALING are all mid-consensus (a tx can rotate leaders and keep going), so they
// must NOT stop the poll — only these are final.
const TERMINAL = new Set(["FINALIZED", "ACCEPTED", "UNDETERMINED", "CANCELED"]);

for (let i = 0; i < 180; i++) {
  const tx = await client.getTransaction({ hash: HASH });
  const s = tx.statusName, r = tx.resultName;
  if (TERMINAL.has(s)) {
    console.log("TERMINAL:", s, "/", r, "/", tx.txExecutionResultName);
    const v = await client.readContract({ address: ADDR, functionName: "get_verdict", args: [INC] });
    console.log("VERDICT_STORED:", v ? "yes" : "no");
    if (v) console.log(v);
    const balAfter = await client.getBalance({ address: account.address });
    console.log("deployer balance at terminal :", balAfter.toString(), "wei");
    console.log("delta (start->terminal)      :", (balAfter - balBefore).toString(), "wei (>= bond means refund landed)");
    process.exit(0);
  }
  if (i % 6 === 0) console.log(`... ${s}/${r} (poll ${i})`);
  await new Promise((r2) => setTimeout(r2, 10000));
}
console.log("TIMEOUT still", (await client.getTransaction({ hash: HASH })).statusName);
