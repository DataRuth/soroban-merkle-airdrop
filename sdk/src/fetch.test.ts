/**
 * Unit tests for fetchMerkleTree (Issue #71).
 *
 * HTTP calls are mocked via vi.stubGlobal so the tests work in both Node.js
 * and browser environments without a real server.
 *
 * Acceptance criteria checked:
 *  ✓ fetchMerkleTree(url) fetches JSON, validates root/proofs/totalEntries, returns typed object
 *  ✓ Exported from sdk/src/index.ts
 *  ✓ Unit test mocks the HTTP call and verifies parsing
 *  ✓ Invalid JSON or missing fields throw descriptive errors
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMerkleTree, validateMerkleTreeFile } from "./fetch.js";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const VALID_TREE = {
  root: "9eb3a56c027bd438aec9dae40882e2c83c7aaa291bc4c162e87ee8f61a29624f",
  totalEntries: 2,
  totalAmount: "1500",
  generatedAt: "2024-01-01T00:00:00.000Z",
  proofs: {
    GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2: {
      address: "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2",
      amount: "1000",
      proof: [
        "e6991451a1a8a47f0d50e2a5054cf3bc9947122f15603de16496ed983676c639",
      ],
    },
    GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN: {
      address: "GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN",
      amount: "500",
      proof: [
        "f0ca9a176c3553e6f05548ac5dbc4e723432ff28aef31c1739f48e3d81c19c2c",
      ],
    },
  },
};

const TEST_URL = "https://example.com/merkle-tree.json";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock fetch that returns the given body and status. */
function mockFetch(body: unknown, status = 200, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

/** Build a mock fetch whose json() rejects (simulates malformed JSON). */
function mockFetchBadJson() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token < in JSON")),
  } as unknown as Response);
}

/** Build a mock fetch that rejects (simulates a network failure). */
function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── fetchMerkleTree: HTTP behaviour ─────────────────────────────────────────

describe("fetchMerkleTree — HTTP behaviour", () => {
  it("returns a typed MerkleTreeFile on a valid 200 response", async () => {
    vi.stubGlobal("fetch", mockFetch(VALID_TREE));

    const tree = await fetchMerkleTree(TEST_URL);

    expect(tree.root).toBe(VALID_TREE.root);
    expect(tree.totalEntries).toBe(2);
    expect(tree.totalAmount).toBe("1500");
    expect(tree.generatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(Object.keys(tree.proofs)).toHaveLength(2);
  });

  it("passes the url directly to the global fetch", async () => {
    const mockFn = mockFetch(VALID_TREE);
    vi.stubGlobal("fetch", mockFn);

    await fetchMerkleTree(TEST_URL);

    expect(mockFn).toHaveBeenCalledWith(TEST_URL);
  });

  it("throws a descriptive error on a non-2xx HTTP response (404)", async () => {
    vi.stubGlobal("fetch", mockFetch(null, 404, false));

    await expect(fetchMerkleTree(TEST_URL)).rejects.toThrow(
      /HTTP 404.*Not Found/
    );
  });

  it("throws a descriptive error when the network call fails", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError());

    await expect(fetchMerkleTree(TEST_URL)).rejects.toThrow(
      /network request failed.*Failed to fetch/i
    );
  });

  it("throws a descriptive error when the response is not valid JSON", async () => {
    vi.stubGlobal("fetch", mockFetchBadJson());

    await expect(fetchMerkleTree(TEST_URL)).rejects.toThrow(
      /not valid JSON/i
    );
  });
});

// ─── validateMerkleTreeFile: structural validation ───────────────────────────

describe("validateMerkleTreeFile — structure validation", () => {
  it("accepts a valid MerkleTreeFile object", () => {
    expect(() => validateMerkleTreeFile(VALID_TREE)).not.toThrow();
  });

  it("throws when root is missing", () => {
    const { root: _root, ...rest } = VALID_TREE;
    expect(() => validateMerkleTreeFile(rest)).toThrow(/root/i);
  });

  it("throws when root is not a 64-char hex string", () => {
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, root: "not-hex" })
    ).toThrow(/root/i);
  });

  it("throws when totalEntries is missing", () => {
    const { totalEntries: _t, ...rest } = VALID_TREE;
    expect(() => validateMerkleTreeFile(rest)).toThrow(/totalEntries/i);
  });

  it("throws when totalEntries is a non-integer number", () => {
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, totalEntries: 1.5 })
    ).toThrow(/totalEntries/i);
  });

  it("throws when totalAmount is missing", () => {
    const { totalAmount: _t, ...rest } = VALID_TREE;
    expect(() => validateMerkleTreeFile(rest)).toThrow(/totalAmount/i);
  });

  it("throws when totalAmount is not a decimal integer string", () => {
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, totalAmount: "1500.5" })
    ).toThrow(/totalAmount/i);
  });

  it("throws when generatedAt is missing", () => {
    const { generatedAt: _g, ...rest } = VALID_TREE;
    expect(() => validateMerkleTreeFile(rest)).toThrow(/generatedAt/i);
  });

  it("throws when proofs is missing", () => {
    const { proofs: _p, ...rest } = VALID_TREE;
    expect(() => validateMerkleTreeFile(rest)).toThrow(/proofs/i);
  });

  it("throws when proofs is an array instead of object", () => {
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, proofs: [] })
    ).toThrow(/proofs/i);
  });

  it("throws when a proof entry has a non-string amount", () => {
    const badProofs = {
      ...VALID_TREE.proofs,
      GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2: {
        address: "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2",
        amount: 1000, // number, not string
        proof: [],
      },
    };
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, proofs: badProofs })
    ).toThrow(/amount/i);
  });

  it("throws when a proof entry has a non-array proof field", () => {
    const badProofs = {
      ...VALID_TREE.proofs,
      GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2: {
        address: "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2",
        amount: "1000",
        proof: "not-an-array",
      },
    };
    expect(() =>
      validateMerkleTreeFile({ ...VALID_TREE, proofs: badProofs })
    ).toThrow(/proof/i);
  });

  it("throws when top-level value is null", () => {
    expect(() => validateMerkleTreeFile(null)).toThrow(/expected a JSON object/i);
  });

  it("throws when top-level value is an array", () => {
    expect(() => validateMerkleTreeFile([])).toThrow(/expected a JSON object/i);
  });

  it("includes the source URL in error messages", () => {
    const { root: _root, ...rest } = VALID_TREE;
    expect(() =>
      validateMerkleTreeFile(rest, "https://example.com/tree.json")
    ).toThrow("https://example.com/tree.json");
  });
});

// ─── Export check ─────────────────────────────────────────────────────────────

describe("SDK exports", () => {
  it("fetchMerkleTree is exported from the SDK index", async () => {
    const sdk = await import("./index.js");
    expect(typeof sdk.fetchMerkleTree).toBe("function");
  });

  it("MerkleTreeFile type is exported (compile-time only — runtime presence via validateMerkleTreeFile)", async () => {
    const sdk = await import("./index.js");
    // validateMerkleTreeFile is a runtime companion for the MerkleTreeFile type
    expect(typeof sdk.validateMerkleTreeFile).toBe("function");
  });
});
