import { vi } from "vitest";

// ─── Mock SDK ────────────────────────────────────────────────────────────────
export const mockIsClaimedFn = vi.fn<() => Promise<boolean>>();
export const mockBuildClaimTransactionFn = vi.fn<() => Promise<string>>();
export const mockSubmitSignedTransactionFn = vi.fn<() => Promise<{ txHash: string; amount: bigint }>>();

export const mockCreateAirdropClient = vi.fn(() => ({
  isClaimed: mockIsClaimedFn,
  buildClaimTransaction: mockBuildClaimTransactionFn,
  submitSignedTransaction: mockSubmitSignedTransactionFn,
}));

export const mockVerifyProof = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock("@soroban-merkle-airdrop/sdk", () => ({
  createAirdropClient: mockCreateAirdropClient,
  verifyProof: mockVerifyProof,
  NETWORKS: {
    testnet: { rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: "Test SDF Network ; September 2015" },
    mainnet: { rpcUrl: "https://mainnet.stellar.validation.network", networkPassphrase: "Public Global Stellar Network ; September 2015" },
  },
}));

// ─── Mock Freighter ──────────────────────────────────────────────────────────
export const mockIsConnected = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
export const mockGetPublicKey = vi.fn<() => Promise<string>>().mockResolvedValue("GABC1234TESTADDRESS");
export const mockSignTransaction = vi.fn<() => Promise<string>>().mockResolvedValue("signed-xdr-payload");

vi.mock("@stellar/freighter-api", () => ({
  isConnected: mockIsConnected,
  getPublicKey: mockGetPublicKey,
  signTransaction: mockSignTransaction,
}));
