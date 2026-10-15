//! soroban-merkle-airdrop
//!
//! Gas-efficient token distribution using Merkle proofs on Stellar.
//!
//! Instead of batch-transferring tokens to thousands of addresses up-front,
//! this contract stores only a single 32-byte Merkle root on-chain. Recipients
//! prove their inclusion by supplying a Merkle proof and claiming their tokens
//! themselves — paying only for their own transaction.
//!
//! # Flow
//!
//! 1. **Organiser** builds a Merkle tree off-chain from a list of
//!    `(address, amount)` pairs using the TypeScript SDK.
//! 2. **Organiser** deploys this contract and calls `initialize` with the
//!    Merkle root, the SEP-41 token address, the total supply, and an
//!    expiration timestamp.
//! 3. **Recipients** call `claim` with their amount and Merkle proof.
//!    The contract verifies the proof, marks the address as claimed, and
//!    transfers the tokens.
//! 4. After `expiration`, the admin may call `reclaim()` to recover any
//!    unclaimed tokens.
//!
//! # Storage layout
//!
//! - `DataKey::MerkleRoot`          → `BytesN<32>`  (instance)
//! - `DataKey::TokenAddress`        → `Address`     (instance)
//! - `DataKey::Admin`               → `Address`     (instance)
//! - `DataKey::TotalDeposited`      → `i128`        (instance)
//! - `DataKey::Active`              → `bool`        (instance)
//! - `DataKey::Expiration`          → `u64`         (instance)
//! - `DataKey::ClaimedCount`          → `u32`           (instance)
//! - `DataKey::Claimed(addr)`       → `bool`        (persistent, per claimant)

#![no_std]

mod merkle;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contractmeta, symbol_short, token::Client as TokenClient, Address,
    BytesN, Env, Vec,
};
use types::{AirdropEntry, AirdropError, DataKey};

contractmeta!(
    key = "Description",
    val = "Merkle tree airdrop contract for gas-efficient token distribution on Stellar"
);
contractmeta!(key = "Version", val = "0.1.0");

/// Default TTL for per-claimant `Claimed` entries — ~2 years of ledgers.
///
/// Ledger calculation: Stellar produces approximately 1 ledger every 5 seconds.
/// 12_614_400 ledgers × 5 s/ledger = 63_072_000 s ≈ 2 years.
/// Configurable via the `claimed_ttl` parameter in `initialize()`.
const CLAIMED_TTL: u32 = 12_614_400;
const CLAIMED_TTL_THRESHOLD: u32 = CLAIMED_TTL / 2;

/// Default TTL for instance storage — ~2 years of ledgers (same magnitude as CLAIMED_TTL).
///
/// Ledger calculation: 12_614_400 ledgers × 5 s/ledger = 63_072_000 s ≈ 2 years.
/// Configurable via the `instance_ttl` parameter in `initialize()`.
const INSTANCE_TTL: u32 = 12_614_400;
const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_TTL / 2;

#[contract]
pub struct AirdropContract;

// `Events::publish` is deprecated in soroban-sdk 27 in favour of the
// `#[contractevent]` macro. The macro derives the first topic from the event
// struct's name, so switching would rename every topic this contract emits
// ("init", "claimed", "paused", "reclaimed") and break indexers and the event
// assertions in `src/test.rs`. That is an ABI change, not a lint fix, so the
// deprecation is allowed here until it is done deliberately.
#[allow(deprecated)]
#[contractimpl]
impl AirdropContract {
    // ─── Initialisation ──────────────────────────────────────────────────────

    /// Initialise the airdrop.
    ///
    /// Must be called once before any claims. The caller deposits `total_amount`
    /// tokens from the SEP-41 token contract into this contract.
    ///
    /// # Arguments
    ///
    /// * `admin`        - Address that controls the airdrop (can pause/reclaim).
    /// * `token`        - SEP-41 token contract address to distribute.
    /// * `merkle_root`  - 32-byte Merkle root of the (address, amount) tree.
    /// * `total_amount` - Total tokens to be distributed; transferred from admin.
    /// * `expiration`   - Unix timestamp (seconds) after which `reclaim()` is
    ///                    permitted. Must be in the future relative to deployment.
    /// * `claimed_ttl`  - Optional TTL (ledgers) for per-claimant `Claimed` entries.
    ///                    Defaults to [`CLAIMED_TTL`] (~2 years) when `None`.
    ///                    Ledger ≈ 5 s; 12_614_400 × 5 s ≈ 2 years.
    /// * `instance_ttl` - Optional TTL (ledgers) for instance storage.
    ///                    Defaults to [`INSTANCE_TTL`] (~2 years) when `None`.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        merkle_root: BytesN<32>,
        total_amount: i128,
        expiration: u64,
        claimed_ttl: Option<u32>,
        instance_ttl: Option<u32>,
    ) -> Result<(), AirdropError> {
        if env.storage().instance().has(&DataKey::MerkleRoot) {
            return Err(AirdropError::AlreadyInitialized);
        }
        if total_amount <= 0 {
            return Err(AirdropError::ZeroAmount);
        }
        if expiration <= env.ledger().timestamp() {
            return Err(AirdropError::ExpirationInPast);
        }

        admin.require_auth();

        // Resolve TTLs — use caller-supplied values or fall back to defaults.
        let c_ttl = claimed_ttl.unwrap_or(CLAIMED_TTL);
        let i_ttl = instance_ttl.unwrap_or(INSTANCE_TTL);

        // Transfer tokens from admin into the contract.
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&admin, env.current_contract_address(), &total_amount);

        env.storage()
            .instance()
            .set(&DataKey::MerkleRoot, &merkle_root);
        env.storage().instance().set(&DataKey::TokenAddress, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposited, &total_amount);
        env.storage().instance().set(&DataKey::Active, &true);
        env.storage()
            .instance()
            .set(&DataKey::Expiration, &expiration);
        env.storage().instance().set(&DataKey::ClaimedTtl, &c_ttl);
        env.storage().instance().set(&DataKey::InstanceTtl, &i_ttl);

        env.events()
            .publish((symbol_short!("init"), admin), (merkle_root, total_amount));

        Ok(())
    }

    // ─── Claim ───────────────────────────────────────────────────────────────

    /// Claim tokens from the airdrop.
    ///
    /// The claimant provides their allocation `amount` and a Merkle `proof`
    /// demonstrating they are in the distribution tree. Tokens are transferred
    /// immediately on success.
    ///
    /// # Expiration and claim deadline
    ///
    /// This contract has **no claim deadline**. The `expiration` field is a
    /// gate for `reclaim()` only — it lets the admin recover unclaimed tokens
    /// after the distribution window closes. Claims remain valid at any
    /// ledger timestamp, including timestamps past the expiration, as long as
    /// the contract still holds tokens.
    ///
    /// Once the admin calls `reclaim()` after expiry the contract balance
    /// becomes zero. Any subsequent `claim` will panic when the underlying
    /// SEP-41 token contract rejects the transfer due to insufficient balance.
    ///
    /// # Arguments
    ///
    /// * `claimant` - Address claiming tokens (must sign the transaction).
    /// * `amount`   - Token amount allocated to this claimant.
    /// * `proof`    - Ordered list of sibling hashes from leaf to root.
    pub fn claim(
        env: Env,
        claimant: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) -> Result<(), AirdropError> {
        claimant.require_auth();
        claim_entry(&env, &claimant, amount, &proof)
    }

    /// Claim on behalf of several recipients in a single transaction.
    ///
    /// `entries` and `proofs` are parallel vectors: `proofs[i]` must prove the
    /// inclusion of `entries[i]`. Each claimant authorises the call, exactly as
    /// with [`Self::claim`].
    ///
    /// The batch is all-or-nothing. The first entry that fails — bad proof,
    /// wrong amount, already claimed, airdrop paused — aborts the invocation and
    /// every claim in it is rolled back, so a partially paid batch cannot happen.
    /// Successful entries emit the same `claimed` event as a single claim.
    ///
    /// An empty batch is a no-op.
    pub fn batch_claim(
        env: Env,
        entries: Vec<AirdropEntry>,
        proofs: Vec<Vec<BytesN<32>>>,
    ) -> Result<(), AirdropError> {
        // Without one proof per entry there is nothing to verify against.
        if entries.len() != proofs.len() {
            return Err(AirdropError::InvalidProof);
        }

        // Authorise every claimant before touching balances: an unsigned entry
        // must stop the call up front, not after other people were already paid.
        //
        // A claimant repeated in the batch is authorised once — the host rejects
        // a second `require_auth` for the same address inside one invocation,
        // which would abort the transaction instead of reporting the double
        // claim. The repeat is caught by the per-claim guard below, where the
        // caller can see it.
        for i in 0..entries.len() {
            let claimant = entries.get_unchecked(i).claimant;
            let already_authorised = (0..i).any(|j| entries.get_unchecked(j).claimant == claimant);
            if !already_authorised {
                claimant.require_auth();
            }
        }

        for i in 0..entries.len() {
            let entry = entries.get_unchecked(i);
            let proof = proofs.get_unchecked(i);
            claim_entry(&env, &entry.claimant, entry.amount, &proof)?;
        }

        Ok(())
    }

    /// Claim tokens on behalf of a recipient (operator-pays model).
    ///
    /// Identical to [`Self::claim`] in every respect **except** that the
    /// claimant does **not** need to sign the transaction. Any third party —
    /// an operator, relayer, or sponsor — may submit this call and pay the
    /// network fees. Tokens are always sent to `claimant`, never to the
    /// transaction submitter.
    ///
    /// This is safe because the Merkle proof already binds the
    /// `(claimant, amount)` pair to the on-chain root — an operator cannot
    /// redirect tokens to themselves by substituting a different address.
    ///
    /// # Arguments
    ///
    /// * `claimant` - Address that will receive the tokens (does NOT sign).
    /// * `amount`   - Token amount allocated to this claimant.
    /// * `proof`    - Ordered list of sibling hashes from leaf to root.
    pub fn claim_for(
        env: Env,
        claimant: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) -> Result<(), AirdropError> {
        // NOTE: claimant.require_auth() is intentionally omitted.
        // The Merkle proof is the sole authorisation: only someone who knows
        // the correct (claimant, amount, proof) triple can trigger a claim,
        // and the tokens always land in `claimant`'s wallet.
        claim_entry(&env, &claimant, amount, &proof)
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// Pause or unpause the airdrop. Only the admin can call this.
    ///
    /// Emits an event with topic `("paused", admin)` and data `active`
    /// so off-chain indexers and monitoring tools can observe every
    /// pause/unpause transition.
    pub fn set_active(env: Env, active: bool) -> Result<(), AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Active, &active);

        env.events()
            .publish((symbol_short!("paused"), admin), active);

        Ok(())
    }

    /// Rotate the Merkle root and optionally top up the deposited amount.
    ///
    /// Replaces the on-chain Merkle root with `new_root` and sets
    /// `TotalDeposited` to `new_total`. If `new_total` exceeds the current
    /// `TotalDeposited` value the difference is transferred from the admin
    /// into the contract immediately; if it is equal or smaller no transfer
    /// is made (the organiser is responsible for ensuring the contract holds
    /// sufficient funds for all new claims).
    ///
    /// # ⚠ Warning
    ///
    /// **Existing claimed flags are NOT reset.** Any address that already
    /// claimed under the old root cannot claim again — even if they appear
    /// in the new tree with a different amount. This is intentional: it
    /// prevents double-spending when correcting errors or adding new
    /// recipients. If an already-claimed address needs a corrected allocation,
    /// deploy a separate airdrop contract for that address.
    ///
    /// # Arguments
    ///
    /// * `new_root`  - 32-byte Merkle root of the updated distribution tree.
    /// * `new_total` - New total allocation. Must be positive.
    ///
    /// Emits `("root_upd", admin)` with data `(new_root, new_total)`.
    pub fn update_merkle_root(
        env: Env,
        new_root: BytesN<32>,
        new_total: i128,
    ) -> Result<(), AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();

        if new_total <= 0 {
            return Err(AirdropError::ZeroAmount);
        }

        // Top up the contract balance if the new total exceeds the current one.
        let current_total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalDeposited)
            .unwrap_or(0);

        if new_total > current_total {
            let diff = new_total - current_total;
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::TokenAddress)
                .ok_or(AirdropError::NotInitialized)?;
            TokenClient::new(&env, &token).transfer(
                &admin,
                &env.current_contract_address(),
                &diff,
            );
        }

        env.storage()
            .instance()
            .set(&DataKey::MerkleRoot, &new_root);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposited, &new_total);

        env.events().publish(
            (symbol_short!("root_upd"), admin),
            (new_root, new_total),
        );

        Ok(())
    }

    /// Transfer admin ownership to a new address.
    ///
    /// The current admin must authorise this call. Once transferred, the new
    /// admin has full control over `set_active`, `reclaim`, and future
    /// `transfer_admin` calls.
    ///
    /// Emits an event with topic `("admin_transfer", old_admin)` and data
    /// `new_admin` so off-chain indexers can track ownership history.
    ///
    /// # Arguments
    ///
    /// * `new_admin` - Address to become the new admin.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), AirdropError> {
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        old_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("adm_xfer"), old_admin),
            new_admin,
        );

        Ok(())
    }

    /// Upgrade the contract's WASM bytecode. Admin only.
    ///
    /// Replaces the running WASM with the code identified by `new_wasm_hash`,
    /// which must already have been uploaded to the network via
    /// `stellar contract upload`.
    ///
    /// # Safety / upgrade notes
    ///
    /// - **State is preserved.** All instance and persistent storage entries
    ///   survive the upgrade — claimed entries remain claimed, the Merkle root
    ///   and token address are unchanged, and active claims continue to work.
    /// - **The upgrade is immediate.** It takes effect at the next invocation
    ///   after this transaction is applied; there is no staged upgrade or
    ///   time-lock. Consider pausing the airdrop (`set_active(false)`) before
    ///   upgrading if you want to prevent claims during the upgrade window.
    /// - **The new WASM must be compatible.** Removing or renaming storage keys
    ///   or changing the contract interface will break existing clients.
    /// - **Emit an event** so off-chain indexers and monitoring tools can detect
    ///   upgrades.
    ///
    /// # Arguments
    ///
    /// * `new_wasm_hash` - 32-byte WASM hash of the replacement bytecode.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        env.events()
            .publish((symbol_short!("upgrade"), admin), new_wasm_hash);

        Ok(())
    }

    /// Restore the contract instance from archival.
    ///
    /// Soroban's state-archival mechanism can archive instance storage once its
    /// TTL reaches zero, making the contract inaccessible. This public function
    /// lets *anyone* pay to restore the contract by extending instance TTL back
    /// to the configured `instance_ttl` ledgers — no admin authentication required.
    ///
    /// See: <https://developers.stellar.org/docs/learn/encyclopedia/storage/state-archival>
    pub fn restore(env: Env) {
        let i_ttl = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::InstanceTtl)
            .unwrap_or(INSTANCE_TTL);
        env.storage()
            .instance()
            .extend_ttl(i_ttl / 2, i_ttl);
    }

    /// Reclaim unclaimed tokens after the airdrop expires. Admin only.
    ///
    /// Can only be called once `env.ledger().timestamp() >= expiration`.
    /// Transfers the contract's remaining token balance back to the admin.
    pub fn reclaim(env: Env) -> Result<i128, AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();

        // Time-gate: reclaim is only permitted after the expiration timestamp.
        let expiration: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Expiration)
            .ok_or(AirdropError::NotInitialized)?;
        if env.ledger().timestamp() < expiration {
            return Err(AirdropError::NotYetExpired);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .unwrap();
        let token_client = TokenClient::new(&env, &token);
        let balance = token_client.balance(&env.current_contract_address());

        if balance > 0 {
            token_client.transfer(&env.current_contract_address(), &admin, &balance);
        }

        env.events()
            .publish((symbol_short!("reclaimed"), admin), balance);

        Ok(balance)
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /// Return the Merkle root stored in this contract.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn merkle_root(env: Env) -> Option<BytesN<32>> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::MerkleRoot)
    }

    /// Return `true` if `claimant` has already claimed.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    ///
    /// Issue #43: also refreshes the *persistent* `Claimed(addr)` entry TTL
    /// if the entry exists. Without this refresh, an archived `Claimed` entry
    /// causes `is_claimed()` to return `false`, which would allow a
    /// double-claim after the entry is archived.
    pub fn is_claimed(env: Env, claimant: Address) -> bool {
        extend_instance_ttl(&env);

        let key = DataKey::Claimed(claimant);
        let exists = env.storage().persistent().has(&key);

        // Refresh the persistent Claimed entry TTL so it cannot archive while
        // the airdrop is live, which would silently allow a double-claim.
        if exists {
            let c_ttl = get_claimed_ttl(&env);
            env.storage()
                .persistent()
                .extend_ttl(&key, c_ttl / 2, c_ttl);
        }

        exists
    }

    /// Return whether the airdrop is currently active.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn is_active(env: Env) -> bool {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Active)
            .unwrap_or(false)
    }

    /// Return the token contract address.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn token(env: Env) -> Option<Address> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::TokenAddress)
    }

    /// Return the admin address.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn admin(env: Env) -> Option<Address> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Return total tokens deposited at initialisation.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn total_deposited(env: Env) -> i128 {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposited)
            .unwrap_or(0)
    }

    /// Return the expiration timestamp (unix seconds) after which reclaim is allowed.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn expiration(env: Env) -> Option<u64> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Expiration)
    }

    /// Return the number of successful claims so far.
    ///
    /// Refreshes instance storage TTL so dormant airdrops with no new claims
    /// do not have their on-chain data archived.
    pub fn claimed_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
        env.storage()
            .instance()
            .get(&DataKey::ClaimedCount)
            .unwrap_or(0)
    }
}

/// Shared claim path behind [`AirdropContract::claim`] and
/// [`AirdropContract::batch_claim`].
///
/// Both entry points go through this function so the rules — airdrop active,
/// positive amount, one claim per address, valid Merkle proof, mark before
/// transfer — cannot drift apart. Returns `InvalidProof` for a proof that does
/// not verify, and the caller decides whether that aborts one claim or a whole
/// batch.
fn claim_entry(
    env: &Env,
    claimant: &Address,
    amount: i128,
    proof: &Vec<BytesN<32>>,
) -> Result<(), AirdropError> {
    // Extend instance storage TTL so core contract data doesn't expire.
    extend_instance_ttl(env);

    // Check active.
    let active: bool = env
        .storage()
        .instance()
        .get(&DataKey::Active)
        .ok_or(AirdropError::NotInitialized)?;
    if !active {
        return Err(AirdropError::NotActive);
    }

    if amount <= 0 {
        return Err(AirdropError::ZeroAmount);
    }

    // Check not already claimed.
    let claimed_key = DataKey::Claimed(claimant.clone());
    if env.storage().persistent().has(&claimed_key) {
        return Err(AirdropError::AlreadyClaimed);
    }

    // Verify Merkle proof.
    let root: BytesN<32> = env
        .storage()
        .instance()
        .get(&DataKey::MerkleRoot)
        .ok_or(AirdropError::NotInitialized)?;

    let leaf = merkle::leaf_hash(env, &env.current_contract_address(), claimant, amount);

    if !merkle::verify_proof(env, &root, leaf, proof) {
        return Err(AirdropError::InvalidProof);
    }

    // Mark as claimed before transfer (re-entrancy guard).
    let c_ttl = get_claimed_ttl(env);
    env.storage().persistent().set(&claimed_key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&claimed_key, c_ttl / 2, c_ttl);

    // Transfer tokens to claimant.
    let token: Address = env
        .storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .unwrap();
    TokenClient::new(env, &token).transfer(
        &env.current_contract_address(),
        claimant,
        &amount,
    );

    env.events()
        .publish((symbol_short!("claimed"), claimant.clone()), amount);

    Ok(())
}

// ─── TTL helpers ──────────────────────────────────────────────────────────────

/// Read the configured claimed-entry TTL from instance storage, falling back
/// to the compile-time default [`CLAIMED_TTL`] if not set.
fn get_claimed_ttl(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::ClaimedTtl)
        .unwrap_or(CLAIMED_TTL)
}

/// Read the configured instance-storage TTL from instance storage, falling back
/// to the compile-time default [`INSTANCE_TTL`] if not set.
fn get_instance_ttl(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::InstanceTtl)
        .unwrap_or(INSTANCE_TTL)
}

/// Extend instance storage TTL using the configured (or default) value.
fn extend_instance_ttl(env: &Env) {
    let i_ttl = get_instance_ttl(env);
    env.storage().instance().extend_ttl(i_ttl / 2, i_ttl);
}
