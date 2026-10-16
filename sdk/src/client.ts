/**
 * Typed client for the soroban-merkle-airdrop contract.
 */

import {
  Contract,
  rpc,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  xdr,
  scValToNative,
  nativeToScVal,
  Keypair,
  Address,
  Account,
  Networks,
} from "@stellar/stellar-sdk";
import type { ClaimProof, ClaimResult, NetworkConfig } from "./types.js";
import { AirdropContractError, RpcError } from "./types.js";

export function createAirdropClient(config: NetworkConfig) {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: false });
  const contractInst = new Contract(config.contractId);

  /** Check if an address has already claimed. */
  async function isClaimed(address: string): Promise<boolean> {
    const result = await simulateRead(
      contractInst.call("is_claimed", new Address(address).toScVal())
    );
    return scValToNative(result) as boolean;
  }

  /** Check if the airdrop is currently active. */
  async function isActive(): Promise<boolean> {
    const result = await simulateRead(contractInst.call("is_active"));
    return scValToNative(result) as boolean;
  }

  /** Fetch the Merkle root stored in the contract. */
  async function merkleRoot(): Promise<string | null> {
    const result = await simulateRead(contractInst.call("merkle_root"));
    const native = scValToNative(result);
    if (!native) return null;
    return Buffer.from(native as Uint8Array).toString("hex");
  }

  /** Fetch total tokens deposited. */
  async function totalDeposited(): Promise<bigint> {
    const result = await simulateRead(contractInst.call("total_deposited"));
    return BigInt(scValToNative(result) as number);
  }

  /**
   * Submit a claim transaction.
   *
   * @param claimProof - The proof package from `buildMerkleTree`.
   * @param signerSecretKey - The claimant's Stellar secret key (S...).
   */
  async function claim(
    claimProof: ClaimProof,
    signerSecretKey: string
  ): Promise<ClaimResult> {
    const keypair = Keypair.fromSecret(signerSecretKey);
    const sourceAccount = await server.getAccount(keypair.publicKey());

    // Convert proof array of hex strings → ScVal vec of BytesN<32>
    const proofScVal = xdr.ScVal.scvVec(
      claimProof.proof.map((h) => {
        const bytes = Buffer.from(h, "hex");
        return xdr.ScVal.scvBytes(bytes);
      })
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contractInst.call(
          "claim",
          new Address(keypair.publicKey()).toScVal(),
          nativeToScVal(claimProof.amount, { type: "i128" }),
          proofScVal
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      // Try to extract a numeric contract error code from the simulation error string.
      // Soroban surfaces contract errors as "Error(Contract, #N)" in the error message.
      const contractCode = parseContractErrorCode(simResult.error);
      if (contractCode !== null) {
        throw new AirdropContractError(contractCode);
      }
      throw new RpcError(`Simulation failed: ${simResult.error}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status === "ERROR") {
      throw new RpcError(
        `Transaction submission failed`,
        sendResult.errorResult?.toXDR("base64")
      );
    }

    const txHash = sendResult.hash;
    while (true) {
      await sleep(2000);
      const poll = await server.getTransaction(txHash);
      if (poll.status === "SUCCESS") {
        return {
          success: true,
          txHash,
          address: claimProof.address,
          amount: claimProof.amount,
        };
      }
      if (poll.status === "FAILED") {
        throw new RpcError(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

  /**
   * Build an unsigned claim transaction XDR string for external signing
   * (e.g. via a browser wallet like Freighter).
   *
   * The caller is responsible for signing the returned XDR and submitting it
   * via `submitSignedTransaction`.
   *
   * @param claimProof - The proof package from `buildMerkleTree`.
   * @returns Base64-encoded unsigned transaction envelope XDR.
   */
  async function buildClaimTransaction(claimProof: ClaimProof): Promise<string> {
    const sourceAccount = await server.getAccount(claimProof.address);

    const proofScVal = xdr.ScVal.scvVec(
      claimProof.proof.map((h) => {
        const bytes = Buffer.from(h, "hex");
        return xdr.ScVal.scvBytes(bytes);
      })
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contractInst.call(
          "claim",
          new Address(claimProof.address).toScVal(),
          nativeToScVal(claimProof.amount, { type: "i128" }),
          proofScVal
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      const contractCode = parseContractErrorCode(simResult.error);
      if (contractCode !== null) {
        throw new AirdropContractError(contractCode);
      }
      throw new RpcError(`Simulation failed: ${simResult.error}`);
    }

    // Assemble (adds auth + footprint) and return as unsigned XDR.
    return rpc.assembleTransaction(tx, simResult).build().toXDR();
  }

  /**
   * Submit a signed transaction XDR produced by an external wallet.
   *
   * @param signedXdr - Base64-encoded signed transaction envelope XDR.
   * @param claimProof - The original proof (used to populate the result).
   * @returns ClaimResult with the on-chain transaction hash and claimed amount.
   */
  async function submitSignedTransaction(
    signedXdr: string,
    claimProof: ClaimProof
  ): Promise<ClaimResult> {
    const txEnvelope = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase) as Transaction;
    const sendResult = await server.sendTransaction(txEnvelope);
    if (sendResult.status === "ERROR") {
      throw new RpcError(
        `Transaction submission failed`,
        sendResult.errorResult?.toXDR("base64")
      );
    }

    const txHash = sendResult.hash;
    while (true) {
      await sleep(2000);
      const poll = await server.getTransaction(txHash);
      if (poll.status === "SUCCESS") {
        return {
          success: true,
          txHash,
          address: claimProof.address,
          amount: claimProof.amount,
        };
      }
      if (poll.status === "FAILED") {
        throw new RpcError(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

  /**
   * Set the airdrop active/inactive state (admin only).
   *
   * Builds, signs, and submits a `set_active` transaction.
   * The `adminSecretKey` must belong to the address that was set as admin
   * when the contract was initialized.
   *
   * @param active - `true` to unpause (resume) the airdrop; `false` to pause it.
   * @param adminSecretKey - Admin's Stellar secret key (S…).
   * @returns Object containing the submitted transaction hash.
   * @throws {AirdropContractError} when the contract rejects (e.g. Unauthorized).
   * @throws {RpcError} for network / submission failures.
   *
   * @example
   * ```ts
   * // Pause the airdrop
   * const { txHash } = await client.setActive(false, adminSecretKey);
   *
   * // Resume it later
   * await client.setActive(true, adminSecretKey);
   * ```
   */
  async function setActive(
    active: boolean,
    adminSecretKey: string
  ): Promise<{ txHash: string }> {
    const keypair = Keypair.fromSecret(adminSecretKey);
    const sourceAccount = await server.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contractInst.call(
          "set_active",
          nativeToScVal(active, { type: "bool" })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      const contractCode = parseContractErrorCode(simResult.error);
      if (contractCode !== null) {
        throw new AirdropContractError(contractCode);
      }
      throw new RpcError(`Simulation failed: ${simResult.error}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status === "ERROR") {
      throw new RpcError(
        `Transaction submission failed`,
        sendResult.errorResult?.toXDR("base64")
      );
    }

    const txHash = sendResult.hash;
    while (true) {
      await sleep(2000);
      const poll = await server.getTransaction(txHash);
      if (poll.status === "SUCCESS") {
        return { txHash };
      }
      if (poll.status === "FAILED") {
        throw new RpcError(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

  async function simulateRead(operation: xdr.Operation): Promise<xdr.ScVal> {
    const dummy = Keypair.random();
    const account = new Account(dummy.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      throw new RpcError(`Read simulation failed: ${simResult.error}`);
    }
    return (simResult as rpc.Api.SimulateTransactionSuccessResponse).result!.retval;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  return { isClaimed, isActive, merkleRoot, totalDeposited, claim, buildClaimTransaction, submitSignedTransaction, setActive };
}

/**
 * Parse a numeric contract error code from a Soroban simulation error string.
 * Soroban formats contract errors as: "Error(Contract, #N)" where N is the code.
 * Returns the code as a number, or null if not parseable.
 */
function parseContractErrorCode(error: string): number | null {
  const match = /Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i.exec(error);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}
