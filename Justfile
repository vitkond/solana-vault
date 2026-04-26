#!/usr/bin/env just --justfile

alias gk := gen-keys

gen-keys:
  solana-keygen new -o target/deploy/solana_vault-keypair.json --force
  anchor keys sync

run-validator:
   solana-test-validator --reset