# soroban-merkle-airdrop

> Gas-efficient Merkle tree airdrop for Stellar — distribute tokens to thousands of addresses using on-chain proof verification. Built with Soroban smart contracts.

[![CI](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## The Problem

Distributing tokens to thousands of addresses via batch transfers is expensive and slow. Every recipient costs a separate transaction.

## The Solution

Store only a **single 32-byte Merkle root** on-chain. Recipients prove their allocation by submitting a compact Merkle proof and claiming tokens themselves — one transaction per recipient, paid by the recipient.

```
Off-chain                          On-chain
─────────────────────────────      ──────────────────────────────
[ Alice: 1000 ]                    
[ Bob:    500 ]  → build tree →   MerkleRoot: 0xabc123...
[ Carol:  250 ]                    
[ ...10,000 more... ]              

Alice claims:
  proof = [sibling_hash_1, sibling_hash_2]  →  verify → transfer 1000 tokens ✓
```

This pattern is used by Uniswap, ENS, and many EVM protocols — now native to Stellar.

## Repository Structure

```
soroban-merkle-airdrop/
├── contracts/airdrop/          # Soroban contract (Rust)
│   └── src/
│       ├── lib.rs              # Contract: initialize, claim, reclaim, queries
│       ├── merkle.rs           # SHA-256 Merkle proof verification
│       ├── types.rs            # Storage keys, error types
│       └── test.rs             # Full contract test suite
├── sdk/                        # TypeScript SDK
│   └── src/
│       ├── merkle.ts           # Merkle tree builder + verifyProof
│       ├── client.ts           # Airdrop contract RPC client
│       ├── types.ts            # Shared types
│       └── merkle.test.ts      # SDK unit tests
├── cli/                        # merkle-airdrop CLI
│   └── src/
│       ├── commands/
│       │   ├── generate.ts     # Build tree from CSV → JSON
│       │   ├── claim.ts        # Submit claim transaction
│       │   ├── status.ts       # Query contract status
│       │   └── deploy.ts       # Deploy guidance
│       └── index.ts
├── web/                        # Next.js claim frontend
│   └── src/app/
│       ├── page.tsx            # Landing page
│       └── claim/page.tsx      # Check eligibility + claim UI
├── docs/
│   ├── architecture.md
│   ├── deploying.md
│   └── contributing.md
└── .github/workflows/
    ├── ci.yml                  # Build + test on every push
    └── deploy.yml              # Manual deploy to testnet/mainnet
```

## API Reference

Full TypeDoc-generated API reference for the TypeScript SDK:

```bash
cd sdk && pnpm docs   # generates sdk/docs/index.html
```

Or browse the source directly:
- [`sdk/src/merkle.ts`](sdk/src/merkle.ts) — `buildMerkleTree`, `verifyProof`, `leafHash`, `hashPair`
- [`sdk/src/client.ts`](sdk/src/client.ts) — `createAirdropClient` (RPC client)
- [`sdk/src/types.ts`](sdk/src/types.ts) — all types, interfaces, and error classes

## Example Script

A runnable end-to-end workflow is in [`examples/full-workflow.ts`](examples/full-workflow.ts).
It builds a 3-entry Merkle tree, verifies all proofs, and submits (or prints) a claim transaction:

```bash
# Dry-run — no keys required, prints the unsigned transaction XDR
DRY_RUN=1 npx ts-node examples/full-workflow.ts

# Live claim against testnet
CONTRACT_ID=C... SECRET_KEY=S... npx ts-node examples/full-workflow.ts
```

## SDK Installation

Install the TypeScript SDK into your project:

```bash
npm install @soroban-merkle-airdrop/sdk
# or
pnpm add @soroban-merkle-airdrop/sdk
```

```ts
import { buildMerkleTree, createAirdropClient, NETWORKS } from '@soroban-merkle-airdrop/sdk';

// Build a Merkle tree from your airdrop list
const { root, proofs } = buildMerkleTree([
  { address: "GABC...", amount: 1000n },
  { address: "GDEF...", amount: 500n },
]);

// Connect to the airdrop contract
const client = createAirdropClient({
  ...NETWORKS.testnet,
  contractId: "C...",
});

const claimed = await client.isClaimed("GABC...");
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
- Node.js 20+ and [pnpm](https://pnpm.io/)

### 1. Build the contract

```bash
cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release
cargo test --manifest-path contracts/airdrop/Cargo.toml
```

### 2. Generate a Merkle tree from your airdrop list

```bash
# Create a CSV: address,amount
echo "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,1000
GAYOLLLUIZE4DZMBB2ZBKGBUBZLIOYU6XFLW37GBP2VZD3ABNXCW4BVA,500" > airdrop.csv

cd cli && pnpm install && pnpm build
pnpm start generate --input ../airdrop.csv --output ../merkle-tree.json
# → Merkle root: 0xabc123...
```

### 3. Deploy the contract

```bash
# Upload and deploy
stellar contract upload --network testnet --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm

stellar contract deploy --network testnet --source deployer --wasm-hash <HASH>

# Initialise with the Merkle root and deposit tokens
stellar contract invoke --network testnet --source deployer --id <CONTRACT_ID> \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --token <TOKEN_CONTRACT> \
  --merkle_root <ROOT_FROM_GENERATE> \
  --total_amount <TOTAL>
```

### 4. Let recipients claim

```bash
# CLI
merkle-airdrop claim \
  --tree merkle-tree.json \
  --address GAAZI4... \
  --secret-key S... \
  --contract-id <CONTRACT_ID>

# Or use the web UI
cd web && pnpm install && pnpm dev
```

## CLI Reference

```
merkle-airdrop <command> [options]

Commands:
  generate   Build Merkle tree from CSV → JSON (run off-chain by organiser)
  claim      Submit claim transaction for an address
  status     Query on-chain contract status
  deploy     Deployment guide (uses Stellar CLI)

Global options:
  -n, --network <network>      testnet | mainnet  [default: testnet]
  --contract-id <id>           Airdrop contract address
```

## How the Merkle Proof Works

**Leaf hash:** `SHA-256( SHA-256(contract_strkey_utf8_bytes) ++ SHA-256(address_strkey_utf8_bytes) ++ amount_big_endian[16] )`

The contract address is SHA-256 hashed from its Stellar strkey string (`C...`) and
prepended to the leaf pre-image as a **domain separator**. This prevents a valid
proof from one contract deployment being replayed against a second deployment that
uses the same Merkle root (see [docs/replay-attack-analysis.md](docs/replay-attack-analysis.md)).

The claimant address is then SHA-256 hashed from its Stellar strkey string
(e.g. `GABC...` for accounts, `CABC...` for contracts). Both hashes are concatenated
with the 16-byte big-endian encoding of the amount and SHA-256'd again to produce
the leaf. The double-hash is necessary because Soroban's `Address` type does not
expose the raw public-key bytes directly in contract code.

**Node hash:** `SHA-256(min(left, right) ++ max(left, right))` — sorted so the tree is position-independent.

This means:
- The same distribution produces the same root regardless of list order
- Proofs are compact: O(log n) hashes for n recipients
- A proof is cryptographically bound to the specific contract it was built for
- The TypeScript builder and Rust verifier use identical algorithms

## Contributing

See [docs/contributing.md](docs/contributing.md).

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

MIT
