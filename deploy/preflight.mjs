// Preflight: confirm the deployer is funded and the network is reachable.
// Reads ACCOUNT_PRIVATE_KEY only to derive the public address — never prints it.
import "dotenv/config";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

let key = (process.env.ACCOUNT_PRIVATE_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key.startsWith("0x") ? key : "0x" + key)) {
  console.error("ACCOUNT_PRIVATE_KEY not set or malformed in .env — see .env.example.");
  process.exit(1);
}
if (!key.startsWith("0x")) key = "0x" + key;

const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });

const balance = await client.getBalance({ address: account.address });
console.log("network :", testnetBradbury.name, "(id", testnetBradbury.id + ")");
console.log("deployer:", account.address);
console.log("balance :", balance.toString(), "wei");
console.log(balance > 0n ? "\n✅ funded — ready to deploy" : "\n⚠️  zero balance — fund at https://testnet-faucet.genlayer.foundation/");
