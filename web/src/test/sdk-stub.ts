/**
 * Minimal stub for @soroban-merkle-airdrop/sdk used in tests.
 * The actual implementation is mocked via vi.mock() in test files,
 * so this file just needs to export the right shape for TypeScript.
 */

export type Network = "testnet" | "mainnet";

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://mainnet.stellar.validation.network",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

export interface ClaimProof {
  address: string;
  amount: bigint;
  proof: string[];
}

export interface AirdropClient {
  isClaimed(address: string): Promise<boolean>;
  buildClaimTransaction(proof: ClaimProof): Promise<string>;
  submitSignedTransaction(
    signedXdr: string,
    proof: ClaimProof
  ): Promise<{ txHash: string; amount: bigint }>;
}

export function createAirdropClient(_config: {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}): AirdropClient {
  throw new Error("stub — should be mocked in tests");
}

export function verifyProof(
  _root: string,
  _contractId: string,
  _address: string,
  _amount: bigint,
  _proof: string[]
): boolean {
  throw new Error("stub — should be mocked in tests");
}

export function buildMerkleTree(
  _contractId: string,
  _entries: Array<{ address: string; amount: bigint }>
): { root: string; proofs: Record<string, ClaimProof> } {
  throw new Error("stub — should be mocked in tests");
}
