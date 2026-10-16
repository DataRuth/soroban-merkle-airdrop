# Threat Model

A structured description of what `contracts/airdrop` is expected to protect,
against whom, and which parts of that expectation are actually enforced by
code. Written against `main` at the time of writing; file and line references
point at `contracts/airdrop/src/`.

For vulnerability reporting, see [`SECURITY.md`](../SECURITY.md). This document
describes the design, not a promise that the design is implemented correctly —
where the code does not enforce something, that is called out explicitly.

## Scope

In scope — `contracts/airdrop`:

| File | Responsibility |
|---|---|
| `lib.rs` | State transitions: `initialize`, `claim`, `set_active`, `reclaim`, `restore`, read-only queries |
| `merkle.rs` | Leaf encoding and proof verification |
| `types.rs` | Storage keys and the typed error enum |

Out of scope, and not analysed here: the SEP-41 token implementation, the
TypeScript SDK and CLI, the web frontend, the operator's machine (private key
handling, CSV input), the Stellar network itself, and Soroban's host
implementation.

## Assets

1. **The deposited tokens**, up to `total_amount`, held by the contract's
   address until claimed or reclaimed.
2. **Distribution integrity** — only addresses present in the tree, and only
   for the amount committed for them, can cause a transfer.
3. **Availability of claims** between `initialize` and `reclaim`.
4. **Admin authority** — the ability to pause and to reclaim the remainder,
   and nothing beyond that.

## Trust assumptions

These are assumptions, not verified properties. Each one, if false, invalidates
part of the analysis below.

- **Admin key custody.** The admin is a single Stellar account controlled by
  the organiser; the contract has no multisig, timelock, or recovery path of
  its own. A compromised admin key is a complete compromise of the admin role
  described in "Rogue or compromised admin" below.
- **Off-chain tree generation is correct.** The contract never sees the
  `(address, amount)` list — only the root (`lib.rs:107`). It cannot verify
  that the committed root corresponds to any particular list, nor that the
  amounts sum to `total_amount`. Correctness of the tree, and of the published
  proofs, rests on the SDK (`merkle.rs:19-23` documents the exact encoding the
  SDK must reproduce).
- **The token contract behaves like a standard SEP-41 token.** `claim` and
  `reclaim` rely on `transfer` either moving exactly the requested amount or
  failing the call (`lib.rs:195`, `lib.rs:278`). A token that reports success
  while moving fewer tokens is outside the threat model, as is one that
  re-enters the airdrop during `transfer` in ways a normal SEP-41 token cannot.
- **`require_auth` and SHA-256 come from the host.** `env.crypto().sha256`
  (`merkle.rs:44`, `merkle.rs:54`, `merkle.rs:92`) and address auth
  (`lib.rs:97`, `lib.rs:141`, `lib.rs:222`, `lib.rs:257`) are assumed to behave
  per the Soroban specification.
- **The ledger timestamp is a usable clock.** `expiration` is compared against
  `env.ledger().timestamp()` (`lib.rs:265`). Validators control this value
  within normal protocol bounds; it is not a precise wall clock.

## Adversaries

| Adversary | Goal | Where it is handled |
|---|---|---|
| Unlisted address | Claim tokens it is not entitled to | Merkle proof forgery resistance |
| Listed claimant | Claim more than its allocation, or claim twice | Double-claim protection, amount binding |
| Third party (bot, front-runner) | Steal a claim, or block someone else's | Front-running and proof theft |
| Rogue or compromised admin | Redirect funds, censor claims | Admin privilege analysis |
| Anyone | Make the contract unusable (griefing) | Availability / archival |

## 1. Merkle proof forgery resistance

The leaf binds both the claimant and the amount:

```
leaf = SHA-256( SHA-256(strkey_utf8_bytes(address)) ++ amount_be16 )   // merkle.rs:40-55
node = SHA-256( min(a,b) ++ max(a,b) )                                 // merkle.rs:79-93
```

- **The amount is part of the leaf preimage**, hashed as 16-byte big-endian
  (`merkle.rs:50`). A proof that shows "address X is entitled to 100" cannot be
  replayed as "address X is entitled to 1000": the leaf the contract recomputes
  for the second claim (`lib.rs:175`) is a different hash, so the walk to the
  stored root fails. Covered by `test_wrong_amount_fails`.
- **Leaf and interior-node preimages have different lengths** — 48 bytes
  (32-byte address hash + 16-byte amount) versus 64 bytes (two 32-byte
  digests). A 32-byte digest can therefore never be reinterpreted as a leaf
  being presented for a different purpose, and vice versa.
- **Sorted pairs make the tree position-independent** (`merkle.rs:83`). A
  claimant does not need to know whether their sibling is a left or right
  child; a proof is just the path from leaf upward (`lib.rs` calls
  `verify_proof`, `merkle.rs:63-76`). This is the convention the SDK tree
  builder uses; the cost is that ordering information is not committed, which
  is irrelevant here because the leaf itself carries the identity and amount.
- **The root is immutable after `initialize`.** There is no setter, and
  re-initialisation is rejected while the root is present (`lib.rs:90`,
  `test_double_initialize_fails`). An attacker therefore cannot swap the tree
  under a live airdrop.
- **The address is hashed as its strkey string, not as decoded bytes**
  (`merkle.rs:42-44`). This is a cross-component contract rather than a
  security boundary: if the SDK hashes raw decoded key bytes instead, every
  legitimate proof fails and the airdrop is unusable — a liveness failure, not
  a theft vector. `test_leaf_hash_known_vector` pins the encoding.

## 2. Double claiming

- `DataKey::Claimed(claimant)` is written **before** the token transfer
  (`lib.rs:182`), and checked at the start of every claim (`lib.rs:164`) —
  check-effects-interactions ordering, so a re-entrant token cannot squeeze two
  transfers out of one proof.
- A second claim returns `AirdropError::AlreadyClaimed` (`types.rs:31`,
  `test_double_claim_fails`).
- **Claimed markers live in persistent storage with their own TTL**
  (`CLAIMED_TTL`, `lib.rs:55`), extended at claim time (`lib.rs:183-187`),
  roughly two years of ledgers. Storage archival preserves entry *content* —
  restoring an archived entry brings the same value back — so the assumption
  this protection rests on is: **a restored `Claimed` entry still reads
  `true`**. That behaviour should be confirmed against testnet before any
  mainnet deployment; it is asserted here on the basis of the storage model,
  not measured. If the marker were lost, a claimant could take a second
  allocation out of the remaining balance.

## 3. Reentrancy analysis

There is exactly one external contract call in this contract: the SEP-41
`transfer`, in `claim` (`lib.rs:195`) and in `reclaim` (`lib.rs:278`).

- In `claim`, all state that must not be observed twice (`Claimed`, and the
  TTL extension) is written before the transfer (`lib.rs:181-187`), so a
  re-entrant `claim` for the same claimant hits `AlreadyClaimed` rather than
  paying out twice.
- In `reclaim`, the balance is read and then transferred, with no state written
  in between (`lib.rs:274-279`). Re-entering `reclaim` during that transfer
  would see the same (still un-debited, because the token call is in flight)
  balance and could request a second transfer; the contract has no reentrancy
  guard of its own. What bounds the loss is the token: a conforming SEP-41
  token debits before returning, so the second call transfers the remainder
  that is actually left, not the balance that was read first. A token that
  allows observing stale balance mid-call is outside the trust model stated
  above, and the admin could then only send the contract's own tokens to
  itself, not to a third party.
- No function in this contract calls back into itself, and there is no upgrade
  entry point (`update_current_contract_wasm` is not implemented), so the
  code cannot change under an in-flight claim.

## 4. Front-running and proof theft

- Proofs are public by construction: the operator publishes them, and a claim
  transaction carries the proof in the clear.
- **A third party cannot use someone else's proof.** `claim` calls
  `claimant.require_auth()` (`lib.rs:141`), the claimant address is baked into
  the leaf (`merkle.rs:42`), and the transfer goes to that same address
  (`lib.rs:197`). Copying a pending claim transaction gains nothing without the
  claimant's signature, and re-broadcasting it with a substituted recipient
  invalidates the proof.
- **Griefing is limited to forcing a claim to happen.** An attacker who holds a
  proof can submit the claim themselves *if* they also control the claimant's
  key — that is simply the claimant claiming. There is no per-claim nonce, no
  gas donation vector, and no way to make a claim fail for others.
- **The real front-running pressure is off-chain**: whoever learns the address
  list before `initialize` can study it, but every entry is fixed by the root,
  so knowledge does not translate into a better claim.
- **There is no claim deadline.** Claims work until the admin calls `reclaim`
  after `expiration` (`lib.rs:265`), so the practical end of the claim window
  is an admin action, not a fixed timestamp. Recipients should be told this
  explicitly — "claim before <expiration>; after that the organiser may pull
  the remainder back".

## 5. Rogue or compromised admin

What the admin **can** do:

| Power | Where | Effect |
|---|---|---|
| Pause and unpause | `set_active` (`lib.rs:216-231`) | Claims fail with `NotActive` while paused (`lib.rs:154`, `test_pause_and_unpause`) |
| Reclaim the remainder | `reclaim` (`lib.rs:251-285`) | After `expiration`, transfers the contract's whole token balance to the admin (`test_reclaim_unclaimed_tokens`, `test_reclaim_before_expiration_fails`) |

What the admin **cannot** do:

- Change the root, the token address, or `total_amount` after `initialize` —
  there is no setter for any of them.
- Reach tokens that claimants have already claimed; `reclaim` sends only what
  is left in the contract.
- Re-initialise the contract with a fresh root after reclaiming: `reclaim` does
  not clear `MerkleRoot`, so the `AlreadyInitialized` guard (`lib.rs:90`, and
  the check in `reclaim`/`claim` via `NotInitialized` on missing keys) still
  holds.
- Upgrade the contract — no `update_current_contract_wasm` entry point exists.

Worst case with a stolen admin key: **claims can be frozen indefinitely and the
unclaimed remainder can be taken**. The exposure is bounded by
`total_deposited − Σ already claimed`. Because there is no timelock or
multisig, key custody is the single most important operational control; a
hardware signer or an account with multisig signers is the mitigation, not
anything in the contract.

## 6. Availability and archival

- Every state-changing entry point extends instance TTL (`lib.rs:144`,
  `lib.rs:183`), and so does every read-only query (`lib.rs:296`, `lib.rs:307`,
  `lib.rs:320`, `lib.rs:334`, `lib.rs:345`, `lib.rs:356`, `lib.rs:370`), so
  ordinary usage keeps the instance alive. `INSTANCE_TTL` is ~2 years of
  ledgers (`lib.rs:59`).
- If nobody touches the contract for that long, the instance can archive.
  `restore()` is permissionless and exists precisely for that case
  (`lib.rs:241-245`, `test_restore_requires_no_auth`), so the failure mode is
  temporary unavailability, not loss of funds — provided the archival model
  behaves as assumed in section 2.
- A dormant airdrop with zero claims for two years is a realistic scenario for
  a badly announced airdrop; the queries extending TTL means a block explorer
  or monitoring call is enough to keep it alive.

## 7. Invariants that are not enforced on-chain

These are gaps to know about, not necessarily bugs to fix now:

1. **`expiration` is not checked against the current time.** The doc comment
   says it "must be in the future relative to deployment" (`lib.rs:80-81`), but
   `initialize` accepts any `u64` (`lib.rs:82-89`), including `0` — which makes
   the airdrop immediately reclaimable, so claimants could find the balance
   pulled back before they claim. A one-line guard (`expiration >
   env.ledger().timestamp()`) would turn an operator mistake into a rejected
   transaction.
2. **Nothing ties `total_amount` to the tree.** The contract cannot see the
   leaves, so it cannot detect a deposit smaller than the sum of allocations.
   The failure surfaces later as an insufficient-balance error from the token
   during the last claims, not as a typed `AirdropError`. An under-funded
   airdrop should be caught off-chain (the CLI or SDK can compare the deposit
   with the tree total before `initialize`).
3. **Over-funding leaves a reclaimable remainder**, which is by design, but
   worth stating in user-facing docs: the admin's post-expiration `reclaim`
   takes everything unclaimed.
4. **`initialize` deposits on behalf of whoever calls it**, not necessarily the
   admin — `admin.require_auth()` is checked (`lib.rs:97`) but the tokens come
   from the admin's account either way, so the call is effectively admin-only
   by consequence.

## 8. What the test suite covers today

25 tests in `src/test.rs` cover: successful claim, double-claim rejection,
invalid proof, wrong amount, zero and negative amounts, pause/unpause,
non-admin `set_active`/`reclaim`, reclaim before expiry, double initialisation,
negative `total_amount`, TTL extension on every query, `restore()` being
permissionless, and a pinned leaf-hash vector. Not covered: proof forgery with
a fabricated root, behaviour of a malicious SEP-41 token, archival/restore of a
`Claimed` marker, and event contents (tracked separately).

## Open questions before mainnet

1. Confirm on testnet that a restored `Claimed` entry still reads `true`
   (section 2) — this is the assumption double-claim protection rests on.
2. Decide whether to add the `expiration` sanity check (section 7.1).
3. Confirm the SDK's `leafHash()` against `test_leaf_hash_known_vector`'s
   vector for both `G...` and `C...` addresses.
4. Document the recipient-facing claim window ("until expiration, or until the
   organiser reclaims") in the README.
