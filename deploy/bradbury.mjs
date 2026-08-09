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

console.log("Deploying…");
const txHash = await client.deployContract({ code, args: [] });
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

console.log("\n✅ FaultLine deployed");
console.log("address :", address);
console.log("explorer:", `https://explorer-bradbury.genlayer.com/address/${address}`);
console.log("\nAdd this to .env:  FAULTLINE_CONTRACT_ADDRESS=" + address);
