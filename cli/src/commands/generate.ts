/**
 * `merkle-airdrop generate`
 *
 * Read a CSV of (address, amount) pairs and produce a Merkle tree JSON
 * containing the root and all per-address proofs.
 *
 * Validation (Issue #25):
 *   - Each address must be a valid G... (Ed25519 public key) or C... (contract)
 *     Stellar strkey, checked via StrKey from @stellar/stellar-sdk.
 *   - Amount must be a non-empty, non-whitespace string that parses as a
 *     positive integer (BigInt > 0).
 *   - Clear, line-numbered error messages are emitted for any invalid row.
 *
 * Issue #70: Auto-detect and skip CSV header row.
 *   - If the first non-comment, non-blank line has "address" as its first
 *     field (case-insensitive) it is treated as a header and skipped.
 *   - --has-header forces header skipping even when auto-detection would
 *     not trigger (e.g. if the first field is not exactly "address").
 *
 * Issue #67: --json flag.
 *   - When --json is passed, the tree JSON is printed to stdout and the
 *     spinner / coloured output is suppressed.
 */

import { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { StrKey } from "@stellar/stellar-sdk";
import { buildMerkleTree } from "@soroban-merkle-airdrop/sdk";
import type { AirdropEntry } from "@soroban-merkle-airdrop/sdk";

/**
 * Return true if `addr` is a valid Stellar G... account key or C... contract address.
 */
function isValidStellarAddress(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr);
}

/**
 * Parse and validate a single CSV data line.
 * Returns an `AirdropEntry` on success, or throws an Error with a human-readable
 * message that includes the 1-based line number within the original file.
 *
 * @param rawLine  - The original untrimmed CSV line (for error context).
 * @param lineNum  - 1-based line number in the source file (used in error messages).
 */
export function parseAndValidateLine(rawLine: string, lineNum: number): AirdropEntry {
  const trimmed = rawLine.trim();

  const parts = trimmed.split(",");
  const address = parts[0]?.trim() ?? "";
  const amountRaw = parts[1]?.trim() ?? "";

  // Validate address
  if (!address) {
    throw new Error(`Line ${lineNum}: address is empty`);
  }
  if (!isValidStellarAddress(address)) {
    throw new Error(`Line ${lineNum}: invalid Stellar address "${address}"`);
  }

  // Validate amount — must be present and non-whitespace
  if (!amountRaw) {
    throw new Error(`Line ${lineNum}: amount is empty or whitespace-only`);
  }

  let amount: bigint;
  try {
    amount = BigInt(amountRaw);
  } catch {
    throw new Error(`Line ${lineNum}: amount "${amountRaw}" is not a valid integer`);
  }

  if (amount <= 0n) {
    throw new Error(`Line ${lineNum}: amount must be greater than zero, got "${amountRaw}"`);
  }

  return { address, amount };
}

/**
 * Detect whether `line` looks like a CSV header row.
 *
 * Returns `true` when the first comma-delimited field, trimmed and
 * lower-cased, equals `"address"`.
 *
 * @param line - The raw CSV line to inspect.
 */
export function isHeaderRow(line: string): boolean {
  const firstField = line.split(",")[0]?.trim().toLowerCase() ?? "";
  return firstField === "address";
}

/**
 * Factory that creates a fresh `generate` Command instance.
 * Exporting a factory rather than a singleton means tests can call
 * `makeGenerateCommand()` to get a clean instance with no cached option
 * values from a previous parse.
 */
export function makeGenerateCommand(): Command {
  return new Command("generate")
    .description("Build a Merkle tree from a CSV airdrop list")
    .requiredOption("-i, --input <file>", "CSV file: address,amount (one per line)")
    .requiredOption("-o, --output <file>", "Output JSON file for Merkle tree + proofs")
    .requiredOption(
      "-c, --contract-id <address>",
      "Deployed airdrop contract address (C...) — included as domain separator in leaf hashes"
    )
    .option("--has-header", "Force-skip the first data row as a CSV header")
    .option("--json", "Print tree JSON to stdout instead of writing to --output (suppresses spinner)")
    .action(async (opts) => {
      const jsonMode: boolean = opts.json ?? false;

      // In JSON mode suppress the spinner so stdout stays clean.
      const spinner = jsonMode
        ? {
            start: () => spinner,
            succeed: () => {},
            fail: (msg: string) => { console.error(msg); },
            text: "",
          }
        : ora("Reading airdrop list...").start();

      try {
        const csv = await readFile(resolve(opts.input), "utf-8");
        const entries: AirdropEntry[] = [];
        const errors: string[] = [];

        const lines = csv.split("\n");
        let lineNum = 0;
        let headerSkipped = false;

        for (const line of lines) {
          lineNum++;
          const trimmed = line.trim();

          // Skip blank lines and comments
          if (!trimmed || trimmed.startsWith("#")) continue;

          // Issue #70: skip header row.
          // --has-header: always skip the first data line.
          // Auto-detect: skip if first field is "address" (case-insensitive).
          if (!headerSkipped) {
            if (opts.hasHeader || isHeaderRow(trimmed)) {
              headerSkipped = true;
              continue;
            }
          }

          try {
            entries.push(parseAndValidateLine(line, lineNum));
          } catch (err) {
            errors.push((err as Error).message);
          }
        }

        // Report all validation errors at once before aborting
        if (errors.length > 0) {
          (spinner as { fail: (msg: string) => void }).fail(
            chalk.red(`Found ${errors.length} validation error(s) in ${opts.input}:`)
          );
          for (const e of errors) {
            console.error(`  ${chalk.red("✖")} ${e}`);
          }
          process.exit(1);
        }

        if (entries.length === 0) {
          (spinner as { fail: (msg: string) => void }).fail(
            chalk.red("CSV contains no valid entries")
          );
          process.exit(1);
        }

        (spinner as { text: string }).text = `Building Merkle tree for ${entries.length} entries...`;
        const { root, proofs } = buildMerkleTree(opts.contractId as string, entries);

        const output = {
          root,
          totalEntries: entries.length,
          totalAmount: entries.reduce((s, e) => s + e.amount, 0n).toString(),
          generatedAt: new Date().toISOString(),
          proofs: Object.fromEntries(
            [...proofs.entries()].map(([addr, p]) => [
              addr,
              { ...p, amount: p.amount.toString() },
            ])
          ),
        };

        // Issue #67: --json mode — print to stdout, skip file write.
        if (jsonMode) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        await writeFile(resolve(opts.output), JSON.stringify(output, null, 2));
        (spinner as ReturnType<typeof ora>).succeed(chalk.green(`Merkle tree generated!`));
        console.log(`\n  ${chalk.bold("Root:")}    ${chalk.cyan(root)}`);
        console.log(`  ${chalk.bold("Entries:")} ${entries.length}`);
        console.log(`  ${chalk.bold("Output:")}  ${opts.output}\n`);
      } catch (err) {
        (spinner as { fail: (msg: string) => void }).fail(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

/** Singleton instance used by the CLI entry point. */
export const generateCommand = makeGenerateCommand();
