// Diagnose a finished investigation tx: dump rounds, leader outputs, validator
// votes, and check whether the bond value was returned after UNDETERMINED.
// Read-only. Never touches or prints the private key.
import "dotenv/config";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const HASH = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(HASH || "")) {
  console.error("usage: node deploy/diagnose.mjs <txHash>");
  process.exit(1);
}

let key = (process.env.ACCOUNT_PRIVATE_KEY || "").trim();
if (!key.startsWith("0x")) key = "0x" + key;
const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });

const json = (o) =>
  JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);

const balance = await client.getBalance({ address: account.address });
console.log("deployer balance now:", balance.toString(), "wei");

const tx = await client.getTransaction({ hash: HASH });
console.log("statusName:", tx.statusName);
console.log("resultName:", tx.resultName);
console.log("txExecutionResultName:", tx.txExecutionResultName);
console.log("numOfRounds:", tx.numOfRounds);
console.log("value:", tx.value?.toString?.());

// Everything else — rounds, votes, eq blocks — dump structurally.
const interesting = {};
for (const k of Object.keys(tx)) {
  if (["statusName", "resultName", "txExecutionResultName"].includes(k)) continue;
  interesting[k] = tx[k];
}
console.log("\n=== full tx (sans dup status fields) ===");
console.log(json(interesting));
