/**
 * @module types
 * @description
 * Shared types, interfaces, and error classes for the soroban-merkle-airdrop SDK.
 */

// ─── Core data types ─────────────────────────────────────────────────────────

/**
 * A single entry in the airdrop distribution list.
 *
 * @example
 * ```ts
 * const entry: AirdropEntry = {
 *   address: "GABC...",
 *   amount: 1000n,
 * };
 * ```
 */
export interface AirdropEntry {
  /** Stellar strkey address of the recipient (G... for accounts, C... for contracts). */
  address: string;
  /** Token amount allocated to this recipient, in base units (e.g. stroops). */
  amount: bigint;
}

/**
 * A claimant's proof package — everything needed to call `claim` or
 * `buildClaimTransaction`.
 *
 * Produced by {@link buildMerkleTree} and stored in `merkle-tree.json`.
 *
 * @example
 * ```ts
 * const proof: ClaimProof = proofs.get("GABC...")!;
 * await client.claim(proof, secretKey);
 * ```
 */
export interface ClaimProof {
  /** The claimant's Stellar strkey address. */
  address: string;
  /** The allocated token amount in base units. */
  amount: bigint;
  /**
   * Ordered list of sibling node hashes (hex strings) from leaf to root.
   * The contract verifies this path on-chain.
   */
  proof: string[];
}

/**
 * The full output of {@link buildMerkleTree}.
 *
 * @example
 * ```ts
 * const result: MerkleTreeResult = buildMerkleTree(entries);
 * console.log(result.root);            // hex Merkle root → store on-chain
 * console.log(result.proofs.size);     // number of eligible addresses
 * ```
 */
export interface MerkleTreeResult {
  /** 32-byte Merkle root encoded as a 64-character hex string. */
  root: string;
  /**
   * Map from Stellar strkey address → {@link ClaimProof} for every entry.
   * Serialise this map to JSON to produce the `merkle-tree.json` file that
   * recipients load in the web UI or CLI.
   */
  proofs: Map<string, ClaimProof>;
}

// ─── Network configuration ───────────────────────────────────────────────────

/**
 * Network configuration passed to {@link createAirdropClient}.
 *
 * @example
 * ```ts
 * const config: NetworkConfig = {
 *   ...NETWORKS.testnet,
 *   contractId: "CXXXXXXX...",
 * };
 * ```
 */
export interface NetworkConfig {
  /** Identifies the target network. */
  network: "testnet" | "mainnet";
  /** Soroban RPC endpoint URL (e.g. `https://soroban-testnet.stellar.org`). */
  rpcUrl: string;
  /** Stellar network passphrase used to sign transactions. */
  networkPassphrase: string;
  /** Deployed airdrop contract address (C...). */
  contractId: string;
  /**
   * Maximum time in milliseconds to wait for a submitted transaction to be
   * confirmed on-chain. The polling loop throws a {@link RpcError} if this
   * limit is exceeded.
   *
   * @default 60000
   */
  pollTimeoutMs?: number;
}

/**
 * Well-known network presets for testnet and mainnet.
 *
 * Spread these into a {@link NetworkConfig} and add your `contractId`:
 *
 * @example
 * ```ts
 * import { NETWORKS, createAirdropClient } from '@soroban-merkle-airdrop/sdk';
 *
 * const client = createAirdropClient({
 *   ...NETWORKS.testnet,
 *   contractId: "CXXXXXXX...",
 * });
 * ```
 */
export const NETWORKS: Record<string, Omit<NetworkConfig, "contractId">> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

// ─── Merkle tree file ────────────────────────────────────────────────────────

/**
 * The serialised form of a Merkle tree JSON file produced by
 * `merkle-airdrop generate` and consumed by {@link fetchMerkleTree}.
 *
 * @example
 * ```ts
 * import { fetchMerkleTree } from '@soroban-merkle-airdrop/sdk';
 *
 * const tree = await fetchMerkleTree('https://example.com/merkle-tree.json');
 * console.log(tree.root);          // 64-char hex Merkle root
 * console.log(tree.totalEntries);  // number of airdrop recipients
 * ```
 */
export interface MerkleTreeFile {
  /** 64-character hex Merkle root — store this on-chain via `initialize`. */
  root: string;
  /** Total number of eligible recipients. */
  totalEntries: number;
  /** Total token amount allocated across all recipients (decimal string). */
  totalAmount: string;
  /** ISO-8601 timestamp when the tree was generated. */
  generatedAt: string;
  /**
   * Map from Stellar strkey address → serialised {@link ClaimProof}.
   * Amounts are stored as decimal strings (not bigints) for JSON compatibility.
   */
  proofs: Record<
    string,
    {
      address: string;
      /** Amount as a decimal string — use `BigInt(proof.amount)` to convert. */
      amount: string;
      proof: string[];
    }
  >;
}

// ─── Claim result ────────────────────────────────────────────────────────────

/**
 * Returned by {@link createAirdropClient.claim} and
 * {@link createAirdropClient.submitSignedTransaction} on success.
 *
 * @example
 * ```ts
 * const result: ClaimResult = await client.claim(proof, secretKey);
 * console.log(`Claimed ${result.amount} tokens in tx ${result.txHash}`);
 * ```
 */
export interface ClaimResult {
  /** Always `true` for a successful claim. */
  success: boolean;
  /** On-chain transaction hash. */
  txHash: string;
  /** The claimant's address. */
  address: string;
  /** The amount of tokens claimed, in base units. */
  amount: bigint;
}

// ─── Error types ─────────────────────────────────────────────────────────────

/**
 * Numeric error codes returned by the on-chain airdrop contract.
 *
 * These must stay in sync with the `AirdropError` enum in
 * `contracts/airdrop/src/types.rs`.
 *
 * @example
 * ```ts
 * import { AirdropError, AirdropContractError } from '@soroban-merkle-airdrop/sdk';
 *
 * try {
 *   await client.claim(proof, secretKey);
 * } catch (err) {
 *   if (err instanceof AirdropContractError) {
 *     if (err.code === AirdropError.AlreadyClaimed) {
 *       console.log("Already claimed!");
 *     }
 *   }
 * }
 * ```
 */
export enum AirdropError {
  /** The address has already submitted a successful claim. */
  AlreadyClaimed = 1,
  /** The supplied Merkle proof does not verify against the on-chain root. */
  InvalidProof = 2,
  /** The airdrop contract is not currently active. */
  AirdropInactive = 3,
  /** The contract does not hold enough tokens to pay the claim. */
  InsufficientFunds = 4,
  /** The caller is not authorised to perform this action. */
  Unauthorized = 5,
}

/**
 * Thrown when the airdrop contract returns a known error code.
 *
 * Allows callers to distinguish contract-level failures (e.g. already claimed,
 * invalid proof) from network-level failures ({@link RpcError}).
 *
 * @example
 * ```ts
 * import { AirdropContractError, AirdropError } from '@soroban-merkle-airdrop/sdk';
 *
 * try {
 *   await client.claim(proof, secretKey);
 * } catch (err) {
 *   if (err instanceof AirdropContractError && err.code === AirdropError.AlreadyClaimed) {
 *     console.log("This address has already claimed its tokens.");
 *   }
 * }
 * ```
 */
export class AirdropContractError extends Error {
  /**
   * The numeric error code from the contract.
   * Matches one of the values in {@link AirdropError}.
   */
  readonly code: number;

  /**
   * @param code - The numeric contract error code (see {@link AirdropError}).
   * @param message - Optional human-readable message. Defaults to a description
   *   derived from the error code.
   */
  constructor(code: number, message?: string) {
    super(message ?? AirdropContractError.defaultMessage(code));
    this.name = "AirdropContractError";
    this.code = code;
    // Maintain proper prototype chain in transpiled ES5 output.
    Object.setPrototypeOf(this, AirdropContractError.prototype);
  }

  private static defaultMessage(code: number): string {
    switch (code) {
      case AirdropError.AlreadyClaimed:    return "Address has already claimed";
      case AirdropError.InvalidProof:      return "Invalid Merkle proof";
      case AirdropError.AirdropInactive:   return "Airdrop is not active";
      case AirdropError.InsufficientFunds: return "Insufficient contract funds";
      case AirdropError.Unauthorized:      return "Unauthorized";
      default:                             return `Contract error (code ${code})`;
    }
  }
}

/**
 * Thrown for network-level or RPC errors.
 *
 * Covers connection failures, simulation errors, transaction submission
 * failures, and polling timeouts.
 *
 * @example
 * ```ts
 * import { RpcError } from '@soroban-merkle-airdrop/sdk';
 *
 * try {
 *   await client.isActive();
 * } catch (err) {
 *   if (err instanceof RpcError) {
 *     console.error("Network error:", err.message);
 *   }
 * }
 * ```
 */
export class RpcError extends Error {
  /**
   * The underlying cause, if available (e.g. an XDR-encoded error result or
   * the original `Error` from `fetch`).
   */
  readonly cause?: unknown;

  /**
   * @param message - Human-readable description of the failure.
   * @param cause - Optional underlying cause for debugging.
   */
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RpcError";
    this.cause = cause;
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}
