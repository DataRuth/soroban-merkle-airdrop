# Fuzzing the Merkle proof verifier

This document explains how to run the `verify_proof` fuzz target that exercises
`merkle::verify_proof` in the Soroban airdrop contract.

## Background

`contracts/airdrop/src/merkle.rs` implements SHA-256 Merkle proof verification.
The deterministic tests in `test.rs` cover known-good and known-bad proofs, but
they cannot exhaustively explore edge cases such as:

- Empty proof vectors
- Single-node trees (leaf == root)
- Proofs that are one element too long or too short
- All-zero or all-max-byte inputs
- Random sibling hashes that happen to collide with valid intermediate nodes

The fuzz target generates random inputs and asserts that `verify_proof` never
panics and upholds two key invariants.

## Prerequisites

Fuzzing with `cargo-fuzz` requires the **nightly** Rust toolchain and a
Linux or macOS host (libFuzzer is not available on Windows).

```bash
# Install nightly toolchain
rustup toolchain install nightly

# Install cargo-fuzz
cargo +nightly install cargo-fuzz
```

## Directory layout

```
fuzz/
├── Cargo.toml                  # Fuzz workspace — separate from the main workspace
└── fuzz_targets/
    └── verify_proof.rs         # Fuzz target for merkle::verify_proof
```

The fuzz crate lives outside the main Cargo workspace so it can use nightly-only
features without affecting the production build.

## Running the fuzzer

```bash
# Run for 60 seconds (good for a quick sanity check)
cargo +nightly fuzz run verify_proof -- -max_total_time=60

# Run until libFuzzer decides to stop (no time limit — use Ctrl-C to stop)
cargo +nightly fuzz run verify_proof

# Run with 4 parallel jobs
cargo +nightly fuzz run verify_proof -- -workers=4 -max_total_time=300

# Reproduce a specific crash from the artifacts directory
cargo +nightly fuzz run verify_proof fuzz/artifacts/verify_proof/<crash-file>
```

## What the fuzz target checks

Given arbitrary bytes split into `root` (32 B), `leaf` (32 B), and `proof`
(N × 32 B), the target asserts:

1. **No panics** — `verify_proof` must return `true` or `false` for any input.
2. **Empty-proof identity** — when the proof is empty, the result is `true` if
   and only if `leaf == root` (the single-node tree case).
3. **Bit-flip soundness** — if a proof verifies against `root`, flipping any
   single bit in `root` must cause verification to fail. This would only be
   violated by a SHA-256 collision, which is computationally infeasible.

## Corpus and crash artifacts

libFuzzer automatically builds a corpus of interesting inputs in
`fuzz/corpus/verify_proof/`. Commits should include this corpus so future runs
start from a richer seed set.

Crash inputs that trigger assertion failures are saved to
`fuzz/artifacts/verify_proof/`. File a bug with the crash input attached.

## CI integration

The fuzzer is not run as part of the standard `ci.yml` workflow because it
requires a nightly toolchain and has non-deterministic runtime. Instead, run it
manually before merging changes to `merkle.rs`:

```bash
cargo +nightly fuzz run verify_proof -- -max_total_time=60
```

A future enhancement could add a scheduled workflow that runs fuzzing overnight
and uploads new corpus entries as a commit.
