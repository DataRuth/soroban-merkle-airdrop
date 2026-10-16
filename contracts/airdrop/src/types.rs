//! Data types and storage keys for the Merkle airdrop contract.

use soroban_sdk::{contracterror, contracttype, Address};

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// The Merkle root (32-byte hash) of the airdrop distribution tree.
    MerkleRoot,
    /// The SEP-41 token contract address being distributed.
    TokenAddress,
    /// Admin — can initialise and optionally reclaim unclaimed tokens.
    Admin,
    /// Whether this claimant has already claimed (prevents double-claiming).
    Claimed(Address),
    /// Total tokens deposited into the contract.
    TotalDeposited,
    /// Whether the airdrop is active (admin can pause).
    Active,
    /// Unix timestamp (seconds) after which `reclaim()` is permitted.
    Expiration,
    /// Count of successful claims.
    ClaimedCount,
}

/// Errors returned by the airdrop contract.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AirdropError {
    /// Contract has already been initialised.
    AlreadyInitialized = 1,
    /// Caller has already claimed their allocation.
    AlreadyClaimed = 2,
    /// The Merkle proof supplied does not verify against the root.
    InvalidProof = 3,
    /// Contract is not currently active.
    NotActive = 4,
    /// Contract has not been initialised yet.
    NotInitialized = 5,
    /// Zero or negative amount is not valid.
    ZeroAmount = 6,
    /// `reclaim()` called before the expiration timestamp has been reached.
    NotYetExpired = 7,
    /// `initialize()` called with an expiration timestamp that is already in
    /// the past (i.e. `expiration <= env.ledger().timestamp()`).
    ExpirationInPast = 8,
}

/// A single recipient's allocation inside a batch claim.
///
/// Supplied to `AirdropContract::batch_claim` as one vector of entries plus a
/// parallel vector of Merkle proofs, so `proofs[i]` belongs to `entries[i]`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AirdropEntry {
    /// Address receiving the tokens; must authorise the batch claim.
    pub claimant: Address,
    /// Tokens allocated to this claimant in the distribution tree.
    pub amount: i128,
}
