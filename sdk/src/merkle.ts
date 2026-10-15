/**
 * @module merkle
 * @description
 * Merkle tree builder for soroban-merkle-airdrop.
 *
 * Produces a binary Merkle tree from a list of (address, amount) pairs.
 * The on-chain contract uses SHA-256 with lexicographic node sorting, so
 * this implementation must match exactly.
 *
 * **Leaf hash algorithm**
 * ```
 * SHA-256( SHA-256(address_strkey_utf8_bytes) ++ amount_big_endian[16] )
 * ```
 *
 * The address is hashed as its Stellar strkey string (e.g. `G...` for
 * accounts, `C...` for contracts) encoded as UTF-8 bytes — NOT as raw
 * decoded key bytes. This matches the Rust contract's `merkle::leaf_hash`
 * which calls `claimant.to_string()` to obtain the strkey and then
 * SHA-256-hashes the resulting bytes.
 *
 * **Node hash algorithm**
 * ```
 * SHA-256(min(left, right) ++ max(left, right))
 * ```
 * Sorted so the tree is position-independent.
 */

import { createHash } from "crypto";
import type { AirdropEntry, ClaimProof, MerkleTreeResult } from "./types.js";

// ─── Internal helpers ────────────────────────────────────────────────────────

/** @internal */
function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the leaf hash for a given (contractId, address, amount) triple.
 *
 * Must match `merkle::leaf_hash` in the Rust contract exactly.
 *
 * **Algorithm:**
 * 1. `contract_hash = SHA-256(UTF-8 bytes of the contract Stellar strkey)`
 * 2. `addr_hash     = SHA-256(UTF-8 bytes of the claimant Stellar strkey)`
 * 3. `leaf          = SHA-256(contract_hash ++ addr_hash ++ amount as 16-byte big-endian i128)`
 *
 * The contract address is prepended as a domain separator so that a proof
 * that is valid on one deployment cannot be replayed against a second
 * deployment using the same Merkle root. See docs/replay-attack-analysis.md.
 *
 * Note: both addresses are hashed as their strkey **string** bytes. Decoding
 * the strkey to raw bytes and hashing those would produce a different result.
 *
 * @param contractId - Stellar strkey of the airdrop contract (C...).
 * @param address - Stellar strkey address of the claimant (G... or C...).
 * @param amount - Token amount in base units (bigint, non-negative).
 * @returns 32-byte SHA-256 leaf hash as a Buffer.
 *
 * @example
 * ```ts
 * import { leafHash } from '@soroban-merkle-airdrop/sdk';
 *
 * const hash = leafHash("CABC...", "GABC...", 1000n);
 * console.log(hash.toString("hex")); // 64-character hex string
 * ```
 */
export function leafHash(contractId: string, address: string, amount: bigint): Buffer {
  // Step 1: SHA-256 the UTF-8 bytes of the contract strkey (domain separator).
  const contractHash = sha256(Buffer.from(contractId, "utf8"));

  // Step 2: SHA-256 the UTF-8 bytes of the claimant strkey.
  // This matches Rust: env.crypto().sha256(&claimant.to_string().to_bytes())
  const addrHash = sha256(Buffer.from(address, "utf8"));

  // Step 3: Encode amount as 16-byte big-endian (i128 = two 64-bit words).
  const amountBuf = Buffer.alloc(16);
  const hi = amount >> 64n;
  const lo = amount & 0xffffffffffffffffn;
  amountBuf.writeBigInt64BE(BigInt.asIntN(64, hi), 0);
  amountBuf.writeBigUInt64BE(lo, 8);

  // Step 4: SHA-256(contract_hash ++ addr_hash ++ amount_be16)
  return sha256(Buffer.concat([contractHash, addrHash, amountBuf]));
}

/**
 * Hash two Merkle tree nodes together, sorting them lexicographically first.
 *
 * Must match `merkle::hash_pair` in the Rust contract.
 * Sorting ensures the tree is position-independent: swapping the left and right
 * children produces the same parent hash.
 *
 * @param a - 32-byte left node hash (order relative to `b` does not matter).
 * @param b - 32-byte right node hash.
 * @returns 32-byte SHA-256 parent hash as a Buffer.
 *
 * @example
 * ```ts
 * import { hashPair } from '@soroban-merkle-airdrop/sdk';
 *
 * const parent = hashPair(leftHash, rightHash);
 * // hashPair(leftHash, rightHash) === hashPair(rightHash, leftHash)
 * ```
 */
export function hashPair(a: Buffer, b: Buffer): Buffer {
  const [first, second] = a.compare(b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([first, second]));
}

/**
 * Build a Merkle tree from a list of airdrop entries and return the root
 * and per-address claim proofs.
 *
 * The resulting root must be stored on-chain via the contract's `initialize`
 * function. Each `ClaimProof` in the returned map is passed to `claim` or
 * `buildClaimTransaction` when a recipient wants to claim their tokens.
 *
 * @param contractId - Stellar strkey of the deployed airdrop contract (C...).
 *   Included in the leaf hash as a domain separator to prevent cross-contract
 *   proof replay attacks (see docs/replay-attack-analysis.md).
 * @param entries - Array of `{ address, amount }` pairs. Addresses must be unique.
 * @returns `{ root, proofs }` — the hex Merkle root and a map from address → ClaimProof.
 * @throws {Error} If `entries` is empty or contains duplicate addresses.
 *
 * @example
 * ```ts
 * import { buildMerkleTree } from '@soroban-merkle-airdrop/sdk';
 *
 * const { root, proofs } = buildMerkleTree("CABC...", [
 *   { address: "GABC...", amount: 1000n },
 *   { address: "GDEF...", amount: 500n },
 *   { address: "GHIJ...", amount: 250n },
 * ]);
 *
 * console.log("Merkle root:", root);
 * // root is a 64-character hex string that goes on-chain
 *
 * const proof = proofs.get("GABC...");
 * if (proof) {
 *   console.log("Proof hashes:", proof.proof);
 * }
 * ```
 */
export function buildMerkleTree(contractId: string, entries: AirdropEntry[]): MerkleTreeResult {
  if (entries.length === 0) {
    throw new Error("Cannot build Merkle tree from empty list");
  }

  // Deduplicate by address.
  const seen = new Set<string>();
  const unique: AirdropEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.address)) {
      throw new Error(`Duplicate address in airdrop list: ${e.address}`);
    }
    seen.add(e.address);
    unique.push(e);
  }

  // Compute leaves in order — including the contract domain separator.
  const leaves: Buffer[] = unique.map((e) => leafHash(contractId, e.address, e.amount));

  // Build tree layer by layer.
  // `layers[0]` = leaf hashes, `layers[last]` = [root].
  const layers: Buffer[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        // Odd node: promote unchanged.
        next.push(current[i]);
      }
    }
    layers.push(next);
    current = next;
  }

  const root = current[0].toString("hex");

  // Build proofs for each leaf.
  const proofs = new Map<string, ClaimProof>();

  for (let i = 0; i < unique.length; i++) {
    const entry = unique[i];
    const proofHashes: string[] = [];
    let idx = i;

    for (let layer = 0; layer < layers.length - 1; layer++) {
      const nodes = layers[layer];
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < nodes.length) {
        proofHashes.push(nodes[siblingIdx].toString("hex"));
      }
      idx = Math.floor(idx / 2);
    }

    proofs.set(entry.address, {
      address: entry.address,
      amount: entry.amount,
      proof: proofHashes,
    });
  }

  return { root, proofs };
}

/**
 * Verify that a Merkle proof is valid against a known root.
 *
 * Useful for off-chain validation before submitting a claim transaction,
 * and for confirming that a `merkle-tree.json` file has not been tampered with.
 *
 * @param root - The 64-character hex Merkle root string stored on-chain.
 * @param contractId - Stellar strkey of the airdrop contract (C...).
 *   Must match the contract against which the claim will be submitted.
 * @param address - The claimant's Stellar strkey address.
 * @param amount - The allocated token amount in base units.
 * @param proof - Ordered array of sibling hashes (hex strings) from leaf to root.
 * @returns `true` if the proof is valid, `false` otherwise.
 *
 * @example
 * ```ts
 * import { buildMerkleTree, verifyProof } from '@soroban-merkle-airdrop/sdk';
 *
 * const contractId = "CABC...";
 * const { root, proofs } = buildMerkleTree(contractId, [
 *   { address: "GABC...", amount: 1000n },
 *   { address: "GDEF...", amount: 500n },
 * ]);
 *
 * const claimProof = proofs.get("GABC...")!;
 * const valid = verifyProof(root, contractId, claimProof.address, claimProof.amount, claimProof.proof);
 * console.log(valid); // true
 *
 * // Tampered amount returns false
 * console.log(verifyProof(root, contractId, "GABC...", 9999n, claimProof.proof)); // false
 * ```
 */
export function verifyProof(
  root: string,
  contractId: string,
  address: string,
  amount: bigint,
  proof: string[]
): boolean {
  let current = leafHash(contractId, address, amount);

  for (const sibling of proof) {
    current = hashPair(current, Buffer.from(sibling, "hex"));
  }

  return current.toString("hex") === root;
}
