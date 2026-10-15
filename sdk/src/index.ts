/**
 * @soroban-merkle-airdrop/sdk
 *
 * Public API surface for the soroban-merkle-airdrop TypeScript SDK.
 *
 * @example
 * ```ts
 * import { buildMerkleTree, createAirdropClient, NETWORKS } from '@soroban-merkle-airdrop/sdk';
 *
 * const { root, proofs } = buildMerkleTree([
 *   { address: "GABC...", amount: 1000n },
 * ]);
 *
 * const client = createAirdropClient({ ...NETWORKS.testnet, contractId: "C..." });
 * ```
 */

// ─── Merkle helpers ──────────────────────────────────────────────────────────
export { buildMerkleTree, leafHash, hashPair, verifyProof } from "./merkle.js";

// ─── Contract client ─────────────────────────────────────────────────────────
export { createAirdropClient } from "./client.js";

// ─── Fetch utility ───────────────────────────────────────────────────────────
export { fetchMerkleTree, validateMerkleTreeFile } from "./fetch.js";

// ─── Types and network presets ───────────────────────────────────────────────
export type {
  AirdropEntry,
  ClaimProof,
  MerkleTreeResult,
  MerkleTreeFile,
  NetworkConfig,
  ClaimResult,
} from "./types.js";
export { NETWORKS, formatAmount } from "./types.js";
