# Code Coverage Baseline — Rust Contract

> **Tracking issue:** #52 — Add cargo-tarpaulin code coverage reporting

## How coverage is measured

Coverage is collected by [cargo-tarpaulin](https://github.com/xd009642/tarpaulin)
(v0.31.2) running against the `rlib` crate type in `contracts/airdrop/Cargo.toml`.

The WASM (`cdylib`) target is excluded because it cannot be instrumented for
coverage on a native host — tarpaulin automatically falls back to the `rlib`
target when both types are present.

The coverage step is added to the **Contract (Rust)** CI job
(`.github/workflows/ci.yml`) and runs on every push and pull-request targeting
`main`.

### Output artefacts

| Format   | Description                              |
|----------|------------------------------------------|
| XML      | Cobertura-compatible (`coverage/cobertura.xml`) — for future Codecov/Coveralls integration |
| HTML     | Human-readable line-by-line report (`coverage/tarpaulin-report.html`) |

Both files are uploaded as the **`coverage-report`** CI artifact (available on
the Actions run summary page under "Artifacts").

---

## Policy

> **CI does NOT fail on low coverage.**
>
> The coverage step uses `continue-on-error: true` and is purely informational
> at this stage. A minimum-coverage gate can be enforced in a follow-up issue
> once the baseline is stable.

---

## Baseline (established 2026-09-25)

Coverage was measured from the test suite as it existed when this issue was
closed. The numbers below are **estimates** — authoritative numbers will appear
in the first CI artefact produced after this branch is merged.

### Source files in scope

| File                           | Lines (approx.) | Description                                 |
|--------------------------------|-----------------|---------------------------------------------|
| `contracts/airdrop/src/lib.rs` | 627             | Contract entry-points and `claim_entry` helper |
| `contracts/airdrop/src/merkle.rs` | 93           | `leaf_hash`, `verify_proof`, `hash_pair`    |
| `contracts/airdrop/src/types.rs`  | 55           | `DataKey`, `AirdropError`, `AirdropEntry`   |

`test.rs` is excluded from coverage measurement (test code is not production
code).

### Test suite at baseline

| Metric             | Value |
|--------------------|-------|
| Test functions     | 42    |
| Test file (lines)  | 1 268 |

### Functions covered by the test suite

The 42 test functions exercise the following public contract interface:

| Contract function        | Test coverage                                          |
|--------------------------|--------------------------------------------------------|
| `initialize`             | ✅ success, double-init, negative amount, zero amount  |
| `claim`                  | ✅ success, double-claim, invalid proof, wrong amount  |
| `claim_for`              | ✅ success, double-claim, invalid proof, claim→claim_for |
| `batch_claim`            | ✅ (via `claim_entry` shared path)                     |
| `set_active` (pause)     | ✅ pause, unpause, uninitialised guard, non-admin auth  |
| `reclaim`                | ✅ success after expiry, before-expiry guard, non-admin |
| `transfer_admin`         | ✅ success, uninitialised, non-admin auth, new admin acts |
| `update_merkle_root`     | indirectly via state-machine paths                     |
| `upgrade`                | not directly tested (host-level call, tested off-chain)|
| `restore`                | ✅ TTL extended, no auth required                      |
| `merkle_root` (query)    | ✅ return value + TTL refresh                          |
| `is_claimed` (query)     | ✅ return value + TTL refresh + persistent TTL refresh |
| `is_active` (query)      | ✅ return value + TTL refresh                          |
| `token` (query)          | ✅ return value + TTL refresh                          |
| `admin` (query)          | ✅ return value + TTL refresh                          |
| `total_deposited` (query)| ✅ return value + TTL refresh                          |
| `expiration` (query)     | ✅ return value + TTL refresh                          |
| `merkle::leaf_hash`      | ✅ 42-vector cross-language test suite, known vector   |
| `merkle::verify_proof`   | ✅ empty proof, length-1, too-long, all-same-hash      |

### Estimated line coverage

Based on manual inspection of the test suite against the source:

| Module      | Estimated coverage |
|-------------|-------------------|
| `lib.rs`    | ~90 %             |
| `merkle.rs` | ~100 %            |
| `types.rs`  | ~70 % (error variants all constructed; some `contracttype` derive paths untested) |
| **Overall** | **~88–92 %** (estimated) |

> **Note:** The exact numbers from tarpaulin may differ because the Soroban
> test harness runs in a simulated host environment. Lines inside
> `#[contractimpl]` that are never reached during the test run (e.g. the
> `upgrade` WASM-swap path) will show as uncovered.

---

## Paths known to be uncovered at baseline

| Code path | Reason not covered |
|-----------|-------------------|
| `AirdropContract::upgrade` body | Requires uploading a second WASM binary; not feasible in unit tests |
| `AirdropContract::batch_claim` with mismatched vector lengths | Auth loop does not reach `InvalidProof` on length mismatch — a dedicated test would be trivial to add |
| `AirdropContract::update_merkle_root` top-up branch (`new_total > current_total`) | Not yet tested in isolation |

---

## Next steps

1. Merge this PR so the first real artefact is produced and exact numbers are
   known.
2. Add a Codecov or Coveralls integration step to post coverage percentages
   directly on pull-requests.
3. Once a stable baseline is confirmed, optionally enforce a minimum gate
   (e.g. `--fail-under 85`) and remove `continue-on-error: true`.
4. Add targeted tests for the known-uncovered paths listed above.
