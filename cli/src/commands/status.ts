/**
 * `merkle-airdrop status`
 *
 * Query the on-chain airdrop contract status and optionally check
 * whether specific addresses have claimed.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createAirdropClient, NETWORKS } from "@soroban-merkle-airdrop/sdk";

export interface StatusOptions {
  address?: string;
  /** When true, output structured JSON instead of coloured text. */
  json?: boolean;
}

export interface StatusGlobalOptions {
  network?: string;
  contractId?: string;
  /** Override the preset RPC URL (Issue #68). */
  rpcUrl?: string;
}

/**
 * Core logic for the status command, extracted so it can be unit-tested
 * without Commander's state machine. The CLI wires this into the Command.
 */
export async function runStatusAction(
  opts: StatusOptions,
  globalOpts: StatusGlobalOptions
): Promise<void> {
  const network = globalOpts.network ?? "testnet";
  const contractId = globalOpts.contractId ?? process.env.AIRDROP_CONTRACT_ID;
  const jsonMode = opts.json ?? false;

  if (!contractId) {
    console.error(chalk.red("Error: --contract-id or AIRDROP_CONTRACT_ID required"));
    process.exit(1);
  }

  // In JSON mode we suppress the spinner so stdout stays clean.
  const spinner = jsonMode
    ? { start: () => spinner, succeed: () => {}, fail: (msg: string) => { console.error(msg); }, text: "" }
    : ora(`Querying contract on ${chalk.cyan(network)}...`).start();

  try {
    const preset = NETWORKS[network];
    const client = createAirdropClient({
      ...preset,
      // Override rpcUrl if --rpc-url was provided on the global options (Issue #68).
      ...(globalOpts.rpcUrl ? { rpcUrl: globalOpts.rpcUrl } : {}),
      contractId,
    });

    const [active, root, total, exp] = await Promise.all([
      client.isActive(),
      client.merkleRoot(),
      client.totalDeposited(),
      client.expiration(),
    ]);

    let claimed: boolean | undefined;
    if (opts.address) {
      claimed = await client.isClaimed(opts.address);
    }

    // ── JSON output (Issue #67) ───────────────────────────────────────────
    if (jsonMode) {
      const output: Record<string, unknown> = {
        contractId,
        network,
        active,
        root: root ?? null,
        deposited: total.toString(),
        expiration: exp !== null ? exp.toString() : null,
      };
      if (opts.address !== undefined) {
        output["address"] = opts.address;
        output["claimed"] = claimed;
      }
      console.log(JSON.stringify(output));
      return;
    }

    // ── Human-readable output ─────────────────────────────────────────────

    // Format expiration for display.
    let expirationLine: string;
    if (exp === null) {
      expirationLine = chalk.gray("not set");
    } else {
      const expMs = Number(exp) * 1000;
      const expDate = new Date(expMs).toUTCString();
      const nowMs = Date.now();
      if (nowMs > expMs) {
        expirationLine = `${expDate}  ${chalk.red("(EXPIRED)")}`;
      } else {
        expirationLine = expDate;
      }
    }

    (spinner as ReturnType<typeof ora>).succeed("Contract status:");
    console.log(`\n  ${chalk.bold("Contract:")}    ${chalk.cyan(contractId)}`);
    console.log(`  ${chalk.bold("Network:")}     ${network}`);
    console.log(`  ${chalk.bold("Active:")}      ${active ? chalk.green("yes") : chalk.red("no")}`);
    console.log(`  ${chalk.bold("Root:")}        ${chalk.cyan(root ?? "not initialized")}`);
    console.log(`  ${chalk.bold("Deposited:")}   ${total.toString()}`);
    console.log(`  ${chalk.bold("Expiration:")}  ${expirationLine}`);

    if (opts.address) {
      console.log(
        `\n  ${chalk.bold(opts.address)}: ${
          claimed ? chalk.yellow("already claimed") : chalk.green("not yet claimed")
        }`
      );
    }
    console.log();
  } catch (err) {
    (spinner as { fail: (msg: string) => void }).fail(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

export const statusCommand = new Command("status")
  .description("Query on-chain airdrop contract status")
  .option("-a, --address <address>", "Check if a specific address has claimed")
  .option("--json", "Output structured JSON instead of coloured text")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    await runStatusAction(opts, globalOpts);
  });
