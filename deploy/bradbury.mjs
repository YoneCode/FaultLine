// Deploy FaultLine to Bradbury using the key in .env (never printed or logged).
//
// Usage:  node deploy/bradbury.mjs [path/to/contract.py]
//
// Security: ACCOUNT_PRIVATE_KEY is read from the environment into memory only.
// It is validated for shape, never echoed, never written to disk, and never
// included in any log line. If it is missing or malformed the script exits
// before touching the network.
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

let key = (process.env.ACCOUNT_PRIVATE_KEY || "").trim();
if (!key.startsWith("0x")) key = "0x" + key;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("ACCOUNT_PRIVATE_KEY is missing or malformed in .env.");
  console.error("Add a 0x-prefixed 64-hex-char funded testnet key. Do NOT paste it anywhere else.");
  process.exit(1);
}

const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });

const contractPath = path.resolve(process.argv[2] || "contracts/faultline.py");
const code = new Uint8Array(readFileSync(contractPath));

console.log("Contract :", contractPath);
console.log("Deployer :", account.address);
console.log("Chain    :", testnetBradbury.name, "(id", testnetBradbury.id + ")");

const balance = await client.getBalance({ address: account.address });
console.log("Balance  :", balance.toString(), "wei");
if (balance === 0n) {
  console.error("\nDeployer has 0 GEN. Fund it at https://testnet-faucet.genlayer.foundation/ and re-run.");
  process.exit(1);
}

console.log("\nInitializing consensus smart contract…");
await client.initializeConsensusSmartContract();

// The public Bradbury RPC returns -32005 ("transaction gas rate limit exceeded:
// node is at capacity, retry in ~Nms") under load. That is transient and fires
// BEFORE the tx is submitted — no gas is spent and no contract is created — so
// it is safe to retry. Back off using the server-suggested delay when present.
const isTransient = (e) => {
  const s = JSON.stringify(e?.cause ?? e ?? "");
  return e?.code === -32005 || /-32005|node is at capacity|gas rate limit|rate.?limit/i.test(s);
};
const suggestedDelay = (e) => Number(e?.cause?.data?.retryAfterMs ?? e?.data?.retryAfterMs ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Deploying…");
let txHash;
for (let attempt = 1; ; attempt++) {
  try {
    txHash = await client.deployContract({ code, args: [] });
    break;
  } catch (e) {
    if (!isTransient(e) || attempt >= 12) {
      console.error(`\nDeploy send failed${isTransient(e) ? " (still rate-limited after retries)" : ""}:`, e?.shortMessage || e?.message || e);
      process.exit(1);
    }
    const wait = Math.max(suggestedDelay(e), 500) + attempt * 750; // server hint + linear backoff
    console.log(`  node at capacity (attempt ${attempt}); retrying in ${wait}ms…`);
    await sleep(wait);
  }
}
console.log("Deploy tx:", txHash);

const receipt = await client.waitForTransactionReceipt({
  hash: txHash,
  status: "ACCEPTED",
  retries: 300,
});
const address = receipt?.txDataDecoded?.contractAddress || receipt?.data?.contract_address;

if (!address) {
  console.error("No contract address in receipt:", JSON.stringify(receipt));
  process.exit(1);
}

// ACCEPTED only says consensus finished — the deployment itself can still have
// ERRORED, in which case no contract exists at the address. Check the execution
// result before claiming success (an earlier version of this script did not, and
// reported a deployed contract that was never created).
const tx = await client.getTransaction({ hash: txHash });
console.log("consensus:", tx.resultName, "· execution:", tx.txExecutionResultName);
if (tx.txExecutionResultName !== "FINISHED_WITH_RETURN") {
  console.error(`\n✕ DEPLOY FAILED — execution result ${tx.txExecutionResultName}.`);
  console.error("No contract was created at", address);
  console.error("Diagnose with: node deploy/diagnose.mjs " + txHash);
  process.exit(1);
}

console.log("\n✅ FaultLine deployed");
console.log("address :", address);
console.log("explorer:", `https://explorer-bradbury.genlayer.com/address/${address}`);
console.log("\nAdd this to .env:  FAULTLINE_CONTRACT_ADDRESS=" + address);
