//! Data types and storage keys for the Merkle airdrop contract.

use soroban_sdk::{contracttype, contracterror, Address};


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
}
