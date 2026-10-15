/**
 * examples/full-workflow.ts
 *
 * End-to-end demonstration of the soroban-merkle-airdrop SDK:
 *   1. Build a Merkle tree from a 3-entry distribution list
 *   2. Verify all three proofs off-chain
 *   3. Submit (or print) a claim transaction for the first address
 *
 * Usage:
 *   npx ts-node examples/full-workflow.ts
 *
 * Environment variables:
 *   CONTRACT_ID   – Deployed airdrop contract address (C...)  [required for live claim]
 *   SECRET_KEY    – Claimant's Stellar secret key (S...)      [required for live claim]
 *   NETWORK       – "testnet" | "mainnet"                     [default: testnet]
 *   DRY_RUN       – Set to "1" to print the signed XDR instead of submitting [default: 0]
 *
 * Example (dry-run, no keys needed):
 *   DRY_RUN=1 npx ts-node examples/full-workflow.ts
 */

import {
  buildMerkleTree,
  verifyProof,
  createAirdropClient,
  NETWORKS,
  AirdropContractError,
  AirdropError,
  RpcError,
} from "@soroban-merkle-airdrop/sdk";

// ─── Configuration ─────────────────────────────────────────────────────────

const NETWORK    = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const SECRET_KEY  = process.env.SECRET_KEY ?? "";
const DRY_RUN     = process.env.DRY_RUN === "1";

// ─── Step 1: Define the airdrop distribution ───────────────────────────────

/**
 * Three representative recipients.
 * In a real deployment these would come from a CSV file processed by
 * `merkle-airdrop generate`.
 */
const ENTRIES = [
  {
    address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    amount: 1_000n,
  },
  {
    address: "GAYOLLLUIZE4DZMBB2ZBKGBUBZLIOYU6XFLW37GBP2VZD3ABNXCW4BVA",
    amount: 500n,
  },
  {
    address: "GBVG2QOHHFBVHAEGNF4XRUCAPAGWDROONM2LC4BK4ECCQ5RTQOO64VBW",
    amount: 250n,
  },
];

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== soroban-merkle-airdrop full workflow ===\n");

  // ── Step 1: Build the Merkle tree ─────────────────────────────────────────
  console.log("Step 1: Building Merkle tree from 3 entries…");

  const { root, proofs } = buildMerkleTree(CONTRACT_ID, ENTRIES);

  console.log(`  Merkle root : ${root}`);
  console.log(`  Entries     : ${proofs.size}`);
  console.log();

  // Print each proof for visibility
  for (const entry of ENTRIES) {
    const p = proofs.get(entry.address)!;
    console.log(`  ${entry.address.slice(0, 10)}…`);
    console.log(`    amount : ${entry.amount.toString()} tokens`);
    console.log(`    proof  : [${p.proof.map((h) => h.slice(0, 8) + "…").join(", ")}]`);
  }
  console.log();

  // ── Step 2: Verify all proofs off-chain ───────────────────────────────────
  console.log("Step 2: Verifying all proofs off-chain…");

  let allValid = true;
  for (const entry of ENTRIES) {
    const p = proofs.get(entry.address)!;
    const valid = verifyProof(root, CONTRACT_ID, p.address, p.amount, p.proof);
    console.log(`  ${entry.address.slice(0, 16)}…  →  ${valid ? "✓ valid" : "✗ INVALID"}`);
    if (!valid) allValid = false;
  }

  if (!allValid) {
    console.error("\n❌ One or more proofs failed verification. Aborting.");
    process.exit(1);
  }
  console.log("  All proofs verified ✓\n");

  // Also confirm a tampered proof is correctly rejected
  const tampered = verifyProof(root, CONTRACT_ID, ENTRIES[0].address, 9_999n, proofs.get(ENTRIES[0].address)!.proof);
  console.log(`  Tampered-amount proof correctly rejected: ${!tampered ? "✓" : "❌ UNEXPECTED PASS"}\n`);

  // ── Step 3: Submit (or print) a claim transaction ─────────────────────────
  console.log("Step 3: Claiming tokens for the first address…");

  if (!CONTRACT_ID) {
    console.log(
      "  ℹ  CONTRACT_ID is not set.\n" +
      "     Set CONTRACT_ID=<your contract C...> and SECRET_KEY=<S...> to submit a live claim.\n" +
      "     Set DRY_RUN=1 to build and print the transaction XDR without submitting.\n"
    );
    console.log("=== Workflow complete (read-only mode) ===");
    return;
  }

  const claimProof = proofs.get(ENTRIES[0].address)!;

  if (DRY_RUN) {
    // ── Dry-run: print unsigned XDR without submitting ──────────────────────
    console.log("  DRY_RUN=1 — building unsigned transaction XDR…");

    const client = createAirdropClient({ ...NETWORKS[NETWORK], contractId: CONTRACT_ID });

    try {
      const unsignedXdr = await client.buildClaimTransaction(claimProof);
      console.log("\n  Unsigned transaction XDR (base64):");
      console.log(`  ${unsignedXdr}`);
      console.log(
        "\n  Sign this XDR with your wallet and submit via:\n" +
        "    client.submitSignedTransaction(signedXdr, proof)"
      );
    } catch (err) {
      handleError(err);
    }

    console.log("\n=== Workflow complete (dry-run) ===");
    return;
  }

  // ── Live claim: sign with SECRET_KEY and submit ───────────────────────────
  if (!SECRET_KEY) {
    console.error(
      "  ❌ SECRET_KEY is not set. Provide the claimant's Stellar secret key (S...)\n" +
      "     or set DRY_RUN=1 to build the transaction without submitting."
    );
    process.exit(1);
  }

  const client = createAirdropClient({ ...NETWORKS[NETWORK], contractId: CONTRACT_ID });

  console.log(`  Network   : ${NETWORK}`);
  console.log(`  Contract  : ${CONTRACT_ID}`);
  console.log(`  Claimant  : ${claimProof.address}`);
  console.log(`  Amount    : ${claimProof.amount.toString()} tokens`);
  console.log("  Submitting claim transaction…\n");

  try {
    const result = await client.claim(claimProof, SECRET_KEY);
    console.log(`  ✓ Claim successful!`);
    console.log(`    tx hash : ${result.txHash}`);
    console.log(`    amount  : ${result.amount.toString()} tokens`);
    console.log(
      `    explorer: https://stellar.expert/explorer/${NETWORK}/tx/${result.txHash}`
    );
  } catch (err) {
    handleError(err);
  }

  console.log("\n=== Workflow complete ===");
}

// ─── Error handler ─────────────────────────────────────────────────────────

function handleError(err: unknown): never {
  if (err instanceof AirdropContractError) {
    if (err.code === AirdropError.AlreadyClaimed) {
      console.error("  ❌ This address has already claimed its tokens.");
    } else if (err.code === AirdropError.InvalidProof) {
      console.error("  ❌ Proof rejected by the contract. Tree may not match the deployed contract.");
    } else if (err.code === AirdropError.AirdropInactive) {
      console.error("  ❌ The airdrop is no longer active.");
    } else {
      console.error(`  ❌ Contract error (code ${err.code}): ${err.message}`);
    }
  } else if (err instanceof RpcError) {
    console.error(`  ❌ RPC error: ${err.message}`);
  } else {
    console.error("  ❌ Unexpected error:", err);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
