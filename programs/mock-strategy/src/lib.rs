use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

declare_id!("9kTeijXBNtTCpcwWrn7w96q1c6DMTjcCm8MurGYorYBS");

#[program]
pub mod mock_strategy {
    use anchor_spl::token;
    use super::*;

    pub fn initialize_strategy(ctx: Context<InitializeStrategy>) -> Result<()> {
        let strategy = &mut ctx.accounts.strategy;
        strategy.asset_mint = ctx.accounts.asset_mint.key();
        strategy.authority_bump = ctx.bumps.strategy_authority;

        msg!("mock strategy initialized");
        Ok(())
    }

    pub fn deposit_from_vault(
        ctx: Context<DepositFromVault>,
        amount: u64,
    ) -> Result<()> {
        let transfer_accounts = Transfer {
            from: ctx.accounts.vault_treasury.to_account_info(),
            to: ctx.accounts.strategy_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
        );

        token::transfer(transfer_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeStrategy<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Strategy::INIT_SPACE,
        seeds = [b"strategy", asset_mint.key().as_ref()],
        bump
    )]
    pub strategy: Account<'info, Strategy>,

    #[account(
        seeds = [b"strategy_authority", strategy.key().as_ref()],
        bump
    )]
    /// CHECK: PDA authority only
    pub strategy_authority: UncheckedAccount<'info>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = asset_mint,
        associated_token::authority = strategy_authority
    )]
    pub strategy_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct DepositFromVault<'info> {
    #[account(
        seeds = [b"strategy", asset_mint.key().as_ref()],
        bump,
        has_one = asset_mint
    )]
    pub strategy: Account<'info, Strategy>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = strategy_authority
    )]
    pub strategy_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"strategy_authority", strategy.key().as_ref()],
        bump = strategy.authority_bump
    )]
    /// CHECK: PDA authority only
    pub strategy_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_treasury.mint == asset_mint.key(),
        constraint = vault_treasury.owner == vault_authority.key()
    )]
    pub vault_treasury: Account<'info, TokenAccount>,

    pub vault_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Strategy {
    pub asset_mint: Pubkey,
    pub authority_bump: u8,
}
