# Contributing to soroban-merkle-airdrop

Thank you for your interest in contributing to `soroban-merkle-airdrop`! This repository provides a gas-efficient Merkle tree airdrop solution for the Stellar network using Soroban smart contracts. 

As a multi-ecosystem repository (Rust smart contracts + TypeScript/Node tools), please review the guidelines below to ensure a smooth contribution process.

---

## 🛠️ Repository & Monorepo Structure

This project is organized into distinct functional workspaces:
* `contracts/airdrop/` - The core Soroban smart contract written in Rust.
* `sdk/` - The TypeScript SDK for off-chain Merkle tree generation and verification.
* `cli/` - The Node-based command-line tool built with pnpm.
* `web/` - The Next.js claim interface frontend.

---

## 🚀 Local Development Setup

### Prerequisites
* **Rust** with the `wasm32v1-none` target installed.
* **Stellar CLI** for local contract interactions.
* **Node.js 20+** and **pnpm** for the JavaScript workspaces.

### Initial Setup
1. Fork the repository on GitHub, then clone your fork locally:
   ```bash
   git clone https://github.com
   cd soroban-merkle-airdrop
   ```
2. Install the JavaScript monorepo dependencies from the root directory:
   ```bash
   pnpm install
   ```

---

## 🧪 Building and Testing Each Module

Before opening a pull request, verify that your specific workspace builds and passes all tests successfully.

### 1. Smart Contract Workflow (`contracts/airdrop/`)
Navigate to the contract directory or run commands targeting the manifest path:
* **Compile the WebAssembly target:**
  ```bash
  cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release
  ```
* **Run Rust unit tests:**
  ```bash
  cargo test --manifest-path contracts/airdrop/Cargo.toml
  ```

> **Cargo.lock:** `Cargo.lock` is committed to the repository so that CI and
> local builds always use the same resolved dependency versions. When you add,
> remove, or upgrade a Rust dependency, run `cargo update` (or the relevant
> `cargo add`/`cargo rm` command) and **commit the updated `Cargo.lock`** in
> the same PR as the `Cargo.toml` change.

### 2. TypeScript SDK Workflow (`sdk/`)
* **Run SDK test suites (Merkle algorithms & tree building):**
  ```bash
  cd sdk
  pnpm test
  ```

### 3. CLI Workflow (`cli/`)
* **Compile the command-line utility:**
  ```bash
  cd cli
  pnpm build
  ```

### 4. Next.js Frontend Workflow (`web/`)
* **Launch the local development UI server:**
  ```bash
  cd web
  pnpm dev
  ```

---

## 📥 Pull Request (PR) Guidelines

* **Target Branch:** Always base your feature or fix branch off the `main` branch.
* **Descriptive Naming:** Name your branch based on the component you are editing, such as `feat/contract-reclaim` or `fix/sdk-leaf-hash`.
* **Atomic Scope:** Keep your pull requests small and focused. Do not combine backend smart contract upgrades and unrelated web frontend UI adjustments into the same PR.
* **Test Inclusion:** If you amend the core cryptographic tree algorithms or verify logic (`merkle.rs` or `merkle.ts`), you must expand the corresponding `test.rs` or `merkle.test.ts` files to prove your changes work.
* **Automated CI Validation:** Every push or PR triggers a GitHub Actions pipeline (`ci.yml`) that compiles the Rust code and validates the node environments. Ensure these badges remain green.

---
