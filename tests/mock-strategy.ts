import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MockStrategy } from "../target/types/mock_strategy";
import { expect } from "chai";
import {
    createMint,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount, createAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";

describe("mock-strategy", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const strategyProgram = anchor.workspace.mockStrategy as Program<MockStrategy>;

    it("initializes mock strategy", async () => {
        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const [strategyPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("strategy"), assetMint.toBuffer()],
            strategyProgram.programId
        );

        const [strategyAuthorityPda] =
            anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("strategy_authority"), strategyPda.toBuffer()],
                strategyProgram.programId
            );

        const strategyTokenAccount = getAssociatedTokenAddressSync(
            assetMint,
            strategyAuthorityPda,
            true
        );

        await strategyProgram.methods
            .initializeStrategy()
            .accountsPartial({
                strategy: strategyPda,
                strategyAuthority: strategyAuthorityPda,
                assetMint,
                strategyTokenAccount,
                payer: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();

        const strategy = await strategyProgram.account.strategy.fetch(strategyPda);

        expect(strategy.assetMint.toBase58()).to.eq(assetMint.toBase58());

        const tokenAccount = await getAccount(
            provider.connection,
            strategyTokenAccount
        );

        expect(tokenAccount.mint.toBase58()).to.eq(assetMint.toBase58());
        expect(tokenAccount.owner.toBase58()).to.eq(
            strategyAuthorityPda.toBase58()
        );
        expect(Number(tokenAccount.amount)).to.eq(0);
    });

    it("deposits from vault treasury into strategy token account", async () => {
        const vaultAuthority = anchor.web3.Keypair.generate();

        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(
                vaultAuthority.publicKey,
                anchor.web3.LAMPORTS_PER_SOL
            )
        );

        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const [strategyPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("strategy"), assetMint.toBuffer()],
            strategyProgram.programId
        );

        const [strategyAuthorityPda] =
            anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("strategy_authority"), strategyPda.toBuffer()],
                strategyProgram.programId
            );

        const strategyTokenAccount = getAssociatedTokenAddressSync(
            assetMint,
            strategyAuthorityPda,
            true
        );

        await strategyProgram.methods
            .initializeStrategy()
            .accountsPartial({
                strategy: strategyPda,
                strategyAuthority: strategyAuthorityPda,
                assetMint,
                strategyTokenAccount,
                payer: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();

        const vaultTreasury = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            vaultAuthority.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            vaultTreasury,
            provider.wallet.publicKey,
            1_000_000
        );

        await strategyProgram.methods
            .depositFromVault(new anchor.BN(400_000))
            .accountsPartial({
                strategy: strategyPda,
                assetMint,
                strategyTokenAccount,
                strategyAuthority: strategyAuthorityPda,
                vaultTreasury,
                vaultAuthority: vaultAuthority.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([vaultAuthority])
            .rpc();

        const vaultTreasuryAccount = await getAccount(
            provider.connection,
            vaultTreasury
        );

        const strategyAccount = await getAccount(
            provider.connection,
            strategyTokenAccount
        );

        expect(Number(vaultTreasuryAccount.amount)).to.eq(600_000);
        expect(Number(strategyAccount.amount)).to.eq(400_000);
    });
});