/**
 * Integration tests for the `merkle-airdrop status` command.
 *
 * Tests call `runStatusAction` directly (bypassing Commander's state machine)
 * with mocked SDK client and ora spinner. Console output is captured and
 * assertions are made on printed lines.
 *
 * Issue #29 acceptance criteria:
 *  ✓ Tests cover: normal output with all fields
 *  ✓ Tests cover: missing --contract-id error
 *  ✓ Tests cover: address-specific claimed/unclaimed output
 *  ✓ SDK client is mocked using vi.mock
 *  ✓ Output is captured and assertions made on printed lines
 *  ✓ pnpm test passes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the SDK ─────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the module, so runStatusAction will always
// receive the mocked createAirdropClient.

const mockClient = {
  isActive: vi.fn(),
  merkleRoot: vi.fn(),
  totalDeposited: vi.fn(),
  expiration: vi.fn(),
  isClaimed: vi.fn(),
};

vi.mock("@soroban-merkle-airdrop/sdk", () => ({
  createAirdropClient: vi.fn(() => mockClient),
  NETWORKS: {
    testnet: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
    mainnet: {
      rpcUrl: "https://mainnet.sorobanrpc.com",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    },
  },
}));

// ─── Mock ora ─────────────────────────────────────────────────────────────────
// The real ora writes to process.stderr via a raw stream, bypassing
// console.error capture. We replace it with a stub whose succeed/fail methods
// route through console.log / console.error so assertions work normally.
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn((msg: string) => console.log(msg)),
    fail: vi.fn((msg: string) => console.error(msg)),
  })),
}));

// ─── Import AFTER mocking ────────────────────────────────────────────────────
import { runStatusAction } from "../commands/status.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const MERKLE_ROOT =
  "9eb3a56c027bd438aec9dae40882e2c83c7aaa291bc4c162e87ee8f61a29624f";
const TEST_ADDRESS =
  "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Run runStatusAction with output captured.
 * Returns stdout lines, stderr lines, and whether process.exit was called.
 */
async function run(
  opts: { address?: string } = {},
  globalOpts: { network?: string; contractId?: string } = {},
  envOverrides: Record<string, string> = {}
): Promise<{ lines: string[]; errorLines: string[]; processExited: boolean }> {
  const lines: string[] = [];
  const errorLines: string[] = [];
  let processExited = false;

  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errorLines.push(a.map(String).join(" "));
  (process.exit as unknown as (...args: unknown[]) => void) = () => {
    processExited = true;
    throw new Error("__process_exit__");
  };

  const savedEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }

  try {
    await runStatusAction(opts, globalOpts);
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("__process_exit__"))) {
      throw err;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return { lines, errorLines, processExited };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("status command — runStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure fresh mock state for every test.
    mockClient.isActive.mockResolvedValue(true);
    mockClient.merkleRoot.mockResolvedValue(MERKLE_ROOT);
    mockClient.totalDeposited.mockResolvedValue(15000n);
    mockClient.expiration.mockResolvedValue(9999999999n); // far future
    mockClient.isClaimed.mockResolvedValue(false);
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  afterEach(() => {
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  // ── Normal output: all fields ────────────────────────────────────────────

  it("prints contract ID, network, active, root, deposited, expiration", async () => {
    const { lines } = await run({}, { contractId: CONTRACT_ID, network: "testnet" });
    const all = lines.join("\n");

    expect(all).toContain(CONTRACT_ID);
    expect(all).toContain("testnet");
    // Active field
    expect(all.toLowerCase()).toMatch(/active[\s\S]*yes/);
    // Merkle root
    expect(all).toContain(MERKLE_ROOT);
    // Total deposited
    expect(all).toContain("15000");
  });

  it("shows Active: no when airdrop is paused", async () => {
    mockClient.isActive.mockResolvedValue(false);

    const { lines } = await run({}, { contractId: CONTRACT_ID });
    expect(lines.join("\n").toLowerCase()).toMatch(/active[\s\S]*no/);
  });

  it("shows 'not initialized' when merkleRoot returns null", async () => {
    mockClient.merkleRoot.mockResolvedValue(null);

    const { lines } = await run({}, { contractId: CONTRACT_ID });
    expect(lines.join("\n")).toContain("not initialized");
  });

  it("shows 'not set' when expiration returns null", async () => {
    mockClient.expiration.mockResolvedValue(null);

    const { lines } = await run({}, { contractId: CONTRACT_ID });
    expect(lines.join("\n")).toContain("not set");
  });

  it("shows EXPIRED label when expiration timestamp is in the past", async () => {
    mockClient.expiration.mockResolvedValue(1n); // Unix epoch 1 — always past

    const { lines } = await run({}, { contractId: CONTRACT_ID });
    expect(lines.join("\n").toUpperCase()).toContain("EXPIRED");
  });

  // ── Missing --contract-id error ──────────────────────────────────────────

  it("prints an error and exits when contractId is not provided", async () => {
    // Pass no contractId and no env var.
    const { errorLines, processExited } = await run({}, {});

    expect(processExited).toBe(true);
    expect(errorLines.join("\n")).toMatch(
      /contract[-_]?id|AIRDROP_CONTRACT_ID/i
    );
  });

  it("accepts AIRDROP_CONTRACT_ID env var when contractId option is absent", async () => {
    const { lines } = await run(
      {},
      {}, // no contractId in globalOpts
      { AIRDROP_CONTRACT_ID: CONTRACT_ID }
    );
    expect(lines.join("\n")).toContain(CONTRACT_ID);
  });

  // ── Address-specific claimed / unclaimed output ──────────────────────────

  it("shows 'not yet claimed' for an unclaimed address", async () => {
    mockClient.isClaimed.mockResolvedValue(false);

    const { lines } = await run(
      { address: TEST_ADDRESS },
      { contractId: CONTRACT_ID }
    );

    const all = lines.join("\n");
    expect(all).toContain(TEST_ADDRESS);
    expect(all.toLowerCase()).toContain("not yet claimed");
  });

  it("shows 'already claimed' for a claimed address", async () => {
    mockClient.isClaimed.mockResolvedValue(true);

    const { lines } = await run(
      { address: TEST_ADDRESS },
      { contractId: CONTRACT_ID }
    );

    const all = lines.join("\n");
    expect(all).toContain(TEST_ADDRESS);
    expect(all.toLowerCase()).toContain("already claimed");
  });

  it("calls isClaimed with the address from opts.address", async () => {
    mockClient.isClaimed.mockResolvedValue(false);

    await run({ address: TEST_ADDRESS }, { contractId: CONTRACT_ID });

    expect(mockClient.isClaimed).toHaveBeenCalledWith(TEST_ADDRESS);
    expect(mockClient.isClaimed).toHaveBeenCalledTimes(1);
  });

  it("does NOT call isClaimed when opts.address is absent", async () => {
    // vi.clearAllMocks() in beforeEach ensures call count starts at 0.
    await run({}, { contractId: CONTRACT_ID });
    expect(mockClient.isClaimed).not.toHaveBeenCalled();
  });

  // ── RPC error handling ───────────────────────────────────────────────────

  it("prints an error message and exits when an RPC call throws", async () => {
    mockClient.isActive.mockRejectedValue(new Error("Connection refused"));

    const { errorLines, processExited } = await run(
      {},
      { contractId: CONTRACT_ID }
    );

    expect(processExited).toBe(true);
    // spinner.fail() is mocked to call console.error → appears in errorLines.
    expect(errorLines.join("\n")).toContain("Connection refused");
  });

  // ── SDK client factory ───────────────────────────────────────────────────

  it("passes contractId to createAirdropClient", async () => {
    const { createAirdropClient } = await import("@soroban-merkle-airdrop/sdk");

    await run({}, { contractId: CONTRACT_ID, network: "mainnet" });

    expect(createAirdropClient).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: CONTRACT_ID })
    );
  });
});

// ─── Issue #68: --rpc-url forwarding ────────────────────────────────────────

describe("status command — Issue #68: --rpc-url forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.isActive.mockResolvedValue(true);
    mockClient.merkleRoot.mockResolvedValue(MERKLE_ROOT);
    mockClient.totalDeposited.mockResolvedValue(0n);
    mockClient.expiration.mockResolvedValue(null);
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  afterEach(() => {
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  it("passes a custom --rpc-url to createAirdropClient instead of the preset", async () => {
    const { createAirdropClient } = await import("@soroban-merkle-airdrop/sdk");
    const customRpcUrl = "https://my-custom-rpc.example.com";

    await run(
      {},
      { contractId: CONTRACT_ID, network: "testnet", rpcUrl: customRpcUrl }
    );

    expect(createAirdropClient).toHaveBeenCalledWith(
      expect.objectContaining({ rpcUrl: customRpcUrl })
    );
  });

  it("uses the preset rpcUrl when --rpc-url is not provided", async () => {
    const { createAirdropClient } = await import("@soroban-merkle-airdrop/sdk");

    await run({}, { contractId: CONTRACT_ID, network: "testnet" });

    expect(createAirdropClient).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: "https://soroban-testnet.stellar.org",
      })
    );
  });

  it("does not include rpcUrl override when globalOpts.rpcUrl is undefined", async () => {
    const { createAirdropClient } = await import("@soroban-merkle-airdrop/sdk");

    await run({}, { contractId: CONTRACT_ID });

    // The call should still succeed and use the network preset rpcUrl
    expect(createAirdropClient).toHaveBeenCalled();
    const callArg = (createAirdropClient as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    // Should NOT be undefined — it comes from the preset
    expect(typeof callArg["rpcUrl"]).toBe("string");
  });
});

// ─── Issue #67: --json output flag ───────────────────────────────────────────

describe("status command — Issue #67: --json output flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.isActive.mockResolvedValue(true);
    mockClient.merkleRoot.mockResolvedValue(MERKLE_ROOT);
    mockClient.totalDeposited.mockResolvedValue(15000n);
    mockClient.expiration.mockResolvedValue(9999999999n);
    mockClient.isClaimed.mockResolvedValue(false);
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  afterEach(() => {
    delete process.env["AIRDROP_CONTRACT_ID"];
  });

  it("outputs valid JSON when --json is set", async () => {
    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID, network: "testnet" }
    );

    // There should be exactly one line of JSON output
    const jsonLine = lines.find((l) => l.trimStart().startsWith("{"));
    expect(jsonLine).toBeDefined();
    expect(() => JSON.parse(jsonLine!)).not.toThrow();
  });

  it("JSON output contains all required keys", async () => {
    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID, network: "testnet" }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);

    expect(parsed).toHaveProperty("contractId", CONTRACT_ID);
    expect(parsed).toHaveProperty("network", "testnet");
    expect(parsed).toHaveProperty("active");
    expect(parsed).toHaveProperty("root");
    expect(parsed).toHaveProperty("deposited");
    expect(parsed).toHaveProperty("expiration");
  });

  it("JSON active field is boolean true when contract is active", async () => {
    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed.active).toBe(true);
  });

  it("JSON active field is boolean false when contract is inactive", async () => {
    mockClient.isActive.mockResolvedValue(false);

    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed.active).toBe(false);
  });

  it("JSON root is null when contract is not initialized", async () => {
    mockClient.merkleRoot.mockResolvedValue(null);

    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed.root).toBeNull();
  });

  it("JSON expiration is null when not set", async () => {
    mockClient.expiration.mockResolvedValue(null);

    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed.expiration).toBeNull();
  });

  it("JSON includes address and claimed fields when --address is provided", async () => {
    mockClient.isClaimed.mockResolvedValue(true);

    const { lines } = await run(
      { json: true, address: TEST_ADDRESS },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed.address).toBe(TEST_ADDRESS);
    expect(parsed.claimed).toBe(true);
  });

  it("does not include address/claimed keys when no --address is provided", async () => {
    const { lines } = await run(
      { json: true },
      { contractId: CONTRACT_ID }
    );

    const parsed = JSON.parse(lines.find((l) => l.trimStart().startsWith("{"))!);
    expect(parsed).not.toHaveProperty("address");
    expect(parsed).not.toHaveProperty("claimed");
  });
});