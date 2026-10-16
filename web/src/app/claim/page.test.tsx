/**
 * Tests for web/src/app/claim/page.tsx
 *
 * Covers the state machine:
 *   idle → checking → eligible / not_eligible / claimed / error
 *   eligible → claiming → success / error
 *
 * Also runs axe accessibility audit on the initial render (#80).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { renderWithNetwork } from "../../test/test-utils";
import ClaimPage from "./page";

expect.extend(toHaveNoViolations);

// ─── Hoist mock functions so vi.mock factories can reference them ─────────────
const {
  mockIsClaimedFn,
  mockBuildClaimTransactionFn,
  mockSubmitSignedTransactionFn,
  mockVerifyProof,
  mockIsConnected,
  mockGetPublicKey,
  mockSignTransaction,
} = vi.hoisted(() => ({
  mockIsClaimedFn: vi.fn<() => Promise<boolean>>(),
  mockBuildClaimTransactionFn: vi.fn<() => Promise<string>>(),
  mockSubmitSignedTransactionFn: vi.fn<
    () => Promise<{ txHash: string; amount: bigint }>
  >(),
  mockVerifyProof: vi.fn<() => boolean>().mockReturnValue(true),
  mockIsConnected: vi.fn<() => Promise<boolean>>(),
  mockGetPublicKey: vi.fn<() => Promise<string>>(),
  mockSignTransaction: vi.fn<() => Promise<string>>(),
}));

// ─── SDK mock ─────────────────────────────────────────────────────────────────
vi.mock("@soroban-merkle-airdrop/sdk", () => ({
  createAirdropClient: vi.fn(() => ({
    isClaimed: mockIsClaimedFn,
    buildClaimTransaction: mockBuildClaimTransactionFn,
    submitSignedTransaction: mockSubmitSignedTransactionFn,
  })),
  verifyProof: mockVerifyProof,
  NETWORKS: {
    testnet: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
    mainnet: {
      rpcUrl: "https://mainnet.stellar.validation.network",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    },
  },
}));

// ─── Freighter mock ───────────────────────────────────────────────────────────
vi.mock("@stellar/freighter-api", () => ({
  isConnected: mockIsConnected,
  getPublicKey: mockGetPublicKey,
  signTransaction: mockSignTransaction,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const ELIGIBLE_ADDRESS = "GABC1234TESTADDRESS";
const INELIGIBLE_ADDRESS = "GDEF5678NOTINLIST";

const MOCK_TREE = {
  root: "abc123root",
  proofs: {
    [ELIGIBLE_ADDRESS]: {
      amount: "1000",
      proof: ["hash1", "hash2"],
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function connectWallet(address = ELIGIBLE_ADDRESS) {
  const btn = screen.getByRole("button", { name: /connect wallet/i });
  await userEvent.click(btn);
  // Wait until the address text appears in the DOM
  await waitFor(() => {
    expect(
      screen.getByText((content) => content.includes(address))
    ).toBeInTheDocument();
  });
}

async function pasteTree(json: object = MOCK_TREE) {
  const pasteTab = screen.getByRole("tab", { name: /paste json/i });
  await userEvent.click(pasteTab);
  const textarea = screen.getByRole("textbox", { name: /proof file/i });
  // Use clipboard to avoid userEvent.type interpreting { and } as key modifiers
  await userEvent.click(textarea);
  await userEvent.paste(JSON.stringify(json));
  await waitFor(() => screen.getByText(/tree parsed successfully/i));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ClaimPage — accessibility audit (#80)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
  });

  it("has no axe violations on initial render", async () => {
    const { container } = renderWithNetwork(<ClaimPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("ClaimPage — wallet connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
  });

  it("shows Connect Wallet button initially", () => {
    renderWithNetwork(<ClaimPage />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("shows connected address after connecting wallet", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    expect(screen.getByText(new RegExp(ELIGIBLE_ADDRESS))).toBeInTheDocument();
  });

  it("shows error when Freighter is not installed", async () => {
    mockIsConnected.mockResolvedValue(false);
    renderWithNetwork(<ClaimPage />);
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/freighter wallet is not installed/i);
    });
  });

  it("shows error if getPublicKey throws", async () => {
    mockGetPublicKey.mockRejectedValueOnce(new Error("User rejected"));
    renderWithNetwork(<ClaimPage />);
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/user rejected/i);
    });
  });
});

describe("ClaimPage — eligible flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockResolvedValue(false);
    mockVerifyProof.mockReturnValue(true);
  });

  it("shows eligible status and Claim Tokens button", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    await pasteTree();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/eligible/i)
    );
    expect(screen.getByRole("button", { name: /claim tokens/i })).toBeInTheDocument();
  });
});

describe("ClaimPage — not eligible flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(INELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockResolvedValue(false);
  });

  it("shows not eligible message when address is not in tree", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet(INELIGIBLE_ADDRESS);
    await pasteTree(); // tree only has ELIGIBLE_ADDRESS

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/not in the airdrop list/i)
    );
    expect(screen.queryByRole("button", { name: /claim tokens/i })).not.toBeInTheDocument();
  });
});

describe("ClaimPage — already claimed flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockResolvedValue(true); // already claimed on-chain
  });

  it("shows already claimed message", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/already claimed/i)
    );
    expect(screen.queryByRole("button", { name: /claim tokens/i })).not.toBeInTheDocument();
  });
});

describe("ClaimPage — successful claim flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockResolvedValue(false);
    mockVerifyProof.mockReturnValue(true);
    mockBuildClaimTransactionFn.mockResolvedValue("unsigned-xdr");
    mockSignTransaction.mockResolvedValue("signed-xdr");
    mockSubmitSignedTransactionFn.mockResolvedValue({
      txHash: "abc123txhash",
      amount: 1000n,
    });
  });

  it("shows success message and Stellar Expert link", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    await pasteTree();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));
    await waitFor(() => screen.getByRole("button", { name: /claim tokens/i }));

    await userEvent.click(screen.getByRole("button", { name: /claim tokens/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/successfully claimed 1000/i)
    );

    const link = screen.getByRole("link", { name: /view transaction/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("abc123txhash"));
  });

  it("calls buildClaimTransaction, signTransaction, submitSignedTransaction in order", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    await pasteTree();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));
    await waitFor(() => screen.getByRole("button", { name: /claim tokens/i }));
    await userEvent.click(screen.getByRole("button", { name: /claim tokens/i }));

    await waitFor(() => expect(mockSubmitSignedTransactionFn).toHaveBeenCalledTimes(1));
    expect(mockBuildClaimTransactionFn).toHaveBeenCalledTimes(1);
    expect(mockSignTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("ClaimPage — claim error flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockResolvedValue(false);
    mockVerifyProof.mockReturnValue(true);
    mockBuildClaimTransactionFn.mockRejectedValue(new Error("Contract invocation failed"));
  });

  it("shows error message when claim fails", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    await pasteTree();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));
    await waitFor(() => screen.getByRole("button", { name: /claim tokens/i }));

    await userEvent.click(screen.getByRole("button", { name: /claim tokens/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/contract invocation failed/i)
    );
  });

  it("shows error when proof verification fails locally", async () => {
    mockVerifyProof.mockReturnValue(false);
    renderWithNetwork(<ClaimPage />);
    await connectWallet();
    await pasteTree();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));
    await waitFor(() => screen.getByRole("button", { name: /claim tokens/i }));

    await userEvent.click(screen.getByRole("button", { name: /claim tokens/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/proof verification failed/i)
    );
  });
});

describe("ClaimPage — check error flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockResolvedValue(true);
    mockGetPublicKey.mockResolvedValue(ELIGIBLE_ADDRESS);
    mockIsClaimedFn.mockRejectedValue(new Error("RPC unavailable"));
  });

  it("shows error when eligibility check fails", async () => {
    renderWithNetwork(<ClaimPage />);
    await connectWallet();

    await userEvent.click(screen.getByRole("button", { name: /check eligibility/i }));

    await waitFor(() =>
      expect(screen.getByTestId("status-message")).toHaveTextContent(/rpc unavailable/i)
    );
  });
});
