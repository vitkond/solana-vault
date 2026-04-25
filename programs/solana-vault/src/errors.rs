use anchor_lang::error_code;

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Shares would be zero")]
    ZeroShares,
    #[msg("Assets would be zero")]
    ZeroAssets,
}