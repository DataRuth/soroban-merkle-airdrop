/**
 * Unit tests for createAirdropClient — focusing on Issue #15: polling timeout.
 *
 * The RPC layer is fully mocked so these tests run instantly without any
 * network access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAirdropClient } from "./client.js";
import { RpcError } from "./types.js";

// ─── Minimal mocks for @stellar/stellar-sdk ────────────────────────────────

// We mock the entire stellar-sdk module so no real network calls are made.
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

  // Stub that records calls and returns controllable values.
  const mockSendTransaction = vi.fn();
  const mockGetTransaction = vi.fn();
  const mockGetAccount = vi.fn();
  const mockSimulateTransaction = vi.fn();

  const MockServer = vi.fn().mockImplementation(() => ({
    sendTransaction: mockSendTransaction,
    getTransaction: mockGetTransaction,
    getAccount: mockGetAccount,
    simulateTransaction: mockSimulateTransaction,
  }));

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: MockServer,
      assembleTransaction: vi.fn().mockReturnValue({ build: vi.fn().mockReturnValue({ toXDR: vi.fn(), sign: vi.fn() }) }),
      Api: actual.rpc?.Api ?? {},
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({}),
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: vi.fn() }),
    })),
    Account: vi.fn().mockImplementation(() => ({})),
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn().mockReturnValue({
        publicKey: vi.fn().mockReturnValue("GABC123"),
        sign: vi.fn(),
      }),
      random: vi.fn().mockReturnValue({
        publicKey: vi.fn().mockReturnValue("GRND123"),
      }),
    },
  };
});

// ─── Helper to get the mocked server instance ───────────────────────────────

async function getMockServer() {
  const sdk = await import("@stellar/stellar-sdk");
  // The Server constructor is mocked — grab the most recently created instance.
  const MockServer = sdk.rpc.Server as unknown as ReturnType<typeof vi.fn>;
  return MockServer.mock.results[MockServer.mock.results.length - 1]?.value as {
    sendTransaction: ReturnType<typeof vi.fn>;
    getTransaction: ReturnType<typeof vi.fn>;
    getAccount: ReturnType<typeof vi.fn>;
    simulateTransaction: ReturnType<typeof vi.fn>;
  };
}

// ─── Config helpers ─────────────────────────────────────────────────────────

const BASE_CONFIG = {
  network: "testnet" as const,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CTEST123456789",
};

const CLAIM_PROOF = {
  address: "GABC123",
  amount: 1000n,
  proof: [],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createAirdropClient — polling timeout (Issue #15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws RpcError with timeout message when pollTimeoutMs is exceeded in claim()", async () => {
    // Use a very short timeout so the test completes quickly.
    const client = createAirdropClient({ ...BASE_CONFIG, pollTimeoutMs: 100 });
    const server = await getMockServer();

    // Simulate a source account lookup.
    server.getAccount.mockResolvedValue({ id: "GABC123", sequenceNumber: () => "0" });

    // Simulate succeeds (no error).
    server.simulateTransaction.mockResolvedValue({
      result: { retval: {} },
      transactionData: {},
      minResourceFee: "100",
    });

    // sendTransaction returns a hash with PENDING status.
    server.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "abc123hash" });

    // getTransaction always returns NOT_FOUND — simulating a lost transaction.
    server.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    // The claim must reject with a timeout error.
    await expect(
      client.claim(CLAIM_PROOF, "STEST123")
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(RpcError);
      const message = (err as RpcError).message;
      expect(message).toMatch(/Transaction confirmation timeout after 100ms/);
      expect(message).toContain("abc123hash");
      return true;
    });
  }, 10_000);

  it("throws RpcError with timeout message when pollTimeoutMs is exceeded in submitSignedTransaction()", async () => {
    const client = createAirdropClient({ ...BASE_CONFIG, pollTimeoutMs: 100 });
    const server = await getMockServer();

    server.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "xyz789hash" });
    server.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    await expect(
      client.submitSignedTransaction("dummyXDR", CLAIM_PROOF)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(RpcError);
      const message = (err as RpcError).message;
      expect(message).toMatch(/Transaction confirmation timeout after 100ms/);
      expect(message).toContain("xyz789hash");
      return true;
    });
  }, 10_000);

  it("defaults to 60 000 ms when pollTimeoutMs is omitted", () => {
    // Just verify the client can be constructed without pollTimeoutMs —
    // we don't run the full 60s loop, just confirm no immediate throw.
    expect(() => createAirdropClient(BASE_CONFIG)).not.toThrow();
  });

  it("resolves successfully before the timeout if transaction confirms", async () => {
    const client = createAirdropClient({ ...BASE_CONFIG, pollTimeoutMs: 5000 });
    const server = await getMockServer();

    server.getAccount.mockResolvedValue({ id: "GABC123", sequenceNumber: () => "0" });
    server.simulateTransaction.mockResolvedValue({
      result: { retval: {} },
      transactionData: {},
      minResourceFee: "100",
    });
    server.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "success123" });

    // First poll returns NOT_FOUND, second returns SUCCESS.
    server.getTransaction
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "SUCCESS" });

    const result = await client.claim(CLAIM_PROOF, "STEST123");
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("success123");
  }, 15_000);
});

// ─── Issue #40: expiration() method ────────────────────────────────────────

describe("createAirdropClient — expiration() (Issue #40)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when contract is not initialised (scvVoid)", async () => {
    const { xdr } = await import("@stellar/stellar-sdk");
    const client = createAirdropClient(BASE_CONFIG);
    const server = await getMockServer();

    // Simulate returning scvVoid — contract not initialised.
    server.simulateTransaction.mockResolvedValue({
      result: { retval: xdr.ScVal.scvVoid() },
      transactionData: {},
      minResourceFee: "100",
    });

    const result = await client.expiration();
    expect(result).toBeNull();
  });

  it("returns a bigint Unix timestamp when contract is initialised", async () => {
    const { xdr } = await import("@stellar/stellar-sdk");
    const client = createAirdropClient(BASE_CONFIG);
    const server = await getMockServer();

    // Simulate returning a u64 value (1_700_000_000 seconds — a realistic timestamp).
    const expectedTimestamp = 1_700_000_000n;
    server.simulateTransaction.mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvU64(
          xdr.Uint64.fromString(expectedTimestamp.toString())
        ),
      },
      transactionData: {},
      minResourceFee: "100",
    });

    const result = await client.expiration();
    expect(typeof result).toBe("bigint");
    expect(result).toBe(expectedTimestamp);
  });
});
