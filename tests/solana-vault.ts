import * as anchor from "@coral-xyz/anchor";
import {Program} from "@coral-xyz/anchor";
import {SolanaVault} from "../target/types/solana_vault";
import {expect} from "chai";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccount,
    createMint,
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    mintTo,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("solana-vault", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.solanaVault as Program<SolanaVault>;

    it("initializes vault for a specific asset mint", async () => {
        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(
            assetMint,
            vaultPda,
            true
        );

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const vaultAccount = await program.account.vault.fetch(vaultPda);

        expect(vaultAccount.admin.toBase58()).to.eq(
            provider.wallet.publicKey.toBase58()
        );
        expect(vaultAccount.assetMint.toBase58()).to.eq(assetMint.toBase58());
        expect(vaultAccount.shareMint.toBase58()).to.eq(shareMint.publicKey.toBase58());
        expect(vaultAccount.bump).to.eq(vaultBump);

        const treasuryAccount = await provider.connection.getParsedAccountInfo(
            treasuryAta
        );

        expect(treasuryAccount.value).to.not.eq(null);

        const treasuryParsed = treasuryAccount.value?.data;
        if (!treasuryParsed || !("parsed" in treasuryParsed)) {
            throw new Error("treasury ATA was not parsed");
        }

        expect(treasuryParsed.parsed.info.mint).to.eq(assetMint.toBase58());
        expect(treasuryParsed.parsed.info.owner).to.eq(vaultPda.toBase58());
        expect(treasuryParsed.parsed.info.tokenAmount.amount).to.eq("0");

        const shareMintAccount = await getMint(
            provider.connection,
            shareMint.publicKey
        );

        expect(shareMintAccount.decimals).to.eq(6);
        expect(shareMintAccount.mintAuthority?.toBase58()).to.eq(vaultPda.toBase58());
    });

    it("deposits tokens and mints shares", async () => {
        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(
            assetMint,
            vaultPda,
            true
        );

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                shareMint: shareMint.publicKey.toBase58(),
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const userTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            userTokenAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        const userShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            provider.wallet.publicKey
        );

        await program.methods
            .deposit(new anchor.BN(400_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                treasury: treasuryAta,
                shareMint: shareMint.publicKey,
                userTokenAccount,
                userShareAccount,
                user: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const userAccount = await getAccount(provider.connection, userTokenAccount);
        const treasuryAccount = await getAccount(provider.connection, treasuryAta);
        const userShares = await getAccount(provider.connection, userShareAccount);

        expect(Number(userAccount.amount)).to.eq(600_000);
        expect(Number(treasuryAccount.amount)).to.eq(400_000);
        expect(Number(userShares.amount)).to.eq(400_000);
    });

    it("mints proportional shares on second deposit after yield", async () => {
        const user2 = anchor.web3.Keypair.generate();

        const sig = await provider.connection.requestAirdrop(
            user2.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);

        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(
            assetMint,
            vaultPda,
            true
        );

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const user1AssetAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        const user1ShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            provider.wallet.publicKey
        );

        const user2AssetAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user2.publicKey
        );

        const user2ShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            user2.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user1AssetAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user2AssetAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        await program.methods
            .deposit(new anchor.BN(1_000_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                userTokenAccount: user1AssetAccount,
                userShareAccount: user1ShareAccount,
                user: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            treasuryAta,
            provider.wallet.publicKey,
            1_000_000
        );

        await program.methods
            .deposit(new anchor.BN(1_000_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                userTokenAccount: user2AssetAccount,
                userShareAccount: user2ShareAccount,
                user: user2.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();

        const user1Shares = await getAccount(provider.connection, user1ShareAccount);
        const user2Shares = await getAccount(provider.connection, user2ShareAccount);
        const treasury = await getAccount(provider.connection, treasuryAta);

        expect(Number(user1Shares.amount)).to.eq(1_000_000);
        expect(Number(user2Shares.amount)).to.eq(500_000);
        expect(Number(treasury.amount)).to.eq(3_000_000);
    });

    it("rejects deposit when vault is paused", async () => {
        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(
            assetMint,
            vaultPda,
            true
        );

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                shareMint: shareMint.publicKey.toBase58(),
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const userTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            userTokenAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        await program.methods
            .setPaused(true)
            .accountsPartial({
                vault: vaultPda,
                admin: provider.wallet.publicKey,
            })
            .rpc();

        try {
            const userShareAccount = await createAssociatedTokenAccount(
                provider.connection,
                provider.wallet.payer,
                shareMint.publicKey,
                provider.wallet.publicKey
            );
            await program.methods
                .deposit(new anchor.BN(400_000))
                .accountsPartial({
                    vault: vaultPda,
                    assetMint,
                    treasury: treasuryAta,
                    userTokenAccount,
                    userShareAccount,
                    shareMint: shareMint.publicKey.toBase58(),
                    user: provider.wallet.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            expect.fail("deposit should have failed");
        } catch (e: any) {
            const msg = e?.toString() ?? "";
            expect(msg).to.contain("Vault is paused");
        }
    });

    it("withdraws proportional assets by burning shares", async () => {
        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(
            assetMint,
            vaultPda,
            true
        );

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const userAssetAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        const userShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            provider.wallet.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            userAssetAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        await program.methods
            .deposit(new anchor.BN(1_000_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                userTokenAccount: userAssetAccount,
                userShareAccount,
                user: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            treasuryAta,
            provider.wallet.publicKey,
            1_000_000
        );

        await program.methods
            .withdraw(new anchor.BN(500_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                userTokenAccount: userAssetAccount,
                userShareAccount,
                user: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const userAsset = await getAccount(provider.connection, userAssetAccount);
        const userShares = await getAccount(provider.connection, userShareAccount);
        const treasury = await getAccount(provider.connection, treasuryAta);
        const shareMintInfo = await getMint(provider.connection, shareMint.publicKey);

        expect(Number(userAsset.amount)).to.eq(1_000_000);
        expect(Number(userShares.amount)).to.eq(500_000);
        expect(Number(treasury.amount)).to.eq(1_000_000);
        expect(Number(shareMintInfo.supply)).to.eq(500_000);
    });

    it("rejects deposit when minted shares would be zero", async () => {
        const user2 = anchor.web3.Keypair.generate();

        const sig = await provider.connection.requestAirdrop(
            user2.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);

        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(assetMint, vaultPda, true);

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const user1AssetAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        const user1ShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            provider.wallet.publicKey
        );

        const user2AssetAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user2.publicKey
        );

        const user2ShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            user2.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user1AssetAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            user2AssetAccount,
            provider.wallet.publicKey,
            1
        );

        await program.methods
            .deposit(new anchor.BN(1_000_000))
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                userTokenAccount: user1AssetAccount,
                userShareAccount: user1ShareAccount,
                user: provider.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            treasuryAta,
            provider.wallet.publicKey,
            999_000_000
        );

        try {
            await program.methods
                .deposit(new anchor.BN(1))
                .accountsPartial({
                    vault: vaultPda,
                    assetMint,
                    shareMint: shareMint.publicKey,
                    treasury: treasuryAta,
                    userTokenAccount: user2AssetAccount,
                    userShareAccount: user2ShareAccount,
                    user: user2.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([user2])
                .rpc();

            expect.fail("deposit should have failed");
        } catch (e: any) {
            expect(e.toString()).to.contain("Shares would be zero");
        }
    });

    // it("rejects withdraw when returned assets would be zero", async () => {
    //     const assetMint = await createMint(
    //         provider.connection,
    //         provider.wallet.payer,
    //         provider.wallet.publicKey,
    //         null,
    //         6
    //     );
    //
    //     const shareMint = anchor.web3.Keypair.generate();
    //
    //     const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    //         [Buffer.from("vault"), assetMint.toBuffer()],
    //         program.programId
    //     );
    //
    //     const treasuryAta = getAssociatedTokenAddressSync(assetMint, vaultPda, true);
    //
    //     await program.methods
    //         .initialize()
    //         .accountsPartial({
    //             vault: vaultPda,
    //             assetMint,
    //             shareMint: shareMint.publicKey,
    //             treasury: treasuryAta,
    //             admin: provider.wallet.publicKey,
    //             systemProgram: anchor.web3.SystemProgram.programId,
    //             tokenProgram: TOKEN_PROGRAM_ID,
    //             associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //         })
    //         .signers([shareMint])
    //         .rpc();
    //
    //     const userAssetAccount = await createAssociatedTokenAccount(
    //         provider.connection,
    //         provider.wallet.payer,
    //         assetMint,
    //         provider.wallet.publicKey
    //     );
    //
    //     const userShareAccount = await createAssociatedTokenAccount(
    //         provider.connection,
    //         provider.wallet.payer,
    //         shareMint.publicKey,
    //         provider.wallet.publicKey
    //     );
    //
    //     await mintTo(
    //         provider.connection,
    //         provider.wallet.payer,
    //         assetMint,
    //         userAssetAccount,
    //         provider.wallet.publicKey,
    //         1_000_000
    //     );
    //
    //     await program.methods
    //         .deposit(new anchor.BN(1_000_000))
    //         .accountsPartial({
    //             vault: vaultPda,
    //             assetMint,
    //             shareMint: shareMint.publicKey,
    //             treasury: treasuryAta,
    //             userTokenAccount: userAssetAccount,
    //             userShareAccount,
    //             user: provider.wallet.publicKey,
    //             tokenProgram: TOKEN_PROGRAM_ID,
    //         })
    //         .rpc();
    //
    //     // Make shares >> assets
    //     // reduce assets relative to shares
    //     // burn almost everything, but leave a tiny bit
    //
    //     await program.methods
    //         .withdraw(new anchor.BN(999_999))
    //         .accountsPartial({
    //             vault: vaultPda,
    //             assetMint,
    //             shareMint: shareMint.publicKey,
    //             treasury: treasuryAta,
    //             userTokenAccount: userAssetAccount,
    //             userShareAccount,
    //             user: provider.wallet.publicKey,
    //             tokenProgram: TOKEN_PROGRAM_ID,
    //         })
    //         .rpc();
    //
    //     // now what remains:
    //     // shares ~ 1
    //     // assets ~ 1_000_000 - something
    //     // simulate yield in reverse: logically reduce assets through a new scenario
    //
    //     // simpler: try withdrawing 1 share -> it should return 0
    //
    //     try {
    //         await program.methods
    //             .withdraw(new anchor.BN(1))
    //             .accountsPartial({
    //                 vault: vaultPda,
    //                 assetMint,
    //                 shareMint: shareMint.publicKey,
    //                 treasury: treasuryAta,
    //                 userTokenAccount: userAssetAccount,
    //                 userShareAccount,
    //                 user: provider.wallet.publicKey,
    //                 tokenProgram: TOKEN_PROGRAM_ID,
    //             })
    //             .rpc();
    //
    //         expect.fail("withdraw should have failed");
    //     } catch (e: any) {
    //         console.error("Error", e);
    //         expect(e.toString()).to.contain("Assets would be zero");
    //     }
    // });

    it("rejects deposit from token account not owned by signer", async () => {
        const attacker = anchor.web3.Keypair.generate();

        const sig = await provider.connection.requestAirdrop(
            attacker.publicKey,
            2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);

        const assetMint = await createMint(
            provider.connection,
            provider.wallet.payer,
            provider.wallet.publicKey,
            null,
            6
        );

        const shareMint = anchor.web3.Keypair.generate();

        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), assetMint.toBuffer()],
            program.programId
        );

        const treasuryAta = getAssociatedTokenAddressSync(assetMint, vaultPda, true);

        await program.methods
            .initialize()
            .accountsPartial({
                vault: vaultPda,
                assetMint,
                shareMint: shareMint.publicKey,
                treasury: treasuryAta,
                admin: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([shareMint])
            .rpc();

        const victimTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            provider.wallet.publicKey
        );

        const attackerShareAccount = await createAssociatedTokenAccount(
            provider.connection,
            provider.wallet.payer,
            shareMint.publicKey,
            attacker.publicKey
        );

        await mintTo(
            provider.connection,
            provider.wallet.payer,
            assetMint,
            victimTokenAccount,
            provider.wallet.publicKey,
            1_000_000
        );

        try {
            await program.methods
                .deposit(new anchor.BN(100_000))
                .accountsPartial({
                    vault: vaultPda,
                    assetMint,
                    shareMint: shareMint.publicKey,
                    treasury: treasuryAta,
                    userTokenAccount: victimTokenAccount,
                    userShareAccount: attackerShareAccount,
                    user: attacker.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([attacker])
                .rpc();

            expect.fail("deposit should have failed");
        } catch (e: any) {
            expect(e.toString()).to.contain("A raw constraint was violated");
        }
    });
});