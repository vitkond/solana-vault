# Solana Vault

A decentralized token vault program built on [Solana](https://solana.com) using the [Anchor](https://www.anchor-lang.com/) framework. It implements an **ERC-4626-style share-based vault** that allows users to deposit SPL tokens and receive proportional share tokens in return, enabling yield-bearing strategies.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
  - [Program Accounts](#program-accounts)
  - [Instructions](#instructions)
  - [Share Pricing Model](#share-pricing-model)
  - [Error Handling](#error-handling)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Build](#build)
  - [Test](#test)
  - [Deploy](#deploy)
- [Security Considerations](#security-considerations)

---

## Overview

Solana Vault is an on-chain program that accepts any SPL token as an asset. When a user deposits tokens, the vault mints **share tokens** proportional to their contribution relative to the total vault holdings. On withdrawal, shares are burned and the user receives their proportional slice of the underlying assets — including any yield that may have accumulated in the treasury.

**Program ID:** `Ejxqg8ydAPc3Pd1SvPKNJ7cKd5RgF982L1r9VWnqw7AC`

---

## Features

- ✅ **Deposit** any SPL token and receive proportional share tokens
- ✅ **Withdraw** by burning shares and redeeming underlying assets
- ✅ **Yield awareness** — share price automatically reflects accumulated assets in the treasury
- ✅ **Admin pause/unpause** — emergency circuit breaker to halt deposits
- ✅ **PDA-based vault authority** — treasury and share mint are controlled by a Program Derived Address
- ✅ **Overflow-safe math** — all arithmetic uses checked operations
- ✅ **Comprehensive test suite** covering normal flows, edge cases, and attack vectors

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Solana Vault Program                  │
│                                                              │
│  ┌──────────┐    deposit(amount)     ┌────────────────────┐  │
│  │   User   │ ──────────────────────▶│  Vault PDA         │  │
│  │          │◀────────────────────── │  (seeds: "vault"   │  │
│  │  Asset   │    mint share tokens   │   + asset_mint)    │  │
│  │  Tokens  │                        └────────┬───────────┘  │
│  │  Share   │    withdraw(shares)             │              │
│  │  Tokens  │ ──────────────────────▶         │ controls     │
│  └──────────┘◀────────────────────── ─ ─ ─ ─ ▼              │
│               return asset tokens    ┌────────────────────┐  │
│                                      │    Treasury ATA    │  │
│                                      │  (holds all assets)│  │
│                                      └────────────────────┘  │
│                                      ┌────────────────────┐  │
│                                      │    Share Mint      │  │
│                                      │  (authority=vault) │  │
│                                      └────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Program Accounts

| Account | Type | Description |
|---------|------|-------------|
| `Vault` | PDA (`"vault" + asset_mint`) | Stores vault state: admin, mints, bump, and paused flag |
| `Treasury` | Associated Token Account | Holds all deposited asset tokens; owned by the Vault PDA |
| `Share Mint` | SPL Mint | Issues/burns share tokens; mint authority is the Vault PDA |
| `User Token Account` | Associated Token Account | User's holding of the underlying asset |
| `User Share Account` | Associated Token Account | User's holding of vault shares |

#### `Vault` State

```rust
pub struct Vault {
    pub admin: Pubkey,       // Admin who can pause/unpause the vault
    pub asset_mint: Pubkey,  // The SPL token accepted by this vault
    pub share_mint: Pubkey,  // The share token minted to depositors
    pub bump: u8,            // PDA canonical bump
    pub paused: bool,        // Emergency pause flag
}
```

---

### Instructions

#### `initialize`
Creates a new vault for a specific asset mint.

- Initializes the `Vault` PDA (seeded by `"vault"` + `asset_mint`)
- Creates a treasury ATA owned by the vault PDA
- Creates a new share SPL mint with mint authority set to the vault PDA
- **Signer:** Admin

#### `deposit(amount: u64)`
Deposits asset tokens into the vault and mints proportional share tokens to the user.

- Transfers `amount` asset tokens from the user to the treasury
- Calculates shares to mint: `shares = amount × total_shares / total_assets`
  - On first deposit (empty vault), shares minted equal the deposit amount 1:1
- Mints calculated shares to the user's share account
- **Reverts if:** vault is paused, amount is zero, or calculated shares would be zero

#### `withdraw(shares: u64)`
Burns the user's share tokens and returns proportional underlying assets.

- Calculates assets to return: `assets = shares × total_assets / total_shares`
- Burns `shares` from the user's share account
- Transfers `assets` from the treasury to the user's token account
- **Reverts if:** shares is zero, or calculated assets would be zero

#### `set_paused(paused: bool)`
Toggles the vault's paused state. Only callable by the admin.

- When paused, all deposit calls are rejected
- Withdrawals are not blocked by the pause flag

---

### Share Pricing Model

The vault uses a **proportional share model** (similar to ERC-4626):

```
shares_to_mint = deposit_amount × total_share_supply / total_assets_in_treasury
```

This means:
- **Early depositors** receive 1 share per 1 token (when the vault is empty)
- **Later depositors** receive fewer shares if yield has been added to the treasury
- **All share holders** benefit proportionally from any assets added directly to the treasury (yield)

**Withdrawal example:**
- Treasury has 2,000,000 tokens, total shares supply is 1,000,000
- User burns 500,000 shares → receives `500_000 × 2_000_000 / 1_000_000 = 1,000,000` tokens

---

### Error Handling

| Error | Description |
|-------|-------------|
| `ZeroAmount` | Deposit or withdraw amount must be greater than zero |
| `VaultPaused` | Deposit rejected because the vault is paused |
| `MathOverflow` | Arithmetic overflow during share/asset calculation |
| `ZeroShares` | Deposit would mint zero shares (deposit too small relative to vault size) |
| `ZeroAssets` | Withdrawal would return zero assets |

---

## Project Structure

```
solana-vault/
├── Anchor.toml               # Anchor workspace configuration
├── Cargo.toml                # Workspace Cargo manifest
├── Justfile                  # Developer shortcuts (e.g., key generation)
├── package.json              # Node.js dependencies for tests
├── tsconfig.json             # TypeScript configuration
├── programs/
│   └── solana-vault/
│       ├── Cargo.toml        # Program dependencies (anchor-lang, anchor-spl)
│       └── src/
│           ├── lib.rs        # Main program entry point (instructions & accounts)
│           └── errors.rs     # Custom error codes
├── tests/
│   └── solana-vault.ts       # Integration tests (Mocha/Chai + Anchor)
├── migrations/
│   └── deploy.ts             # Deployment script
└── target/
    ├── idl/
    │   └── solana_vault.json # Generated Interface Definition Language file
    └── types/
        └── solana_vault.ts   # Generated TypeScript types for the program
```

---

## Prerequisites

- [Rust](https://rustup.rs/) (see `rust-toolchain.toml` for the pinned version)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) v0.32.1
- [Node.js](https://nodejs.org/) ≥ 18 & [Yarn](https://yarnpkg.com/)

---

## Getting Started

### Build

```bash
anchor build
```

### Test

Start a local validator and run the full test suite:

```bash
anchor test
```

### Deploy

Generate a fresh deploy keypair and sync program IDs:

```bash
just gen-keys
```

Then deploy to the cluster configured in `Anchor.toml` (default: `localnet`):

```bash
anchor deploy
```

---

## Security Considerations

- **Vault authority is a PDA** — no private key exists for the treasury or share mint authority; all CPI calls are signed with vault seeds.
- **Owner constraint on user token account** — the program enforces that `user_token_account.owner == user`, preventing an attacker from redirecting funds from a victim's account.
- **Pause mechanism** — the admin can halt deposits in an emergency without affecting withdrawals, ensuring users can always exit.
- **Checked arithmetic** — all share/asset calculations use `checked_mul` and `checked_div` to prevent integer overflow/underflow.

