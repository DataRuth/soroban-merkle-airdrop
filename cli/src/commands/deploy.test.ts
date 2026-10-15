/**
 * Unit tests for the programmatic deploy command (Issue #69).
 *
 * All Stellar RPC calls are mocked — no real network access occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { programmaticDeploy, type DeployOptions } from "./deploy.js";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
// vi.mock() factories are hoisted before module-level code, so any variables
// they reference must also be hoisted via vi.hoisted().

const mockServer = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

// Hoisted mock for xdr.TransactionMeta.fromXDR — allows per-test configuration.
const mockFromXDR = vi.hoisted(() => vi.fn());

// Hoisted mock for readFile — allows per-test configuration.
const mockReadFile = vi.hoisted(() =>
  vi.fn().mockImplementation((path: unknown) => {
    if (String(path).endsWith(".wasm")) {
      return Promise.resolve(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    }
    return Promise.resolve(
      JSON.stringify({
        root: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        totalAmount: "150000",
        proofs: {},
      })
    );
  })
);

// ─── Mock @stellar/stellar-sdk ──────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(() => mockServer),
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: vi.fn() }),
      }),
      Api: {
        ...(actual.rpc?.Api ?? {}),
        isSimulationError: (r: unknown) =>
          typeof r === "object" && r !== null && "error" in r,
      },
    },
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn().mockReturnValue({
        publicKey: vi.fn().mockReturnValue("GADMIN123PUBLICKEY"),
        sign: vi.fn(),
      }),
      random: vi.fn().mockReturnValue({ publicKey: vi.fn().mockReturnValue("GRND") }),
    },
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: vi.fn() }),
    })),
    Operation: {
      ...actual.Operation,
      uploadContractWasm: vi.fn().mockReturnValue({}),
      createCustomContract: vi.fn().mockReturnValue({}),
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({}),
    })),
    Address: Object.assign(
      vi.fn().mockImplementation((addr: string) => ({
        toScVal: vi.fn().mockReturnValue({}),
        toString: () => addr,
      })),
      {
        // Static method used by extractContractIdFromResult
        contract: vi.fn().mockReturnValue({ toString: () => "CCONTRACT123DEPLOY456" }),
      }
    ),
    xdr: {
      ...actual.xdr,
      ScVal: {
        ...actual.xdr.ScVal,
        scvBytes: vi.fn().mockReturnValue({}),
      },
      TransactionMeta: {
        fromXDR: mockFromXDR,
      },
      ScValType: actual.xdr.ScValType,
      ScAddressType: actual.xdr.ScAddressType,
    },
    nativeToScVal: vi.fn().mockReturnValue({}),
    Networks: actual.Networks,
  };
});

// ─── Mock fs/promises ────────────────────────────────────────────────────────

vi.mock("fs/promises", () => ({ readFile: mockReadFile }));

// ─── XDR helpers ─────────────────────────────────────────────────────────────

/**
 * Build a fake TransactionMeta result for the WASM upload step.
 * extractReturnValue expects scvBytes switch.
 */
async function makeUploadXdrResult() {
  const { xdr } = await import("@stellar/stellar-sdk");
  return {
    v3: vi.fn().mockReturnValue({
      sorobanMeta: vi.fn().mockReturnValue({
        returnValue: vi.fn().mockReturnValue({
          switch: vi.fn().mockReturnValue(xdr.ScValType.scvBytes()),
          bytes: vi.fn().mockReturnValue(Buffer.alloc(32, 0xab)),
        }),
      }),
    }),
  };
}

/**
 * Build a fake TransactionMeta result for the contract deploy step.
 * extractContractIdFromResult expects scvAddress/scAddressTypeContract.
 */
async function makeDeployXdrResult() {
  const { xdr } = await import("@stellar/stellar-sdk");
  return {
    v3: vi.fn().mockReturnValue({
      sorobanMeta: vi.fn().mockReturnValue({
        returnValue: vi.fn().mockReturnValue({
          switch: vi.fn().mockReturnValue(xdr.ScValType.scvAddress()),
          address: vi.fn().mockReturnValue({
            switch: vi.fn().mockReturnValue(xdr.ScAddressType.scAddressTypeContract()),
            contractId: vi.fn().mockReturnValue(Buffer.alloc(32, 0xcd)),
          }),
        }),
      }),
    }),
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const BASE_OPTS: DeployOptions = {
  wasm: "contract.wasm",
  token: "CTOKEN123",
  tree: "merkle-tree.json",
  expiration: "9999999999",
  secretKey: "STEST123SECRETKEY",
  network: "testnet",
};

function simSuccess() {
  return { result: { retval: {} }, transactionData: {}, minResourceFee: "100" };
}

function txSuccessResult() {
  return {
    status: "SUCCESS" as const,
    resultMetaXdr: { toXDR: () => Buffer.alloc(0) },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("programmaticDeploy (Issue #69)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockReadFile.mockImplementation((path: unknown) => {
      if (String(path).endsWith(".wasm")) {
        return Promise.resolve(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
      }
      return Promise.resolve(
        JSON.stringify({
          root: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          totalAmount: "150000",
          proofs: {},
        })
      );
    });

    mockServer.getAccount.mockResolvedValue({
      id: "GADMIN123PUBLICKEY",
      sequenceNumber: () => "100",
      incrementSequenceNumber: vi.fn(),
    });

    // Use mockImplementation so the queue cannot bleed between tests.
    mockServer.simulateTransaction.mockImplementation(() =>
      Promise.resolve(simSuccess())
    );

    let sendCallCount = 0;
    const sendHashes = ["upload-hash", "deploy-hash", "init-hash"];
    mockServer.sendTransaction.mockImplementation(() => {
      const hash = sendHashes[sendCallCount++] ?? "extra-hash";
      return Promise.resolve({ status: "PENDING", hash });
    });

    mockServer.getTransaction.mockResolvedValue(txSuccessResult());

    // Set up fromXDR via implementation so it can't be exhausted by a prior test.
    const uploadXdr = await makeUploadXdrResult();
    const deployXdr = await makeDeployXdrResult();
    let xdrCallCount = 0;
    mockFromXDR.mockImplementation(() => {
      xdrCallCount++;
      return xdrCallCount === 1 ? uploadXdr : deployXdr;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls getAccount, simulateTransaction, and sendTransaction for each of the 3 steps", async () => {
    const deployPromise = programmaticDeploy(BASE_OPTS);
    // Advance through all polling sleeps (3 polls × 2s each)
    await vi.runAllTimersAsync();
    await deployPromise;

    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(3);
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(3);
  });

  it("throws if WASM upload simulation returns an error", async () => {
    // Override: first sim call returns error (upload fails)
    mockServer.simulateTransaction.mockImplementationOnce(() =>
      Promise.resolve({ error: "Simulation error: out of budget" })
    );

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/WASM upload simulation failed/);
  });

  it("throws if contract deploy simulation returns an error", async () => {
    let simCall = 0;
    mockServer.simulateTransaction.mockImplementation(() => {
      simCall++;
      if (simCall === 2) return Promise.resolve({ error: "Deploy simulation error" });
      return Promise.resolve(simSuccess());
    });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/Contract deploy simulation failed/);
  });

  it("throws if initialize simulation returns an error", async () => {
    let simCall = 0;
    mockServer.simulateTransaction.mockImplementation(() => {
      simCall++;
      if (simCall === 3) return Promise.resolve({ error: "Init simulation error" });
      return Promise.resolve(simSuccess());
    });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/Initialize simulation failed/);
  });

  it("throws if upload sendTransaction returns ERROR status", async () => {
    mockServer.sendTransaction.mockImplementation(() =>
      Promise.resolve({ status: "ERROR", errorResult: { toXDR: () => "errorXDR" } })
    );

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/WASM upload transaction failed/);
  });

  it("throws if deploy sendTransaction returns ERROR status", async () => {
    let sendCall = 0;
    mockServer.sendTransaction.mockImplementation(() => {
      sendCall++;
      if (sendCall === 1) return Promise.resolve({ status: "PENDING", hash: "upload-hash" });
      return Promise.resolve({ status: "ERROR", errorResult: { toXDR: () => "err" } });
    });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/Contract deploy transaction failed/);
  });

  it("throws a timeout error if getTransaction never returns SUCCESS", async () => {
    mockServer.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    // Advance time past the 90s POLL_TIMEOUT_MS
    await vi.advanceTimersByTimeAsync(200_000);

    await expect(deployPromise).rejects.toThrow(/Transaction confirmation timeout/);
  });

  it("rejects if Merkle tree JSON has no root field", async () => {
    mockReadFile.mockImplementation((path: unknown) => {
      if (String(path).endsWith(".wasm")) return Promise.resolve(Buffer.from([0x00]));
      return Promise.resolve(JSON.stringify({ totalAmount: "1000" }));
    });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/missing a 'root' field/);
  });

  it("rejects if Merkle tree JSON has no totalAmount field", async () => {
    mockReadFile.mockImplementation((path: unknown) => {
      if (String(path).endsWith(".wasm")) return Promise.resolve(Buffer.from([0x00]));
      return Promise.resolve(JSON.stringify({ root: "a".repeat(64) }));
    });

    const deployPromise = programmaticDeploy(BASE_OPTS);
    await vi.runAllTimersAsync();

    await expect(deployPromise).rejects.toThrow(/missing 'totalAmount'/);
  });
});