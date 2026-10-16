//! Fuzz target for `merkle::verify_proof`.
//!
//! # What is fuzzed
//!
//! The fuzzer feeds arbitrary bytes to `verify_proof` as:
//!   - `root`  — 32-byte Merkle root
//!   - `leaf`  — 32-byte leaf hash
//!   - `proof` — zero or more 32-byte sibling hashes (variable length)
//!
//! # What we check
//!
//! `verify_proof` must **never panic** regardless of inputs. The function
//! returns a `bool`, so the only expected outcomes are `true` or `false`.
//!
//! We also add two higher-level soundness assertions:
//!
//! 1. **Self-consistency** – if a proof verifies against `root`, then
//!    supplying any different root byte must *not* verify (with very high
//!    probability, since SHA-256 collisions are not feasible).
//!    This property is checked by flipping the first byte of the root.
//!
//! 2. **Empty-proof identity** – when the proof is empty, `verify_proof`
//!    returns `true` if and only if `leaf == root`. This is the single-node
//!    tree invariant.
//!
//! # How to run
//!
//! ```bash
//! # One-time setup: install cargo-fuzz (requires nightly toolchain)
//! cargo +nightly install cargo-fuzz
//!
//! # Run for 60 seconds
//! cargo +nightly fuzz run verify_proof -- -max_total_time=60
//!
//! # Run until the corpus is exhausted (CI-friendly)
//! cargo +nightly fuzz run verify_proof -- -max_total_time=10
//!
//! # Reproduce a specific crash
//! cargo +nightly fuzz run verify_proof fuzz/artifacts/verify_proof/<file>
//! ```
//!
//! See `docs/fuzzing.md` for a detailed guide.

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{BytesN, Env, Vec};
// Import the contract's merkle module directly via the rlib.
use soroban_merkle_airdrop::merkle;

fuzz_target!(|data: &[u8]| {
    // Need at least 64 bytes: 32 for root + 32 for leaf.
    if data.len() < 64 {
        return;
    }

    let env = Env::default();

    // ── Parse root (bytes 0..32) ─────────────────────────────────────────
    let root_bytes: [u8; 32] = data[0..32].try_into().unwrap();
    let root: BytesN<32> = BytesN::from_array(&env, &root_bytes);

    // ── Parse leaf (bytes 32..64) ─────────────────────────────────────────
    let leaf_bytes: [u8; 32] = data[32..64].try_into().unwrap();
    let leaf: BytesN<32> = BytesN::from_array(&env, &leaf_bytes);

    // ── Parse proof: remaining bytes, in 32-byte chunks ──────────────────
    let mut proof: Vec<BytesN<32>> = Vec::new(&env);
    let proof_data = &data[64..];
    for chunk in proof_data.chunks(32) {
        if chunk.len() == 32 {
            let arr: [u8; 32] = chunk.try_into().unwrap();
            proof.push_back(BytesN::from_array(&env, &arr));
        }
    }

    // ── Core invariant: must never panic ─────────────────────────────────
    let result = merkle::verify_proof(&env, &root, leaf.clone(), &proof);

    // ── Empty-proof identity invariant ───────────────────────────────────
    // When the proof is empty, verify_proof should return true iff leaf == root.
    if proof.is_empty() {
        let expected = leaf == root;
        assert_eq!(
            result, expected,
            "empty proof: verify_proof returned {result} but leaf==root is {expected}"
        );
    }

    // ── Bit-flip soundness check ─────────────────────────────────────────
    // If the proof verified, flipping any single bit in the root must cause
    // it to fail (SHA-256 preimage resistance makes collisions negligible).
    if result {
        let mut flipped_bytes = root_bytes;
        flipped_bytes[0] ^= 0x01; // flip the LSB of the first byte
        if flipped_bytes != root_bytes {
            // Only check if the flip actually changed the root (always true
            // here, but defensive for future refactoring).
            let flipped_root: BytesN<32> = BytesN::from_array(&env, &flipped_bytes);
            let flipped_result =
                merkle::verify_proof(&env, &flipped_root, leaf.clone(), &proof);
            assert!(
                !flipped_result,
                "verify_proof returned true for a root with a flipped bit — \
                 this would indicate a hash collision or algorithmic flaw"
            );
        }
    }
});
