/**
 * `merkle-airdrop pause` and `merkle-airdrop unpause`
 *
 * Admin commands to pause or resume the airdrop contract.
 * Delegates to `setActive(false | true, adminSecretKey)` on the SDK client.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createAirdropClient, NETWORKS } from "@soroban-merkle-airdrop/sdk";
import type { NetworkConfig } from "@soroban-merkle-airdrop/sdk";

// ---------------------------------------------------------------------------
// Shared helper — builds a NetworkConfig from the root program options.
// ---------------------------------------------------------------------------

function resolveNetworkConfig(opts: {
  network?: string;
  contractId?: string;
  rpcUrl?: string;
}): NetworkConfig {
  const networkName = (opts.network ?? "testnet") as "testnet" | "mainnet";
  const preset = NETWORKS[networkName];

  if (!preset) {
    throw new Error(
      `Unknown network "${networkName}". Valid values: testnet, mainnet.`
    );
  }

  const contractId = opts.contractId;
  if (!contractId) {
    throw new Error(
      "Contract ID is required. Pass --contract-id <id> or set CONTRACT_ID in your environment."
    );
  }

  return {
    ...preset,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    contractId,
  };
}

// ---------------------------------------------------------------------------
// `pause` command
// ---------------------------------------------------------------------------

export const pauseCommand = new Command("pause")
  .description("Pause the airdrop contract (admin only)")
  .requiredOption(
    "-k, --admin-key <secretKey>",
    "Admin Stellar secret key (S…)"
  )
  .option("-n, --network <network>", "testnet | mainnet", "testnet")
  .option("--contract-id <id>", "Airdrop contract address")
  .option("--rpc-url <url>", "Override RPC URL")
  .action(async (opts) => {
    const spinner = ora("Pausing airdrop...").start();

    try {
      const config = resolveNetworkConfig(opts);
      const client = createAirdropClient(config);

      const { txHash } = await client.setActive(false, opts.adminKey);

      spinner.succeed(chalk.green("Airdrop paused successfully."));
      console.log(`\n  ${chalk.bold("Tx hash:")} ${chalk.cyan(txHash)}\n`);
    } catch (err) {
      spinner.fail(chalk.red(`Failed to pause: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `unpause` command
// ---------------------------------------------------------------------------

export const unpauseCommand = new Command("unpause")
  .description("Resume (unpause) the airdrop contract (admin only)")
  .requiredOption(
    "-k, --admin-key <secretKey>",
    "Admin Stellar secret key (S…)"
  )
  .option("-n, --network <network>", "testnet | mainnet", "testnet")
  .option("--contract-id <id>", "Airdrop contract address")
  .option("--rpc-url <url>", "Override RPC URL")
  .action(async (opts) => {
    const spinner = ora("Unpausing airdrop...").start();

    try {
      const config = resolveNetworkConfig(opts);
      const client = createAirdropClient(config);

      const { txHash } = await client.setActive(true, opts.adminKey);

      spinner.succeed(chalk.green("Airdrop unpaused successfully."));
      console.log(`\n  ${chalk.bold("Tx hash:")} ${chalk.cyan(txHash)}\n`);
    } catch (err) {
      spinner.fail(chalk.red(`Failed to unpause: ${(err as Error).message}`));
      process.exit(1);
    }
  });
