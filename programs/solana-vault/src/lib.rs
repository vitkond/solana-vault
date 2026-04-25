pub mod errors;

use anchor_lang::prelude::*;

use errors::ErrorCode;

use anchor_spl::token::{Mint, Token, TokenAccount, Transfer, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("Ejxqg8ydAPc3Pd1SvPKNJ7cKd5RgF982L1r9VWnqw7AC");

#[program]
pub mod solana_vault {
    use anchor_spl::token;
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.admin = ctx.accounts.admin.key();
        vault.bump = ctx.bumps.vault;
        vault.asset_mint = ctx.accounts.asset_mint.key();
        vault.paused = false;
        vault.share_mint = ctx.accounts.share_mint.key();

        msg!("vault initialized");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.paused, ErrorCode::VaultPaused);
        require!(amount > 0, ErrorCode::ZeroAmount);

        let total_assets = ctx.accounts.treasury.amount;
        let total_shares = ctx.accounts.share_mint.supply;

        let shares_to_mint = if total_shares == 0 || total_assets == 0 {
            amount
        } else {
            amount
                .checked_mul(total_shares)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_assets)
                .ok_or(ErrorCode::MathOverflow)?
        };

        require!(shares_to_mint > 0, ErrorCode::ZeroShares);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );

        token::transfer(cpi_ctx, amount)?;

        let asset_mintkey = ctx.accounts.asset_mint.key();

        let vault_seeds: &[&[u8]] = &[
            b"vault",
            asset_mintkey.as_ref(),
            &[ctx.accounts.vault.bump],
        ];

        let mint_to_accounts = MintTo {
            mint: ctx.accounts.share_mint.to_account_info(),
            to: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };

        let bump_seed = [vault_seeds];
        let mint_to_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_to_accounts,
            &bump_seed,
        );

        token::mint_to(mint_to_ctx, shares_to_mint)?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, ErrorCode::ZeroAmount);

        let total_assets = ctx.accounts.treasury.amount;
        let total_shares = ctx.accounts.share_mint.supply;

        let assets_to_return = shares
            .checked_mul(total_assets)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(total_shares)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(assets_to_return > 0, ErrorCode::ZeroAssets);

        let burn_accounts = Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            burn_accounts,
        );

        token::burn(burn_ctx, shares)?;

        let asset_mint_key = ctx.accounts.asset_mint.key();
        let bump_seed = [ctx.accounts.vault.bump];

        let vault_seeds: &[&[u8]] = &[
            b"vault",
            asset_mint_key.as_ref(),
            &bump_seed,
        ];

        let transfer_accounts = Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };

        let bump_seed = [vault_seeds];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            &bump_seed,
        );

        token::transfer(transfer_ctx, assets_to_return)?;

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.paused = paused;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", asset_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = asset_mint,
        associated_token::authority = vault
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub admin: Pubkey,
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub bump: u8,
    pub paused: bool,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"vault", asset_mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = vault
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.mint == asset_mint.key(),
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    #[account(
    mut,
    associated_token::mint = share_mint,
    associated_token::authority = user
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(
    mut,
    address = vault.share_mint
    )]
    pub share_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"vault", asset_mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(address = vault.asset_mint)]
    pub asset_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = vault.share_mint
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = vault
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.mint == asset_mint.key(),
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = user
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.asset_mint.as_ref()],
        bump = vault.bump,
        has_one = admin
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
