/**
 * `merkle-airdrop claim`
 *
 * Submit a claim transaction for a given address using the Merkle proof
 * from the generated tree JSON.
 */

import { Command } from "commander";
import { readFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { createAirdropClient, verifyProof, NETWORKS } from "@soroban-merkle-airdrop/sdk";
import { translateContractError } from "../errors.js";

export const claimCommand = new Command("claim")
  .description("Claim tokens from the airdrop")
  .requiredOption("-t, --tree <file>", "Merkle tree JSON (output of generate)")
  .requiredOption("-a, --address <address>", "Address to claim for")
  .option("-k, --secret-key <key>", "Stellar secret key (or set STELLAR_SECRET_KEY)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network = globalOpts.network ?? "testnet";
    const contractId = globalOpts.contractId ?? process.env.AIRDROP_CONTRACT_ID;
    const secretKey = opts.secretKey ?? process.env.STELLAR_SECRET_KEY;

    if (!contractId) {
      console.error(chalk.red("Error: --contract-id or AIRDROP_CONTRACT_ID required"));
      process.exit(1);
    }
    if (!secretKey) {
      console.error(chalk.red("Error: --secret-key or STELLAR_SECRET_KEY required"));
      process.exit(1);
    }

    const spinner = ora("Loading Merkle tree...").start();
    try {
      const raw = JSON.parse(await readFile(resolve(opts.tree), "utf-8"));
      const entry = raw.proofs[opts.address];
      if (!entry) {
        spinner.fail(chalk.red(`Address ${opts.address} not found in airdrop list`));
        process.exit(1);
      }

      const proof = { ...entry, amount: BigInt(entry.amount) };

      spinner.text = "Verifying proof locally...";
      const valid = verifyProof(raw.root, contractId, proof.address, proof.amount, proof.proof);
      if (!valid) {
        spinner.fail(chalk.red("Proof verification failed — tree may be corrupted"));
        process.exit(1);
      }

      const preset = NETWORKS[network];
      const client = createAirdropClient({
        ...preset,
        // Override rpcUrl if --rpc-url was provided on the global options.
        ...(globalOpts.rpcUrl ? { rpcUrl: globalOpts.rpcUrl } : {}),
        contractId,
      });

      spinner.text = "Checking claim status...";
      const already = await client.isClaimed(opts.address);
      if (already) {
        spinner.warn(chalk.yellow(`${opts.address} has already claimed.`));
        process.exit(0);
      }

      spinner.text = "Submitting claim transaction...";
      const result = await client.claim(proof, secretKey);

      spinner.succeed(chalk.green("Claim submitted!"));
      console.log(`\n  ${chalk.bold("Tx hash:")} ${chalk.cyan(result.txHash)}`);
      console.log(`  ${chalk.bold("Address:")} ${result.address}`);
      console.log(`  ${chalk.bold("Amount:")}  ${result.amount.toString()}\n`);
    } catch (err) {
      const message = translateContractError((err as Error).message);
      spinner.fail(`Error: ${message}`);
      process.exit(1);
    }
  });
