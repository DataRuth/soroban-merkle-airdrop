#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { generateCommand } from "./commands/generate.js";
import { claimCommand } from "./commands/claim.js";
import { statusCommand } from "./commands/status.js";
import { deployCommand } from "./commands/deploy.js";
import { pauseCommand, unpauseCommand } from "./commands/pause.js";

const program = new Command();

program
  .name("merkle-airdrop")
  .description("Create and manage Merkle tree airdrops on Stellar / Soroban")
  .version("0.1.0");

program
  .option("-n, --network <network>", 'Stellar network ("testnet" or "mainnet")', "testnet")
  .option("--contract-id <id>", "Airdrop contract address")
  .option("--rpc-url <url>", "Override RPC URL");

program.addCommand(generateCommand);
program.addCommand(claimCommand);
program.addCommand(statusCommand);
program.addCommand(deployCommand);
program.addCommand(pauseCommand);
program.addCommand(unpauseCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
