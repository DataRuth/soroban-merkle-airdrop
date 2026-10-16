/**
 * Performance and correctness tests for the `generate` command (#112).
 *
 * Acceptance criteria:
 *   ✓ Generates a 1000-line CSV programmatically and runs `generate`
 *   ✓ Output JSON is valid and totalEntries === 1000
 *   ✓ All 1000 proofs verify with verifyProof
 *   ✓ Completes in under 2 seconds
 *   ✓ Cleans up temp files after the test
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateCommand } from "./generate.js";
import { verifyProof } from "@soroban-merkle-airdrop/sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 1000 deterministic Stellar-like G… addresses.
 *
 * Real Stellar addresses are base32-encoded 32-byte public keys with a
 * checksum. Generating 1000 valid keypairs from `@stellar/stellar-sdk` would
 * add meaningful overhead and a heavy dependency to a pure CLI test. Instead
 * we use the three known-valid addresses from the SDK test suite and cycle
 * through them with a disambiguating suffix appended to the *amount* so every
 * (address, amount) pair is unique.
 *
 * For a realistic proof-of-scale the important property is not "each address
 * must be a valid ed25519 key" but "the tree is built from N distinct entries
 * and all proofs round-trip through verifyProof". The merkle logic operates
 * entirely on the bytes of the address string, so any 56-character G-prefixed
 * string behaves identically to a real key inside the SDK.
 */
const BASE_ADDRESSES = [
  "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2",
  "GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN",
  "GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC",
];

/**
 * Build a 1000-entry CSV string.
 *
 * Each line: `<address>,<amount>` — amounts are distinct so the set of
 * (address, amount) leaf-hashes is guaranteed to be 1000 unique values even
 * though we only have 3 base addresses.  The CSV parser in generate.ts calls
 * `buildMerkleTree` which enforces uniqueness by *address* alone, so we need
 * distinct addresses.  We therefore construct 1000 unique 56-char G-addresses
 * by replacing a trailing segment with a zero-padded index.
 */
function buildCsv(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    // Derive a unique address: take a valid base, replace last 5 chars with
    // a zero-padded index. The result keeps the G prefix and 56-char length.
    const base = BASE_ADDRESSES[i % BASE_ADDRESSES.length];
    const suffix = String(i).padStart(5, "0");
    const addr = base.slice(0, -5) + suffix;
    const amount = (i + 1) * 100;
    lines.push(`${addr},${amount}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("generate command — performance & correctness (1000 entries)", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    // Clean up any temp files created during the test.
    for (const f of tempFiles) {
      await unlink(f).catch(() => {
        // Ignore if already removed.
      });
    }
    tempFiles.length = 0;
  });

  it(
    "processes 1000-entry CSV, validates output JSON, and verifies all proofs in under 2 s",
    async () => {
      // ── 1. Write a temporary 1000-line CSV ─────────────────────────────────
      const dir = await mkdtemp(join(tmpdir(), "merkle-perf-"));
      const csvPath = join(dir, "airdrop.csv");
      const jsonPath = join(dir, "merkle-tree.json");
      tempFiles.push(csvPath, jsonPath);

      await writeFile(csvPath, buildCsv(1000), "utf-8");

      // ── 2. Run the generate command and measure wall-clock time ────────────
      const start = performance.now();

      // Commander stores option values on the Command instance; we invoke the
      // action handler directly via `parseAsync` with synthetic argv.
      await generateCommand.parseAsync(
        ["node", "generate", "--input", csvPath, "--output", jsonPath],
        { from: "user" }
      );

      const elapsed = performance.now() - start;

      // ── 3. Assert timing ───────────────────────────────────────────────────
      expect(elapsed, `Expected < 2000 ms but took ${elapsed.toFixed(0)} ms`).toBeLessThan(
        2000
      );

      // ── 4. Parse and validate the output JSON ──────────────────────────────
      const raw = await readFile(jsonPath, "utf-8");
      const output = JSON.parse(raw) as {
        root: string;
        totalEntries: number;
        totalAmount: string;
        generatedAt: string;
        proofs: Record<string, { address: string; amount: string; proof: string[] }>;
      };

      expect(output.root, "root should be a 64-char hex string").toMatch(/^[0-9a-f]{64}$/);
      expect(output.totalEntries, "totalEntries should be 1000").toBe(1000);
      expect(
        Object.keys(output.proofs).length,
        "proofs map should contain 1000 entries"
      ).toBe(1000);

      // ── 5. Verify all 1000 proofs ──────────────────────────────────────────
      let verifiedCount = 0;
      for (const [address, proofEntry] of Object.entries(output.proofs)) {
        const amount = BigInt(proofEntry.amount);
        const valid = verifyProof(output.root, address, amount, proofEntry.proof);
        expect(valid, `Proof failed for address ${address}`).toBe(true);
        verifiedCount++;
      }
      expect(verifiedCount).toBe(1000);
    },
    // Vitest timeout in milliseconds — give a generous budget (5 s) so the
    // test itself is not flaky on slow CI runners, while still asserting the
    // 2-second business requirement inside the test body.
    5000
  );

  it("produces a valid totalAmount sum for 1000 entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merkle-sum-"));
    const csvPath = join(dir, "airdrop.csv");
    const jsonPath = join(dir, "merkle-tree.json");
    tempFiles.push(csvPath, jsonPath);

    await writeFile(csvPath, buildCsv(1000), "utf-8");
    await generateCommand.parseAsync(
      ["node", "generate", "--input", csvPath, "--output", jsonPath],
      { from: "user" }
    );

    const raw = await readFile(jsonPath, "utf-8");
    const output = JSON.parse(raw) as { totalAmount: string };

    // Sum of amounts: 100 + 200 + ... + 100000 = 100 * (1 + 2 + ... + 1000)
    //                                           = 100 * (1000 * 1001 / 2)
    //                                           = 50_050_000
    const expectedTotal = BigInt(100) * BigInt((1000 * 1001) / 2);
    expect(BigInt(output.totalAmount)).toBe(expectedTotal);
  });
});
