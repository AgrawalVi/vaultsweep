# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Vaultsweep is a desktop app that helps a semi-technical user migrate their passwords into 1Password in one sitting. It imports from iCloud Keychain, Chrome, and Arc CSVs, merges and dedupes, walks through each account to decide keep/delete/skip, and commits to 1Password at the end.

Target user: "decent with computers" but not a developer. No terminal, no config files, no jargon exposed.

## Commands

```bash
pnpm tauri dev                    # Full app with hot reload
pnpm tauri build                  # Signed bundle

pnpm test                         # Vitest (unit)
cargo test --manifest-path src-tauri/Cargo.toml

pnpm lint
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

pnpm dlx shadcn@latest add <component>

# Required runtime deps
ollama serve                      # pull gemma4:e4b first
op --version                      # 1Password CLI, must be signed in
```

## Architecture

Tauri v2 desktop app. React 19 + TypeScript frontend, Rust backend.

**Frontend ↔ Backend**: `invoke("command_name", { arg })` in TypeScript, `#[tauri::command]` in Rust. Register new commands in both the fn definition and `invoke_handler` in `src-tauri/src/lib.rs`. Typed wrappers go in `src/lib/tauri.ts`.

**Capabilities** (`src-tauri/capabilities/default.json`): Update when adding Tauri plugins.

### Planned directory layout

```
src/
  components/
    wizard/           # Step-by-step onboarding flow
    triage/           # One-account-at-a-time UI (the core screen)
    ui/               # shadcn base components (do not modify)
    ui-vaultsweep/    # Custom wrappers over shadcn (put overrides here)
  hooks/
  lib/
    tauri.ts          # Typed invoke() wrappers
src-tauri/src/
  commands/           # Tauri command handlers (JS-Rust boundary)
  parsers/            # icloud.rs, chrome.rs, arc.rs — normalize to RawEntry
  merger/             # Dedup and merge → MergedAccount
  llm/                # Ollama client + prompts.rs (sanitized input only)
  op/                 # 1Password CLI wrapper
  hibp/               # Breach checking (k-anonymity)
```

### Three-phase data flow

**Phase 1 (Import/Merge) — Rust only**: CSV parsing → `RawEntry` → `MergedAccount`. Conflicts (same account, different passwords across sources) are flagged for user resolution during triage. Never written to disk in plaintext.

**Phase 2 (Triage) — React + Rust**: One account at a time. Backend enriches each with Ollama category/score (domain + username only) and HIBP breach status (k-anonymity). User picks Keep / Delete / Skip. All decisions are marks only — nothing writes to 1Password or disk during triage.

**Phase 3 (Execute) — Rust + `op` CLI**:
- Import step: `op item create` for Keep accounts, tagged `migration:<date>` and `vaultsweep:needs-rotation`. Delete-marked accounts are never imported.
- Rotation step (opt-in, resumable): query 1Password for `vaultsweep:needs-rotation`, walk one account at a time, update via `op item edit`, remove tag. State lives in 1Password — no separate state file.

## Security invariants — enforce in every PR

1. Plaintext passwords never touch disk (CSVs are read-only input).
2. Plaintext passwords never leave the machine. No telemetry, no cloud calls with password data.
3. The LLM (Ollama) only ever sees domain names and usernames — never passwords. Prompts constructed in `src-tauri/src/llm/prompts.rs` with sanitized input only.
4. HIBP: first 5 chars of SHA-1 hash only (k-anonymity).
5. Use `zeroize` crate for any Rust struct holding a password. JS passwords cleared as soon as no longer needed.
6. Logs never contain credentials.

## Code conventions

**TypeScript**: Strict mode. No `any`. No non-null assertions without a comment.

**Rust**: `Result` over `panic!`. `thiserror` for error types. `tracing` for logging. `zeroize` for credential structs.

**State management**: Zustand. No Redux.

**Testing**: Vitest for unit, Playwright for e2e.

**shadcn**: Do not modify files in `src/components/ui/`. Custom overrides go in `src/components/ui-vaultsweep/` so `pnpm dlx shadcn@latest add` keeps working.

## Key config

- `src-tauri/tauri.conf.json`: App identifier `tech.vishrut.vaultsweep`, window 800×600
- Tailwind v4 — no `tailwind.config.js`, configured via Vite plugin and CSS
- Package manager: **pnpm**
