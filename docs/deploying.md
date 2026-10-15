# Deploying soroban-merkle-airdrop

This guide walks you through every step required to deploy the Merkle airdrop contract to Stellar testnet or mainnet — from building the WASM artifact to verifying the initialised contract on-chain.

---

## Prerequisites

Before you start, ensure you have the following installed:

| Tool | Version | Install |
|---|---|---|
| Rust | stable | `rustup install stable` |
| `wasm32v1-none` target | — | `rustup target add wasm32v1-none` |
| Stellar CLI | latest | See [Stellar docs](https://developers.stellar.org/docs/tools/cli) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 8+ | `npm install -g pnpm` |

You also need:
* A Stellar **deployer** keypair with sufficient XLM to pay for contract deployment and token deposit fees.
* A funded SEP-41 **token contract** address on your target network.
* A completed Merkle tree JSON produced by `merkle-airdrop generate` (see below).

---

## Testnet Quickstart

The fastest path to a working testnet deployment.

### 1. Fund a testnet identity

```bash
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet   # uses Friendbot
```

### 2. Build the WASM

```bash
cargo build \
  --manifest-path contracts/airdrop/Cargo.toml \
  --target wasm32v1-none \
  --release
```

The output is at `target/wasm32v1-none/release/soroban_merkle_airdrop.wasm`.

### 3. Generate a Merkle tree from your airdrop list

Create a CSV file (`airdrop.csv`) with one `address,amount` row per recipient:

```csv
GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,1000
GAYOLLLUIZE4DZMBB2ZBKGBUBZLIOYU6XFLW37GBP2VZD3ABNXCW4BVA,500
```

Then build the tree:

```bash
cd cli
pnpm install && pnpm build
pnpm start generate --input ../airdrop.csv --output ../merkle-tree.json
```

Note the **Merkle root** printed to stdout (e.g. `0xabc123...`). You will need it during initialisation.

### 4. Upload the WASM

```bash
WASM_HASH=$(stellar contract upload \
  --network testnet \
  --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm)

echo "WASM hash: $WASM_HASH"
```

### 5. Deploy the contract

```bash
CONTRACT_ID=$(stellar contract deploy \
  --network testnet \
  --source deployer \
  --wasm-hash "$WASM_HASH")

echo "Contract ID: $CONTRACT_ID"
```

### 6. Initialise the contract

The `initialize` call deposits tokens from the deployer account into the contract and sets the Merkle root. The `--expiration` parameter is a Unix timestamp (seconds since epoch) after which unclaimed tokens can be reclaimed.

```bash
# Example: set expiration 30 days from now
EXPIRATION=$(date -d "+30 days" +%s)   # Linux
# EXPIRATION=$(date -v+30d +%s)        # macOS

stellar contract invoke \
  --network testnet \
  --source deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --token <TOKEN_CONTRACT_ADDRESS> \
  --merkle_root <ROOT_FROM_STEP_3> \
  --total_amount <TOTAL_TOKENS> \
  --expiration "$EXPIRATION"
```

> **Important:** `total_amount` must equal the exact sum of all allocations in your CSV. The deployer must have approved the token contract to transfer this amount.

### 7. Verify on-chain

```bash
# Check contract status using the CLI
merkle-airdrop status --network testnet --contract-id "$CONTRACT_ID"
```

Expected output:
```
  Contract:    C...
  Network:     testnet
  Active:      yes
  Root:        abc123...
  Deposited:   <total>
  Expiration:  Thu, 01 Jan 2026 00:00:00 GMT
```

You can also query individual fields directly:

```bash
# Is the contract active?
stellar contract invoke --network testnet --id "$CONTRACT_ID" \
  -- is_active

# What is the Merkle root?
stellar contract invoke --network testnet --id "$CONTRACT_ID" \
  -- merkle_root

# When does it expire?
stellar contract invoke --network testnet --id "$CONTRACT_ID" \
  -- expiration
```

---

## Mainnet Checklist

Deploying to mainnet involves real funds. Work through each item before proceeding.

- [ ] **Audit your Merkle tree.** Re-run `merkle-airdrop generate` and verify the root matches your records.
- [ ] **Test on testnet first.** Run through the entire testnet quickstart with the same CSV.
- [ ] **Fund the deployer wallet.** Ensure it has enough XLM to cover contract deployment, storage rent, and the token deposit transaction.
- [ ] **Set a reasonable expiration.** A 90–180 day window is typical. Too short and legitimate claimants miss out; too long and capital is locked unnecessarily.
- [ ] **Double-check total_amount.** It must match the sum of all allocations exactly. Excess tokens are locked until `reclaim()` is called after expiration.
- [ ] **Secure the deployer keypair.** After `initialize`, the `admin` address controls `set_active`, `transfer_admin`, and `reclaim`. Store the key in a hardware wallet or multi-sig.
- [ ] **Verify the token address.** Confirm the SEP-41 token contract address is the correct asset on mainnet.

Once ready, follow the same steps as the testnet quickstart but with `--network mainnet`:

```bash
# Build (same as testnet)
cargo build \
  --manifest-path contracts/airdrop/Cargo.toml \
  --target wasm32v1-none \
  --release

# Upload
WASM_HASH=$(stellar contract upload \
  --network mainnet \
  --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm)

# Deploy
CONTRACT_ID=$(stellar contract deploy \
  --network mainnet \
  --source deployer \
  --wasm-hash "$WASM_HASH")

# Initialise (with expiration)
EXPIRATION=$(date -d "+90 days" +%s)

stellar contract invoke \
  --network mainnet \
  --source deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --token <TOKEN_CONTRACT_ADDRESS> \
  --merkle_root <ROOT> \
  --total_amount <TOTAL> \
  --expiration "$EXPIRATION"
```

---

## GitHub Actions: `deploy.yml`

The repository ships a manual GitHub Actions workflow at `.github/workflows/deploy.yml` that automates the build-upload-deploy-initialise sequence.

### Inputs

| Input | Required | Description |
|---|---|---|
| `network` | Yes | `testnet` or `mainnet` |
| `merkle_root` | Yes | 32-byte hex root from `merkle-airdrop generate` |
| `total_amount` | Yes | Total tokens to deposit |
| `token_address` | Yes | SEP-41 token contract address |
| `expiration` | Yes | Unix timestamp after which reclaim is permitted |

### Secret required

Add your deployer secret key as a repository secret named `DEPLOYER_SECRET_KEY` (Settings → Secrets and variables → Actions).

### Running the workflow

1. Go to **Actions → Deploy Contract → Run workflow**.
2. Select the target network, fill in all inputs, and click **Run workflow**.
3. The workflow prints the final `Contract ID` and `WASM hash` in the job summary.

### What the workflow does

1. Checks out the repository and installs the Rust toolchain with `wasm32v1-none`.
2. Builds the WASM artifact.
3. Installs the Stellar CLI.
4. Adds the deployer identity from `DEPLOYER_SECRET_KEY`.
5. Uploads the WASM and captures the hash.
6. Deploys the contract and captures the contract ID.
7. Calls `initialize` with all provided inputs including `--expiration`.

---

## Reclaiming Unclaimed Tokens

After the expiration timestamp has passed, the admin can recover any tokens that were never claimed:

```bash
stellar contract invoke \
  --network <testnet|mainnet> \
  --source deployer \
  --id "$CONTRACT_ID" \
  -- reclaim
```

This transfers the remaining contract balance back to the admin address and emits a `reclaimed` event.

---

## Transferring Admin Ownership

To rotate the admin key (e.g. after a key compromise or team change):

```bash
stellar contract invoke \
  --network <testnet|mainnet> \
  --source <current-admin-key> \
  --id "$CONTRACT_ID" \
  -- transfer_admin \
  --new_admin <NEW_ADMIN_ADDRESS>
```

The old admin must authorise this call. After it succeeds, only the new admin can call `set_active`, `reclaim`, and `transfer_admin`.

---

## Troubleshooting

**`AlreadyInitialized` error on `initialize`**
The contract has already been initialised. Each deployed contract ID can only be initialised once. Deploy a new contract if you need to start over.

**`ZeroAmount` error on `initialize`**
`total_amount` must be greater than zero.

**`NotYetExpired` error on `reclaim`**
The current ledger timestamp is before the expiration you set. Wait until the expiration has passed.

**Contract not found / archived**
If the contract's storage TTL expired, call `restore` to bring it back:

```bash
stellar contract invoke --network testnet --id "$CONTRACT_ID" -- restore
```

Anyone can call `restore` — no admin auth required.
