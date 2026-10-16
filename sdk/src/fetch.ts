/**
 * @module fetch
 * @description
 * Utility for fetching a hosted Merkle tree JSON file.
 *
 * Airdrop operators can host the `merkle-tree.json` produced by
 * `merkle-airdrop generate` at a public URL.  Recipients (and the web UI)
 * can call {@link fetchMerkleTree} to download and validate it without
 * needing the file locally.
 *
 * Works in both Node.js 18+ (native `fetch`) and browser environments.
 */

import type { MerkleTreeFile } from "./types.js";

/**
 * Fetch a hosted Merkle tree JSON file, validate its structure, and return a
 * typed {@link MerkleTreeFile} object.
 *
 * The function checks that all required top-level fields are present and have
 * the correct types.  It does **not** re-verify every individual proof (that
 * would be O(n·log n)) — callers should use {@link verifyProof} on individual
 * entries when needed.
 *
 * @param url - Public URL that serves the `merkle-tree.json` file.
 * @returns A validated {@link MerkleTreeFile}.
 * @throws {Error} If the HTTP request fails (non-2xx status).
 * @throws {Error} If the response is not valid JSON.
 * @throws {Error} If required fields are missing or have wrong types.
 *
 * @example
 * ```ts
 * import { fetchMerkleTree } from '@soroban-merkle-airdrop/sdk';
 *
 * const tree = await fetchMerkleTree(
 *   'https://my-airdrop.example.com/merkle-tree.json'
 * );
 *
 * console.log('Merkle root:', tree.root);
 * console.log('Total recipients:', tree.totalEntries);
 *
 * const myProof = tree.proofs['GABC...'];
 * if (!myProof) {
 *   console.log('Address not in airdrop');
 * }
 * ```
 */
export async function fetchMerkleTree(url: string): Promise<MerkleTreeFile> {
  // Fetch the URL — works in Node.js 18+ and browsers via native fetch.
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(
      `fetchMerkleTree: network request failed for "${url}": ${(cause as Error).message}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `fetchMerkleTree: HTTP ${response.status} ${response.statusText} for "${url}"`
    );
  }

  // Parse JSON.
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(
      `fetchMerkleTree: response from "${url}" is not valid JSON`
    );
  }

  // Validate and return.
  return validateMerkleTreeFile(raw, url);
}

/**
 * Validate a parsed JSON value as a {@link MerkleTreeFile}.
 *
 * Exported for testing so it can be called with pre-parsed objects without
 * spinning up an HTTP server.
 *
 * @param raw    - The parsed (but untyped) JSON value.
 * @param source - Origin label used in error messages (URL or `"<object>"`).
 * @returns The value cast to {@link MerkleTreeFile} after all checks pass.
 * @throws {Error} If any required field is absent or has the wrong type.
 */
export function validateMerkleTreeFile(
  raw: unknown,
  source = "<object>"
): MerkleTreeFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `fetchMerkleTree: expected a JSON object from "${source}", got ${
        raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw
      }`
    );
  }

  const obj = raw as Record<string, unknown>;

  // ── root ─────────────────────────────────────────────────────────────────
  if (typeof obj["root"] !== "string" || !/^[0-9a-fA-F]{64}$/.test(obj["root"])) {
    throw new Error(
      `fetchMerkleTree: missing or invalid "root" field in "${source}" ` +
      `(expected a 64-character hex string)`
    );
  }

  // ── totalEntries ─────────────────────────────────────────────────────────
  if (typeof obj["totalEntries"] !== "number" || !Number.isInteger(obj["totalEntries"]) || obj["totalEntries"] < 0) {
    throw new Error(
      `fetchMerkleTree: missing or invalid "totalEntries" field in "${source}" ` +
      `(expected a non-negative integer)`
    );
  }

  // ── totalAmount ──────────────────────────────────────────────────────────
  if (typeof obj["totalAmount"] !== "string" || !/^\d+$/.test(obj["totalAmount"])) {
    throw new Error(
      `fetchMerkleTree: missing or invalid "totalAmount" field in "${source}" ` +
      `(expected a decimal integer string)`
    );
  }

  // ── generatedAt ──────────────────────────────────────────────────────────
  if (typeof obj["generatedAt"] !== "string" || obj["generatedAt"].length === 0) {
    throw new Error(
      `fetchMerkleTree: missing or invalid "generatedAt" field in "${source}" ` +
      `(expected a non-empty ISO-8601 string)`
    );
  }

  // ── proofs ───────────────────────────────────────────────────────────────
  if (
    obj["proofs"] === null ||
    typeof obj["proofs"] !== "object" ||
    Array.isArray(obj["proofs"])
  ) {
    throw new Error(
      `fetchMerkleTree: missing or invalid "proofs" field in "${source}" ` +
      `(expected an object)`
    );
  }

  const proofs = obj["proofs"] as Record<string, unknown>;

  for (const [address, entry] of Object.entries(proofs)) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      throw new Error(
        `fetchMerkleTree: proofs["${address}"] in "${source}" is not an object`
      );
    }
    const e = entry as Record<string, unknown>;

    if (typeof e["address"] !== "string") {
      throw new Error(
        `fetchMerkleTree: proofs["${address}"].address in "${source}" must be a string`
      );
    }
    if (typeof e["amount"] !== "string" || !/^\d+$/.test(e["amount"])) {
      throw new Error(
        `fetchMerkleTree: proofs["${address}"].amount in "${source}" must be a decimal integer string`
      );
    }
    if (
      !Array.isArray(e["proof"]) ||
      !(e["proof"] as unknown[]).every((h) => typeof h === "string")
    ) {
      throw new Error(
        `fetchMerkleTree: proofs["${address}"].proof in "${source}" must be an array of strings`
      );
    }
  }

  return obj as unknown as MerkleTreeFile;
}
