/**
 * `merkle-airdrop deploy`
 *
 * Deploy the soroban-merkle-airdrop contract and initialise it — all
 * programmatically via @stellar/stellar-sdk.
 *
 * Usage:
 *   merkle-airdrop deploy \
 *     --wasm path/to/soroban_merkle_airdrop.wasm \
 *     --token <SEP-41 token contract address> \
 *     --tree  merkle-tree.json \
 *     --expiration <unix timestamp> \
 *     [--secret-key S...] [--network testnet] [--dry-run]
 *
 * Pass --dry-run to print the equivalent Stellar CLI commands instead of
 * executing them.
 */

import { Command } from "commander";
import { readFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import {
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Networks,
  rpc as StellarRpc,
  xdr,
  nativeToScVal,
  Address,
  Contract,
} from "@stellar/stellar-sdk";

// ─── RPC preset URLs ─────────────────────────────────────────────────────────

const RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

// ─── Internal deploy logic (exported so tests can call it directly) ──────────

export interface DeployOptions {
  wasm: string;
  token: string;
  tree: string;
  expiration: string;
  secretKey: string;
  network: string;
  rpcUrl?: string;
  dryRun?: boolean;
}

export interface DeployResult {
  contractId: string;
  wasmHash: string;
  network: string;
}

/**
 * Deploy and initialise the airdrop contract programmatically.
 *
 * Steps:
 *  1. Upload the WASM blob → obtain wasm_hash.
 *  2. Create a contract instance from the wasm_hash → obtain contract_id.
 *  3. Call `initialize` on the new contract with (admin, token, merkle_root,
 *     total_amount, expiration).
 *
 * @throws if any step fails.
 */
export async function programmaticDeploy(opts: DeployOptions): Promise<DeployResult> {
  const { wasm, token, tree: treePath, expiration, secretKey, network } = opts;
  const rpcUrl = opts.rpcUrl ?? RPC_URLS[network];
  const networkPassphrase = NETWORK_PASSPHRASES[network];

  if (!rpcUrl) throw new Error(`Unknown network: ${network}. Use testnet or mainnet.`);
  if (!networkPassphrase) throw new Error(`No passphrase for network: ${network}`);

  const keypair = Keypair.fromSecret(secretKey);
  const server = new StellarRpc.Server(rpcUrl, { allowHttp: false });

  // ── Load WASM bytes ─────────────────────────────────────────────────────
  const wasmBytes = await readFile(resolve(wasm));

  // ── Load Merkle tree JSON ───────────────────────────────────────────────
  const treeJson = JSON.parse(await readFile(resolve(treePath), "utf-8"));
  const merkleRoot: string = treeJson.root;
  const totalAmount: bigint = BigInt(treeJson.totalAmount ?? treeJson.total_amount ?? 0);

  if (!merkleRoot) throw new Error("Merkle tree JSON is missing a 'root' field");
  if (totalAmount === 0n) {
    throw new Error(
      "Merkle tree JSON is missing 'totalAmount' (or 'total_amount'). " +
      "Re-run `merkle-airdrop generate` to rebuild the tree."
    );
  }

  const sourceAccount = await server.getAccount(keypair.publicKey());

  // ── Step 1: Upload WASM ─────────────────────────────────────────────────
  const uploadTx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.uploadContractWasm({ wasm: wasmBytes })
    )
    .setTimeout(60)
    .build();

  const uploadSim = await server.simulateTransaction(uploadTx);
  if (StellarRpc.Api.isSimulationError(uploadSim)) {
    throw new Error(`WASM upload simulation failed: ${uploadSim.error}`);
  }

  const preparedUpload = StellarRpc.assembleTransaction(uploadTx, uploadSim).build();
  preparedUpload.sign(keypair);

  const uploadResult = await server.sendTransaction(preparedUpload);
  if (uploadResult.status === "ERROR") {
    throw new Error(
      `WASM upload transaction failed: ${uploadResult.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  const wasmHash = await pollTransactionSuccess(server, uploadResult.hash);
  // The return value from uploadContractWasm is the wasm hash bytes.
  const wasmHashHex = extractReturnValue(wasmHash);

  // ── Step 2: Deploy contract instance ────────────────────────────────────
  // Refresh account sequence number after the upload transaction.
  const accountAfterUpload = await server.getAccount(keypair.publicKey());

  const deployTx = new TransactionBuilder(accountAfterUpload, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(keypair.publicKey()),
        wasmHash: Buffer.from(wasmHashHex, "hex"),
        salt: crypto.getRandomValues(new Uint8Array(32)),
      })
    )
    .setTimeout(60)
    .build();

  const deploySim = await server.simulateTransaction(deployTx);
  if (StellarRpc.Api.isSimulationError(deploySim)) {
    throw new Error(`Contract deploy simulation failed: ${deploySim.error}`);
  }

  const preparedDeploy = StellarRpc.assembleTransaction(deployTx, deploySim).build();
  preparedDeploy.sign(keypair);

  const deployResult = await server.sendTransaction(preparedDeploy);
  if (deployResult.status === "ERROR") {
    throw new Error(
      `Contract deploy transaction failed: ${deployResult.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  const deployTxResult = await pollTransactionSuccess(server, deployResult.hash);
  const contractId = extractContractIdFromResult(deployTxResult);

  // ── Step 3: Initialize contract ──────────────────────────────────────────
  const accountAfterDeploy = await server.getAccount(keypair.publicKey());

  const contractInst = new Contract(contractId);
  const merkleRootBytes = Buffer.from(merkleRoot.replace(/^0x/, ""), "hex");

  const initTx = new TransactionBuilder(accountAfterDeploy, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contractInst.call(
        "initialize",
        new Address(keypair.publicKey()).toScVal(),      // admin
        new Address(token).toScVal(),                    // token
        xdr.ScVal.scvBytes(merkleRootBytes),             // merkle_root: BytesN<32>
        nativeToScVal(totalAmount, { type: "i128" }),    // total_amount: i128
        nativeToScVal(BigInt(expiration), { type: "u64" }) // expiration: u64
      )
    )
    .setTimeout(60)
    .build();

  const initSim = await server.simulateTransaction(initTx);
  if (StellarRpc.Api.isSimulationError(initSim)) {
    throw new Error(`Initialize simulation failed: ${initSim.error}`);
  }

  const preparedInit = StellarRpc.assembleTransaction(initTx, initSim).build();
  preparedInit.sign(keypair);

  const initResult = await server.sendTransaction(preparedInit);
  if (initResult.status === "ERROR") {
    throw new Error(
      `Initialize transaction failed: ${initResult.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  await pollTransactionSuccess(server, initResult.hash);

  return { contractId, wasmHash: wasmHashHex, network };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

async function pollTransactionSuccess(
  server: StellarRpc.Server,
  txHash: string
): Promise<StellarRpc.Api.GetSuccessfulTransactionResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_INTERVAL_MS);
    if (Date.now() >= deadline) {
      throw new Error(`Transaction confirmation timeout after ${POLL_TIMEOUT_MS}ms: ${txHash}`);
    }
    const poll = await server.getTransaction(txHash);
    if (poll.status === "SUCCESS") {
      return poll as StellarRpc.Api.GetSuccessfulTransactionResponse;
    }
    if (poll.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${txHash}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract the hex-encoded return value from an uploadContractWasm result.
 * The return value is the raw wasm hash bytes (scvBytes).
 */
function extractReturnValue(txResult: StellarRpc.Api.GetSuccessfulTransactionResponse): string {
  try {
    const meta = txResult.resultMetaXdr;
    const resultMeta = xdr.TransactionMeta.fromXDR(meta.toXDR());
    const v3 = resultMeta.v3();
    const sorobanMeta = v3.sorobanMeta();
    if (!sorobanMeta) throw new Error("No Soroban metadata in transaction result");
    const retval = sorobanMeta.returnValue();
    if (retval.switch() === xdr.ScValType.scvBytes()) {
      return Buffer.from(retval.bytes()).toString("hex");
    }
    throw new Error(`Unexpected return value type: ${retval.switch().name}`);
  } catch (err) {
    throw new Error(`Failed to extract WASM hash from transaction result: ${(err as Error).message}`);
  }
}

/**
 * Extract the deployed contract ID from the deploy transaction result.
 * The return value of createCustomContract is the contract address (scvAddress).
 */
function extractContractIdFromResult(
  txResult: StellarRpc.Api.GetSuccessfulTransactionResponse
): string {
  try {
    const meta = txResult.resultMetaXdr;
    const resultMeta = xdr.TransactionMeta.fromXDR(meta.toXDR());
    const v3 = resultMeta.v3();
    const sorobanMeta = v3.sorobanMeta();
    if (!sorobanMeta) throw new Error("No Soroban metadata in transaction result");
    const retval = sorobanMeta.returnValue();
    if (retval.switch() === xdr.ScValType.scvAddress()) {
      const addr = retval.address();
      if (addr.switch() === xdr.ScAddressType.scAddressTypeContract()) {
        return Address.contract(addr.contractId()).toString();
      }
    }
    throw new Error(`Unexpected return value type: ${retval.switch().name}`);
  } catch (err) {
    throw new Error(`Failed to extract contract ID from transaction result: ${(err as Error).message}`);
  }
}

// ─── Commander command definition ────────────────────────────────────────────

export const deployCommand = new Command("deploy")
  .description("Deploy and initialise the airdrop contract programmatically via Stellar SDK")
  .requiredOption("-w, --wasm <file>", "Path to compiled WASM file")
  .requiredOption("--token <address>", "SEP-41 token contract address to distribute")
  .requiredOption("-t, --tree <file>", "Merkle tree JSON (output of generate)")
  .requiredOption("-e, --expiration <timestamp>", "Unix timestamp after which reclaim is permitted")
  .option("-k, --secret-key <key>", "Deployer secret key (or set STELLAR_SECRET_KEY)")
  .option("--dry-run", "Print equivalent Stellar CLI commands instead of executing")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network: string = globalOpts.network ?? "testnet";
    const rpcUrl: string | undefined = globalOpts.rpcUrl;
    const secretKey: string | undefined = opts.secretKey ?? process.env.STELLAR_SECRET_KEY;

    // ── Dry-run mode: print shell commands ──────────────────────────────────
    if (opts.dryRun) {
      console.log(chalk.bold("\n🚀 Stellar CLI deployment commands\n"));
      console.log(chalk.gray("Pass the output of each step as input to the next.\n"));

      console.log(`${chalk.bold("1.")} Build the WASM:`);
      console.log(chalk.cyan("   cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release\n"));

      console.log(`${chalk.bold("2.")} Upload WASM:`);
      console.log(chalk.cyan(
        `   stellar contract upload --network ${network} --source deployer \\\n` +
        `       --wasm ${opts.wasm}\n`
      ));

      console.log(`${chalk.bold("3.")} Deploy contract:`);
      console.log(chalk.cyan(`   stellar contract deploy --network ${network} --source deployer --wasm-hash <WASM_HASH>\n`));

      let treeRoot = "<MERKLE_ROOT_FROM_GENERATE>";
      let treeTotal = "<TOTAL_AMOUNT_FROM_GENERATE>";
      try {
        const raw = JSON.parse(await readFile(resolve(opts.tree), "utf-8").catch(() => "{}"));
        if (raw.root) treeRoot = raw.root;
        if (raw.totalAmount ?? raw.total_amount) treeTotal = String(raw.totalAmount ?? raw.total_amount);
      } catch { /* ignore — best-effort */ }

      console.log(`${chalk.bold("4.")} Initialise contract:`);
      console.log(chalk.cyan(
        `   stellar contract invoke --network ${network} --source deployer \\\n` +
        `       --id <CONTRACT_ID> -- initialize \\\n` +
        `       --admin $(stellar keys address deployer) \\\n` +
        `       --token ${opts.token} \\\n` +
        `       --merkle_root ${treeRoot} \\\n` +
        `       --total_amount ${treeTotal} \\\n` +
        `       --expiration ${opts.expiration}\n`
      ));

      console.log(chalk.green("See docs/deploying.md for full instructions.\n"));
      return;
    }

    // ── Live deploy ─────────────────────────────────────────────────────────
    if (!secretKey) {
      console.error(chalk.red("Error: --secret-key or STELLAR_SECRET_KEY is required for deployment"));
      process.exit(1);
    }

    const spinner = ora("Deploying airdrop contract…").start();

    try {
      spinner.text = "Uploading WASM…";
      const result = await programmaticDeploy({
        wasm: opts.wasm,
        token: opts.token,
        tree: opts.tree,
        expiration: opts.expiration,
        secretKey,
        network,
        rpcUrl,
      });

      spinner.succeed(chalk.green("Deployment complete!"));
      console.log(`\n  ${chalk.bold("Contract ID:")} ${chalk.cyan(result.contractId)}`);
      console.log(`  ${chalk.bold("WASM hash:")}   ${chalk.gray(result.wasmHash)}`);
      console.log(`  ${chalk.bold("Network:")}     ${result.network}\n`);
      console.log(chalk.gray(`Save the contract ID — pass it as --contract-id to claim/status commands.`));
    } catch (err) {
      spinner.fail(chalk.red(`Deployment failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });
