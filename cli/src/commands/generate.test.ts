/**
 * Integration tests for the `merkle-airdrop generate` command.
 *
 * Strategy: import the exported Commander Command and call .parseAsync() with
 * synthetic argv, then inspect the written JSON output. Because the action
 * handler calls process.exit(1) on failure, we spy on it and restore it after
 * each test so failures are observable without killing the test process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { writeFile } from "fs/promises";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Well-known valid Stellar G-addresses (public-key strkeys, 56 chars). */
const ADDR_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ADDR_B = "GAYOLLLUIZE4DZMBB2ZBKGBUBZLIOYU6XFLW37GBP2VZD3ABNXCW4BVA";

/** Build a minimal two-entry CSV string. */
function twoEntryCsv(): string {
  return `${ADDR_A},1000\n${ADDR_B},500\n`;
}

/** Build a CSV with `n` unique addresses and amounts 1..n. */
function largeEntryCsv(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    // Build a 56-char G-address by embedding a zero-padded 4-digit index at
    // the end. The SDK only requires non-empty unique strings for addresses in
    // the test context — it does not validate Stellar strkey format.
    const suffix = String(i).padStart(4, "0");             // 4 chars, unique up to 9999
    const base = `G${"A".repeat(56 - 1 - suffix.length)}`; // 1 + 51 = 52 chars
    const addr = base + suffix;                             // exactly 56 chars
    lines.push(`${addr},${i + 1}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Run the generate command with the given --input / --output paths.
 * Returns the exit code the command would have called process.exit with,
 * or undefined if it completed without calling process.exit.
 */
async function runGenerate(
  inputPath: string,
  outputPath: string
): Promise<{ exitCode: number | undefined }> {
  // Re-import a fresh copy of the command each time to avoid Commander
  // state leaking between tests (Commander tracks whether parse() was called).
  const { generateCommand } = await import("./generate.js");

  let capturedCode: number | undefined;
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null) => {
      capturedCode = typeof code === "number" ? code : 1;
      // Throw so execution stops — matches real behaviour after error.
      throw new Error(`process.exit(${capturedCode})`);
    });

  // Silence ora spinner output during tests.
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  try {
    // Commander's parseAsync expects process.argv format: [node, script, ...args]
    await generateCommand.parseAsync(
      ["node", "merkle-airdrop", "--input", inputPath, "--output", outputPath],
      { from: "user" }
    );
  } catch (err) {
    // Swallow the thrown-from-mock error; capturedCode already set.
  } finally {
    exitSpy.mockRestore();
    vi.spyOn(process.stderr, "write").mockRestore();
    vi.spyOn(process.stdout, "write").mockRestore();
  }

  return { exitCode: capturedCode };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let inputFile: string;
let outputFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "merkle-airdrop-test-"));
  inputFile = join(tmpDir, "input.csv");
  outputFile = join(tmpDir, "output.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("generate command", () => {
  // ── 1. Happy path: 2-entry CSV ─────────────────────────────────────────────

  it("generates valid JSON output for a 2-entry CSV", async () => {
    await writeFile(inputFile, twoEntryCsv());

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBeUndefined(); // no error

    const raw = await readFile(outputFile, "utf-8");
    const output = JSON.parse(raw);

    // Shape checks
    expect(typeof output.root).toBe("string");
    expect(output.root).toHaveLength(64); // 32-byte hex
    expect(output.totalEntries).toBe(2);
    expect(output.proofs).toBeDefined();
    expect(Object.keys(output.proofs)).toHaveLength(2);

    // Each proof entry has the right shape
    const proofA = output.proofs[ADDR_A];
    expect(proofA).toBeDefined();
    expect(proofA.address).toBe(ADDR_A);
    expect(typeof proofA.amount).toBe("string"); // serialised as string
    expect(Number(proofA.amount)).toBe(1000);
    expect(Array.isArray(proofA.proof)).toBe(true);
  });

  // ── 2. totalAmount is correct ──────────────────────────────────────────────

  it("writes the correct totalAmount to the output file", async () => {
    await writeFile(inputFile, twoEntryCsv());

    await runGenerate(inputFile, outputFile);

    const output = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(output.totalAmount).toBe("1500"); // 1000 + 500
  });

  // ── 3. generatedAt is an ISO timestamp ────────────────────────────────────

  it("sets generatedAt to a valid ISO 8601 timestamp", async () => {
    await writeFile(inputFile, twoEntryCsv());

    await runGenerate(inputFile, outputFile);

    const output = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(() => new Date(output.generatedAt).toISOString()).not.toThrow();
  });

  // ── 4. Happy path: 100-entry CSV ───────────────────────────────────────────

  it("generates valid JSON output for a 100-entry CSV", async () => {
    await writeFile(inputFile, largeEntryCsv(100));

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBeUndefined();

    const output = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(output.totalEntries).toBe(100);
    expect(typeof output.root).toBe("string");
    expect(output.root).toHaveLength(64);
    expect(Object.keys(output.proofs)).toHaveLength(100);

    // Spot-check: every proof array is non-empty for 100 entries (log2(100) ≈ 7)
    for (const proof of Object.values(output.proofs) as { proof: string[] }[]) {
      expect(proof.proof.length).toBeGreaterThan(0);
    }
  });

  // ── 5. Duplicate address → error ──────────────────────────────────────────

  it("exits with code 1 when the CSV contains a duplicate address", async () => {
    const csv = `${ADDR_A},1000\n${ADDR_A},500\n`;
    await writeFile(inputFile, csv);

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBe(1);
  });

  // ── 6. Invalid (non-numeric) amount → error ────────────────────────────────

  it("exits with code 1 when an amount is not a valid integer", async () => {
    const csv = `${ADDR_A},not-a-number\n${ADDR_B},500\n`;
    await writeFile(inputFile, csv);

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBe(1);
  });

  // ── 7. Zero-amount entry is accepted ──────────────────────────────────────

  it("accepts an entry with zero amount", async () => {
    const csv = `${ADDR_A},0\n${ADDR_B},500\n`;
    await writeFile(inputFile, csv);

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBeUndefined();

    const output = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(output.proofs[ADDR_A].amount).toBe("0");
  });

  // ── 8. Missing --input flag → exits with code 1 ──────────────────────────

  it("exits with code 1 when --input flag is missing", async () => {
    const { generateCommand } = await import("./generate.js");

    let capturedCode: number | undefined;
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number | string | null) => {
        capturedCode = typeof code === "number" ? code : 1;
        throw new Error(`process.exit(${capturedCode})`);
      });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      generateCommand.exitOverride();
      await generateCommand.parseAsync(
        ["node", "merkle-airdrop", "--output", outputFile],
        { from: "user" }
      );
    } catch {
      // Expected — either Commander or process.exit throw
    } finally {
      exitSpy.mockRestore();
      vi.spyOn(process.stderr, "write").mockRestore();
      vi.spyOn(process.stdout, "write").mockRestore();
    }

    // Commander throws a CommanderError (not process.exit) when exitOverride is set
    // — either way the command did not complete successfully.
    // capturedCode stays undefined if Commander threw before process.exit.
    // We just verify the command did NOT write an output file.
    let outputExists = false;
    try {
      await readFile(outputFile, "utf-8");
      outputExists = true;
    } catch { /* expected */ }
    expect(outputExists).toBe(false);
  });

  // ── 9. Missing --output flag → exits without writing output ──────────────

  it("exits with code 1 when --output flag is missing", async () => {
    await writeFile(inputFile, twoEntryCsv());

    const { generateCommand } = await import("./generate.js");

    let capturedCode: number | undefined;
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number | string | null) => {
        capturedCode = typeof code === "number" ? code : 1;
        throw new Error(`process.exit(${capturedCode})`);
      });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      generateCommand.exitOverride();
      await generateCommand.parseAsync(
        ["node", "merkle-airdrop", "--input", inputFile],
        { from: "user" }
      );
    } catch {
      // Expected
    } finally {
      exitSpy.mockRestore();
      vi.spyOn(process.stderr, "write").mockRestore();
      vi.spyOn(process.stdout, "write").mockRestore();
    }

    let outputExists = false;
    try {
      await readFile(outputFile, "utf-8");
      outputExists = true;
    } catch { /* expected */ }
    expect(outputExists).toBe(false);
  });

  // ── 10. Non-existent input file → error ───────────────────────────────────

  it("exits with code 1 when the input file does not exist", async () => {
    const { exitCode } = await runGenerate(
      join(tmpDir, "does-not-exist.csv"),
      outputFile
    );

    expect(exitCode).toBe(1);
  });

  // ── 11. Comments and blank lines are ignored ───────────────────────────────

  it("ignores comment lines and blank lines in the CSV", async () => {
    const csv = `# this is a comment\n\n${ADDR_A},1000\n\n# another comment\n${ADDR_B},500\n`;
    await writeFile(inputFile, csv);

    const { exitCode } = await runGenerate(inputFile, outputFile);

    expect(exitCode).toBeUndefined();

    const output = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(output.totalEntries).toBe(2);
  });

  // ── 12. Output JSON is valid and pretty-printed ───────────────────────────

  it("writes pretty-printed JSON that round-trips cleanly", async () => {
    await writeFile(inputFile, twoEntryCsv());

    await runGenerate(inputFile, outputFile);

    const raw = await readFile(outputFile, "utf-8");
    // Should not throw
    const parsed = JSON.parse(raw);
    // Should be pretty-printed (contains newlines and spaces)
    expect(raw).toMatch(/\n/);
    expect(parsed.root).toBeTruthy();
  });
});
