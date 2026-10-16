# Architecture

## Overview

`soroban-merkle-airdrop` is a gas-efficient token distribution system for
Stellar. Instead of pushing tokens to thousands of addresses up-front, the
organiser stores a single 32-byte Merkle root on-chain and recipients pull
their allocation by submitting a compact Merkle proof. This means:

- **One transaction per recipient**, paid by the recipient themselves.
- **Constant on-chain storage** regardless of distribution size.
- **Trustless verification** — the contract checks the proof, no organiser
  involvement needed at claim time.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Off-chain                                                           │
│                                                                      │
│  ┌──────────────┐   CSV    ┌─────────────────────────────────────┐  │
│  │  Airdrop list│ ──────► │  TypeScript SDK / CLI (generate)    │  │
│  │  (addr,amt)  │          │  • builds Merkle tree               │  │
│  └──────────────┘          │  • outputs merkle-tree.json         │  │
│                             │    { root, proofs[] }              │  │
│                             └──────────┬────────────────────────┘  │
│                                        │ root                       │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────┐
                    │  Stellar / Soroban                          │
                    │                                             │
                    │  ┌───────────────────────────────────────┐  │
                    │  │  AirdropContract (WASM)               │  │
                    │  │                                       │  │
                    │  │  initialize(admin, token,             │  │
                    │  │            merkle_root,               │  │
                    │  │            total_amount,              │  │
                    │  │            expiration)                │  │
                    │  │                                       │  │
                    │  │  claim(claimant, amount, proof)       │  │
                    │  │  set_active(active)                   │  │
                    │  │  reclaim()                            │  │
                    │  │  restore()                            │  │
                    │  │                                       │  │
                    │  │  queries: merkle_root, is_claimed,    │  │
                    │  │          is_active, token, admin,     │  │
                    │  │          total_deposited, expiration  │  │
                    │  └───────────────────────────────────────┘  │
                    │              │            │                  │
                    │   ┌──────────┘            └──────────┐      │
                    │   ▼                                   ▼      │
                    │  SEP-41 Token Contract         Claimant      │
                    │  (holds deposited tokens)      (receives)    │
                    └─────────────────────────────────────────────┘
                                         ▲
                    ┌────────────────────┴────────────────────────┐
                    │  Clients                                     │
                    │                                             │
                    │  ┌──────────────┐   ┌────────────────────┐  │
                    │  │  TypeScript  │   │  Next.js Web UI    │  │
                    │  │  SDK         │   │  (claim frontend)  │  │
                    │  └──────────────┘   └────────────────────┘  │
                    │  ┌──────────────────────────────────────┐   │
                    │  │  CLI  (generate / claim / status)    │   │
                    │  └──────────────────────────────────────┘   │
                    └─────────────────────────────────────────────┘
```

---

## Contract Storage Layout

All storage uses `DataKey` variants defined in `contracts/airdrop/src/types.rs`.

| Key | Storage type | Value type | Description |
|-----|-------------|------------|-------------|
| `DataKey::MerkleRoot` | Instance | `BytesN<32>` | Merkle root of the distribution tree |
| `DataKey::TokenAddress` | Instance | `Address` | SEP-41 token contract being distributed |
| `DataKey::Admin` | Instance | `Address` | Controls pause / reclaim |
| `DataKey::TotalDeposited` | Instance | `i128` | Tokens deposited at initialisation |
| `DataKey::Active` | Instance | `bool` | Whether claims are currently accepted |
| `DataKey::Expiration` | Instance | `u64` | Unix timestamp after which reclaim is permitted |
| `DataKey::Claimed(addr)` | Persistent | `bool` | Set to `true` once `addr` has claimed |

Instance entries share one TTL (~2 years / 12 614 400 ledgers). Every
read-query and the `restore()` helper re-extends this TTL so dormant airdrops
are not archived. Per-claimant `Claimed` entries are extended individually at
claim time with the same TTL.

---

## Merkle Algorithm

### Leaf hash

A leaf encodes one `(address, amount)` allocation:

```
leaf = SHA-256( SHA-256(strkey_utf8_bytes(address)) ++ amount_be16 )
```

Step by step:

1. Convert the claimant `Address` to its Stellar strkey string
   (e.g. `GABC…` for accounts, `CABC…` for contracts).
2. Take the **UTF-8 bytes** of that string.
3. Hash with **SHA-256** → 32-byte `addr_hash`.
4. Encode `amount` as a **16-byte big-endian** `i128`.
5. Concatenate `addr_hash ++ amount_be16` (48 bytes total).
6. Hash with **SHA-256** → 32-byte leaf.

The double-hash is required because Soroban's `Address` type does not expose
raw public-key bytes inside contract code. Hashing the strkey UTF-8 string is
the stable, canonical substitute. Both the Rust contract (`merkle.rs`) and the
TypeScript SDK (`sdk/src/merkle.ts`) must implement this identically.

### Node hash

Interior nodes are combined with the two children **sorted lexicographically**
before hashing:

```
node = SHA-256( min(left, right) ++ max(left, right) )
```

Sorting makes the tree **position-independent**: the same distribution produces
the same root regardless of the order the leaves were inserted.

### Proof structure

A proof is an ordered list of sibling hashes from the leaf up to (but not
including) the root. Verification recomputes the root by repeatedly applying
the node-hash formula and comparing the final value to the stored root.

---

## Data Flow

### Organiser — setup

```
1. Build list: [ (address₁, amount₁), (address₂, amount₂), … ]
2. CLI/SDK: generate Merkle tree → { root: bytes32, proofs: { addr → proof[] } }
3. Deploy AirdropContract WASM to Stellar
4. Call initialize(admin, token, root, total_amount, expiration)
   └─ contract pulls total_amount tokens from admin via SEP-41 transfer_from
5. Distribute merkle-tree.json to recipients (IPFS, website, etc.)
```

### Recipient — claim

```
1. Recipient looks up their proof in merkle-tree.json
2. Call claim(claimant, amount, proof)
   ├─ claimant.require_auth()         — wallet signs the transaction
   ├─ check Active flag
   ├─ check amount > 0
   ├─ check Claimed(claimant) not set
   ├─ recompute leaf = leaf_hash(claimant, amount)
   ├─ verify_proof(root, leaf, proof) — walk proof, recompute root
   ├─ set Claimed(claimant) = true    — re-entrancy guard before transfer
   └─ SEP-41 transfer(contract → claimant, amount)
```

### Organiser — reclaim (after expiration)

```
1. After ledger timestamp ≥ expiration:
2. Call reclaim()
   ├─ admin.require_auth()
   ├─ check timestamp ≥ expiration
   └─ SEP-41 transfer(contract → admin, remaining_balance)
```
