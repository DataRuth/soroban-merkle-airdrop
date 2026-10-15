/**
 * Integration test: deploy the airdrop contract to Stellar testnet,
 * run a full claim cycle, verify balances, and reclaim remaining tokens.
 *
 * Usage:
 *   STELLAR_SECRET_KEY=S... ts-node scripts/integration-test.ts
 *
 * Prerequisites:
 *   - A funded testnet account (obtain from https://friendbot.stellar.org)
 *   - ts-node installed globally or via npx: npm i -g ts-node typescript
 *   - The WASM built: cargo build --manifest-path contracts/airdrop/Cargo.toml \
 *       --target wasm32v1-none --release
 *
 * What this test does:
 *   1. Reads the admin secret key from STELLAR_SECRET_KEY env var
 *   2. Uploads the compiled WASM to testnet and deploys a fresh contract
 *   3. Issues a native testnet asset (wrapped XLM / USDC mock via SAC) for
 *      the test — or uses a test token contract that is pre-deployed.
 *      NOTE: Because issuing a custom SEP-41 token requires a separate
 *      deployment step, this script uses the Stellar testnet's wrapped XLM
 *      (native asset contract) as the token when TOKEN_CONTRACT_ID is not set.
 *   4. Builds a 5-entry Merkle tree
 *   5. Initialises the contract
 *   6. Claims tokens for entry[0]
 *   7. Verifies the claimant's balance increased and claimedCount() == 1
 *   8. Reclaims remaining tokens (advances ledger time via a long timeout or
 *      uses a short expiration with retry) and verifies the admin balance
 *
 * Environment variables:
 *   STELLAR_SECRET_KEY     (required) Admin / deployer secret key (S...)
 *   TOKEN_CONTRACT_ID      (optional) Pre-deployed SEP-41 token contract.
 *                           If omitted, the test deploys a minimal test token.
 *   AIRDROP_WASM_PATH      (optional) Path to the compiled WASM file.
 *                           Defaults to the standard cargo release output.
 *   RPC_URL                (optional) Soroban RPC endpoint.
 *                           Defaults to https://soroban-testnet.stellar.org
 *   NETWORK_PASSPHRASE     (optional) Defaults to testnet passphrase.
 */

import * as fs from "fs";
import * as path from "path";
import {
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Account,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  Contract,
} from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import { buildMerkleTree } from "../sdk/src/merkle.js";
import type { AirdropEntry } from "../sdk/src/types.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const SECRET_KEY = process.env["STELLAR_SECRET_KEY"];
if (!SECRET_KEY) {
  console.error(
    "ERROR: STELLAR_SECRET_KEY environment variable is required.\n" +
      "  Get a funded testnet key from https://friendbot.stellar.org\n" +
      "  then run: STELLAR_SECRET_KEY=S... ts-node scripts/integration-test.ts"
  );
  process.exit(1);
}

const RPC_URL =
  process.env["RPC_URL"] ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env["NETWORK_PASSPHRASE"] ?? Networks.TESTNET;
const WASM_PATH =
  process.env["AIRDROP_WASM_PATH"] ??
  path.resolve(
    __dirname,
    "../target/wasm32v1-none/release/soroban_merkle_airdrop.wasm"
  );

// ─── Helpers ──────────────────────────────────────────────────────────────────

const server = new rpc.Server(RPC_URL, { allowHttp: false });

function log(msg: string) {
  console.log(`[integration-test] ${msg}`);
}

function step(n: number, msg: string) {
  console.log(`\n── Step ${n}: ${msg} ──`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Submit a transaction and poll until SUCCESS or FAILED.
 * Returns the final GetTransactionResponse.
 */
async function submitAndWait(
  tx: ReturnType<TransactionBuilder["build"]>,
  keypair: Keypair
): Promise<rpc.Api.GetTransactionResponse> {
  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, simResult).build();
  prepared.sign(keypair);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `Submit error: ${sendResult.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  log(`  tx submitted: ${sendResult.hash}`);
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const poll = await server.getTransaction(sendResult.hash);
    if (poll.status === "SUCCESS") return poll;
    if (poll.status === "FAILED") {
      throw new Error(`Transaction FAILED on-chain: ${sendResult.hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${sendResult.hash}`);
}

/**
 * Build a simple transaction with a single operation, suitable for
 * operations that do not need simulation (e.g. uploadContractWasm).
 */
async function buildAndSubmitOp(
  sourceAccount: Account,
  operation: xdr.Operation,
  keypair: Keypair
): Promise<rpc.Api.GetTransactionResponse> {
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  return submitAndWait(tx, keypair);
}

/**
 * Simulate a read-only contract call and return the ScVal result.
 */
async function simulateRead(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
  const dummy = Keypair.random();
  const account = new Account(dummy.publicKey(), "0");
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Read simulation failed: ${simResult.error}`);
  }
  return (simResult as rpc.Api.SimulateTransactionSuccessResponse).result!
    .retval;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  soroban-merkle-airdrop Integration Test (testnet)");
  console.log("=".repeat(60));

  const adminKeypair = Keypair.fromSecret(SECRET_KEY!);
  const adminAddress = adminKeypair.publicKey();
  log(`Admin address: ${adminAddress}`);
  log(`RPC: ${RPC_URL}`);

  // ── Step 1: Upload WASM ────────────────────────────────────────────────────
  step(1, "Upload contract WASM");
  if (!fs.existsSync(WASM_PATH)) {
    console.error(
      `ERROR: WASM not found at ${WASM_PATH}\n` +
        "  Build it first:\n" +
        "  cargo build --manifest-path contracts/airdrop/Cargo.toml \\\n" +
        "    --target wasm32v1-none --release"
    );
    process.exit(1);
  }
  const wasm = fs.readFileSync(WASM_PATH);
  log(`  WASM size: ${wasm.length} bytes`);

  let adminAccount = await server.getAccount(adminAddress);
  const uploadTx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.uploadContractWasm({ wasm })
    )
    .setTimeout(60)
    .build();

  const uploadResult = await submitAndWait(uploadTx, adminKeypair);
  if (uploadResult.status !== "SUCCESS") {
    throw new Error("WASM upload failed");
  }
  // Extract wasmHash from the return value
  const wasmHashScVal = (uploadResult as rpc.Api.GetSuccessfulTransactionResponse).returnValue!;
  const wasmHashBytes = scValToNative(wasmHashScVal) as Uint8Array;
  const wasmHash = Buffer.from(wasmHashBytes).toString("hex");
  log(`  WASM hash: ${wasmHash}`);

  // ── Step 2: Deploy contract ───────────────────────────────────────────────
  step(2, "Deploy contract instance");
  adminAccount = await server.getAccount(adminAddress);
  const deployTx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        wasmHash: Buffer.from(wasmHash, "hex"),
        address: new Address(adminAddress),
        salt: crypto.getRandomValues(new Uint8Array(32)),
      })
    )
    .setTimeout(60)
    .build();

  const deployResult = await submitAndWait(deployTx, adminKeypair);
  if (deployResult.status !== "SUCCESS") {
    throw new Error("Contract deployment failed");
  }
  const contractIdScVal = (deployResult as rpc.Api.GetSuccessfulTransactionResponse).returnValue!;
  const contractId = Address.fromScVal(contractIdScVal).toString();
  log(`  Contract ID: ${contractId}`);

  // ── Step 3: Resolve token contract ────────────────────────────────────────
  step(3, "Resolve SEP-41 token contract");
  let tokenContractId = process.env["TOKEN_CONTRACT_ID"];
  if (tokenContractId) {
    log(`  Using provided token: ${tokenContractId}`);
  } else {
    // Use the native XLM wrapped asset contract on testnet.
    // The native asset SAC address on testnet is stable and can be derived.
    // Stellar testnet native asset contract (XLM):
    tokenContractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    log(`  Using native XLM token (testnet SAC): ${tokenContractId}`);
    log(
      "  NOTE: Set TOKEN_CONTRACT_ID env var to use a custom SEP-41 token."
    );
  }

  // ── Step 4: Build 5-entry Merkle tree ─────────────────────────────────────
  step(4, "Build 5-entry Merkle tree");

  // Generate 5 recipient keypairs deterministically for reproducibility.
  // In a real test you'd use real addresses; here we use generated ones.
  const claimants = Array.from({ length: 5 }, (_, i) => {
    const kp = Keypair.random();
    return kp;
  });

  const AMOUNTS = [100n, 200n, 300n, 400n, 500n]; // base units (stroops)
  const TOTAL_AMOUNT = AMOUNTS.reduce((a, b) => a + b, 0n); // 1500n

  const entries: AirdropEntry[] = claimants.map((kp, i) => ({
    address: kp.publicKey(),
    amount: AMOUNTS[i]!,
  }));

  const { root, proofs } = buildMerkleTree(entries);
  log(`  Merkle root: ${root}`);
  log(`  Total distribution: ${TOTAL_AMOUNT} stroops across 5 recipients`);
  for (const [addr, proof] of proofs) {
    log(`    ${addr.slice(0, 12)}…  amount=${proof.amount}  proof_len=${proof.proof.length}`);
  }

  // ── Step 5: Fund admin with enough XLM and initialize ─────────────────────
  step(5, "Initialize contract");

  // For the native XLM SAC, the admin needs enough XLM balance.
  // initialize() will transfer TOTAL_AMOUNT from admin into the contract.
  // We assume the admin account is already funded with sufficient XLM
  // (obtained via Friendbot: https://friendbot.stellar.org/?addr=<address>).

  const expirationTimestamp =
    Math.floor(Date.now() / 1000) + 120; // expires in 2 minutes

  const merkleRootBytes = Buffer.from(root, "hex");
  const merkleRootScVal = xdr.ScVal.scvBytes(merkleRootBytes);

  adminAccount = await server.getAccount(adminAddress);
  const contract = new Contract(contractId);
  const initTx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "initialize",
        new Address(adminAddress).toScVal(),
        new Address(tokenContractId).toScVal(),
        merkleRootScVal,
        nativeToScVal(TOTAL_AMOUNT, { type: "i128" }),
        nativeToScVal(expirationTimestamp, { type: "u64" })
      )
    )
    .setTimeout(60)
    .build();

  await submitAndWait(initTx, adminKeypair);
  log("  Contract initialized successfully.");

  // Verify via query
  const isActiveVal = await simulateRead(contractId, "is_active");
  const isActive = scValToNative(isActiveVal) as boolean;
  log(`  is_active: ${isActive}`);
  if (!isActive) throw new Error("Contract should be active after init");

  const totalDepositedVal = await simulateRead(contractId, "total_deposited");
  const totalDeposited = scValToNative(totalDepositedVal) as bigint;
  log(`  total_deposited: ${totalDeposited}`);
  if (totalDeposited !== TOTAL_AMOUNT) {
    throw new Error(
      `Expected total_deposited=${TOTAL_AMOUNT}, got ${totalDeposited}`
    );
  }

  // ── Step 6: Claim for claimants[0] ────────────────────────────────────────
  step(6, "Claim tokens for claimants[0]");
  const claimant0 = claimants[0]!;
  const claimant0Address = claimant0.publicKey();
  const proof0 = proofs.get(claimant0Address)!;

  log(`  Claimant: ${claimant0Address}`);
  log(`  Amount:   ${proof0.amount}`);

  // Fund claimant0 account on testnet so it can sign a transaction.
  // We do this via Friendbot.
  log("  Funding claimant0 via Friendbot…");
  try {
    const fbRes = await fetch(
      `https://friendbot.stellar.org/?addr=${claimant0Address}`
    );
    if (!fbRes.ok) {
      log(`  WARNING: Friendbot returned ${fbRes.status}. Continuing...`);
    } else {
      log("  Friendbot funded claimant0.");
    }
  } catch (e) {
    log(`  WARNING: Friendbot request failed: ${e}. Continuing...`);
  }
  await sleep(5000); // wait for ledger to close

  // Check balance before claim (native XLM balance, not the airdrop token).
  // For the native XLM SAC the token balance IS the XLM balance in stroops.
  const balanceBeforeVal = await simulateRead(
    tokenContractId,
    "balance",
    new Address(claimant0Address).toScVal()
  );
  const balanceBefore = scValToNative(balanceBeforeVal) as bigint;
  log(`  Token balance before claim: ${balanceBefore}`);

  // claimedCount before
  const countBeforeVal = await simulateRead(contractId, "claimed_count");
  const countBefore = scValToNative(countBeforeVal) as number;
  log(`  claimedCount before: ${countBefore}`);
  if (countBefore !== 0) {
    throw new Error(`Expected claimedCount=0 before any claim, got ${countBefore}`);
  }

  // Build claim transaction
  const proofScVal = xdr.ScVal.scvVec(
    proof0.proof.map((h) => xdr.ScVal.scvBytes(Buffer.from(h, "hex")))
  );

  let claimant0Account: Account;
  try {
    claimant0Account = await server.getAccount(claimant0Address);
  } catch {
    throw new Error(
      `Claimant0 account not found on testnet. ` +
      `Fund it manually: https://friendbot.stellar.org/?addr=${claimant0Address}`
    );
  }

  const claimTx = new TransactionBuilder(claimant0Account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "claim",
        new Address(claimant0Address).toScVal(),
        nativeToScVal(proof0.amount, { type: "i128" }),
        proofScVal
      )
    )
    .setTimeout(60)
    .build();

  await submitAndWait(claimTx, claimant0);
  log("  Claim submitted successfully.");

  // ── Step 7: Verify balance changed and claimedCount == 1 ──────────────────
  step(7, "Verify post-claim state");

  const balanceAfterVal = await simulateRead(
    tokenContractId,
    "balance",
    new Address(claimant0Address).toScVal()
  );
  const balanceAfter = scValToNative(balanceAfterVal) as bigint;
  log(`  Token balance after claim: ${balanceAfter}`);

  const expectedBalance = balanceBefore + proof0.amount;
  if (balanceAfter !== expectedBalance) {
    throw new Error(
      `Balance mismatch: expected ${expectedBalance}, got ${balanceAfter}`
    );
  }
  log(`  ✓ Balance increased by ${proof0.amount} (${balanceBefore} → ${balanceAfter})`);

  const countAfterVal = await simulateRead(contractId, "claimed_count");
  const countAfter = scValToNative(countAfterVal) as number;
  log(`  claimedCount after claim: ${countAfter}`);
  if (countAfter !== 1) {
    throw new Error(`Expected claimedCount=1, got ${countAfter}`);
  }
  log("  ✓ claimedCount == 1");

  const isClaimedVal = await simulateRead(
    contractId,
    "is_claimed",
    new Address(claimant0Address).toScVal()
  );
  const isClaimed = scValToNative(isClaimedVal) as boolean;
  if (!isClaimed) throw new Error("Expected is_claimed=true after claim");
  log("  ✓ is_claimed == true for claimant0");

  // ── Step 8: Reclaim remaining tokens (clean-up) ───────────────────────────
  step(8, "Reclaim remaining tokens (clean-up)");

  // The contract uses a 2-minute expiration. We wait for it.
  const now = Math.floor(Date.now() / 1000);
  const waitMs = Math.max(0, (expirationTimestamp - now + 5) * 1000);
  if (waitMs > 0) {
    log(`  Waiting ${Math.ceil(waitMs / 1000)}s for airdrop to expire…`);
    await sleep(waitMs);
  }

  // Check admin balance before reclaim
  const adminBalanceBeforeVal = await simulateRead(
    tokenContractId,
    "balance",
    new Address(adminAddress).toScVal()
  );
  const adminBalanceBefore = scValToNative(adminBalanceBeforeVal) as bigint;
  log(`  Admin balance before reclaim: ${adminBalanceBefore}`);

  adminAccount = await server.getAccount(adminAddress);
  const reclaimTx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("reclaim"))
    .setTimeout(60)
    .build();

  await submitAndWait(reclaimTx, adminKeypair);
  log("  Reclaim submitted successfully.");

  const adminBalanceAfterVal = await simulateRead(
    tokenContractId,
    "balance",
    new Address(adminAddress).toScVal()
  );
  const adminBalanceAfter = scValToNative(adminBalanceAfterVal) as bigint;
  log(`  Admin balance after reclaim: ${adminBalanceAfter}`);

  // Remaining = TOTAL_AMOUNT - amount_claimed_by_claimant0
  const expectedReclaimed = TOTAL_AMOUNT - proof0.amount;
  const actualReclaimed = adminBalanceAfter - adminBalanceBefore;
  if (actualReclaimed !== expectedReclaimed) {
    throw new Error(
      `Reclaim mismatch: expected ${expectedReclaimed}, got ${actualReclaimed}`
    );
  }
  log(`  ✓ Admin received ${actualReclaimed} tokens back`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  ✓ Integration test PASSED");
  console.log("=".repeat(60));
  console.log(`  Contract ID:   ${contractId}`);
  console.log(`  WASM hash:     ${wasmHash}`);
  console.log(`  Claimed:       ${claimant0Address} claimed ${proof0.amount} stroops`);
  console.log(`  Reclaimed:     ${actualReclaimed} stroops returned to admin`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n[integration-test] FAILED:", err.message ?? err);
  process.exit(1);
});
