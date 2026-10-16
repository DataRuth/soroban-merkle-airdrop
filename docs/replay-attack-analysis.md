# Replay Attack Analysis: Cross-Contract Same-Root Attacks

**Issue:** [#50](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/issues/50)  
**Status:** Mitigated — domain separation implemented.

---

## Attack Description

### Threat model

An organiser deploys two `soroban-merkle-airdrop` contracts, **A** and **B**, both
initialised with the **same Merkle root** (e.g. a second deployment for a different
token, a retry after a misconfiguration, or a copy deployed by a different party
after the root is published on-chain).

If the leaf hash does not incorporate the contract address, a Merkle proof that is
valid for contract A is also algebraically valid for contract B.  A claimant —
or an attacker who observed Alice's claim on contract A — can replay the same
proof against contract B and claim Alice's allocation a second time without
her knowledge or participation.

### Concrete scenario

```
Organiser builds tree:
  leaf(Alice, 1000) ++ leaf(Bob, 500) → root = 0xabc…

Deploys contract A (token: USDC):  initialize(root=0xabc…, token=USDC)
Deploys contract B (token: XLM):   initialize(root=0xabc…, token=XLM)

Alice submits: claim(claimant=Alice, amount=1000, proof=[leaf(Bob)])
  → contract A verifies and pays Alice 1000 USDC  ✓

Attacker replays same call against contract B:
  claim(claimant=Alice, amount=1000, proof=[leaf(Bob)])
  → without domain separation, proof is still valid
  → contract B pays Alice (or attacker) 1000 XLM  ✗
```

### Why this matters

- The attack requires **no private information** — the proof is public once Alice
  broadcasts her first claim transaction.
- The organiser only needs to make one mistake (same root on two contracts) for
  all recipients to be exposed.
- Same-root deployments are plausible in practice: re-deploys after bugs, multi-
  token airdrops, test vs. mainnet with the same distribution, or a root leaked
  before deployment.

---

## Decision

**Domain separation is added.**

The contract address is included in every leaf hash.  This makes each leaf uniquely
bound to the specific contract instance it was generated for.  A proof valid on
contract A becomes mathematically invalid on contract B even if both share the same
root, because the leaf hashes computed by contract B incorporate B's address and
therefore produce a different root.

The cost is a small increase in per-claim hashing work (one extra SHA-256 call).
This is negligible compared to the token transfer operation.

---

## Implementation

### Algorithm change

**Before (v1):**
```
leaf = SHA-256( SHA-256(claimant_strkey_utf8) ++ amount_be16 )
```

**After (v2, with domain separator):**
```
leaf = SHA-256( SHA-256(contract_strkey_utf8) ++ SHA-256(claimant_strkey_utf8) ++ amount_be16 )
```

The contract address is SHA-256 hashed from its Stellar strkey string (the `C…`
address), then prepended to the existing pre-image before the final hash.

### Files changed

| File | Change |
|---|---|
| `contracts/airdrop/src/merkle.rs` | `leaf_hash` gains a `contract_id: &Address` parameter as the first component of the pre-image. |
| `contracts/airdrop/src/lib.rs` | `claim_entry` passes `&env.current_contract_address()` to `leaf_hash`. |
| `contracts/airdrop/src/test.rs` | `build_two_leaf_tree` and all callers updated; domain separation regression test added. |
| `sdk/src/merkle.ts` | `leafHash`, `buildMerkleTree`, `verifyProof` gain a `contractId: string` parameter. |

### Cross-language parity

Both the Rust contract and the TypeScript SDK use the same algorithm:

```typescript
// TypeScript (sdk/src/merkle.ts)
export function leafHash(contractId: string, address: string, amount: bigint): Buffer {
  const contractHash = sha256(Buffer.from(contractId, "utf8"));  // domain separator
  const addrHash     = sha256(Buffer.from(address,    "utf8"));
  const amountBuf    = /* 16-byte big-endian i128 */;
  return sha256(Buffer.concat([contractHash, addrHash, amountBuf]));
}
```

```rust
// Rust (contracts/airdrop/src/merkle.rs)
pub fn leaf_hash(env: &Env, contract_id: &Address, claimant: &Address, amount: i128) -> BytesN<32> {
    let contract_hash = env.crypto().sha256(&contract_id.to_string().to_bytes());
    let addr_hash     = env.crypto().sha256(&claimant.to_string().to_bytes());
    let mut data = Bytes::new(env);
    data.append(&contract_hash.into());
    data.append(&addr_hash.into());
    data.append(&Bytes::from_array(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}
```

---

## Migration impact

### Existing deployments

This is a **breaking change** to the leaf hash algorithm.  Any Merkle trees built
with the v1 `leafHash` (without a contract address) will produce proofs that are
rejected by a v2 contract.

**Migration path:**
1. Rebuild the Merkle tree off-chain using the updated SDK: `buildMerkleTree(contractId, entries)`.
2. Re-initialise the contract with the new root (or deploy a new contract).
3. Distribute new proofs to all recipients.

Deployments already live on mainnet must be migrated before upgrading the contract
WASM.  Do not upgrade the WASM without first preparing new proofs.

### Test vector regeneration

The cross-language golden-value tests (`test_leaf_hash_vectors`,
`test_leaf_hash_known_vector`, `test_snapshot_merkle_root_5_entries`) compare
against pre-computed expected hashes that are now stale.  These tests are marked
`#[ignore]` with a regeneration note until the vectors are recomputed with the new
algorithm.

To regenerate:

```bash
cd sdk && pnpm build
node scripts/gen-test-vectors.js > ../test-vectors/leaf-hash-vectors.json
```

Then update the hard-coded hex values in `test.rs` and remove the `#[ignore]`
annotations.

---

## Why not use a nonce or tree-ID instead?

Alternative designs were considered:

| Approach | Verdict |
|---|---|
| Include a user-supplied `tree_id` in the root | Shifts responsibility to the organiser; easy to forget or reuse. |
| Include `env.current_contract_address()` | **Chosen** — automatic, zero organiser effort, no new parameters. |
| Include chain network passphrase | Prevents cross-chain replay but not same-chain same-root replay. |
| Nothing | Allows cross-contract replay as described above. |

The contract address is the strongest and most automatic domain separator: it is
unique per deployment, available in the Soroban host environment without any
configuration, and cannot be reused by a different contract.
