# CLAUDE.md

Guidance for Claude Code when working in this repo.

Product spec: `vaultsweep.md` (authoritative — read it before designing UX flows).
Decision log: `design-decisions.md` (append non-obvious choices here, don't rewrite).
Task tracking: **Linear** (workspace `vaultsweep`, team `VAU`) via the Linear MCP. It is the single source of truth for status, plans, and bugs — don't write plan/status files in the repo or `~/.claude/plans`. Check Linear before starting work, put implementation plans in issue descriptions, move issues through Todo → In Progress → Done as work lands, and file bugs found along the way as `Bug`-labeled issues. Name branches with the issue's `gitBranchName`.

## What this app is

Vaultsweep is a desktop app that migrates passwords from iCloud Keychain, Chrome/Chromium browsers, and Firefox-family browsers into 1Password in one sitting. Import → merge/dedupe → user reviews subdomain merges → resolves conflicts → triages each account (Keep/Delete/Skip) → commits to 1Password → opt-in bulk rotation.

Target user: "decent with computers" but not a developer. No terminal, no config files, no jargon. See `vaultsweep.md` §The user, §UX principles, §UI & visual identity before designing anything.

## Phase naming (keep these straight)

The spec uses two overlapping three-phase models — don't confuse them:

- **Session phases** (what the user experiences): Phase 1 = Triage, Phase 2 = Execute deletions, Phase 3 = Rotate passwords.
- **Architecture phases** (backend data flow): Phase 1 = Import + Merge (Rust), Phase 2 = Triage enrichment (React + Rust), Phase 3 = Execute (Rust + `op` CLI).

When in doubt, qualify: "Session Phase 2" vs "Architecture Phase 2".

## Commands

```bash
pnpm tauri dev                    # Full app with hot reload
pnpm tauri build                  # Signed bundle

pnpm test                         # Vitest, single run (pnpm test:watch for watch mode)
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored   # Rust known-bug list

# pnpm lint is not wired up yet (no ESLint installed) — tracked in Linear VAU-27
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

pnpm dlx shadcn@latest add <component>

# Required runtime deps (not yet wired into the app)
ollama serve                      # pull gemma4:e4b first
op --version                      # 1Password CLI, must be signed in
```

Debug: **Cmd+Shift+D** opens a separate Tauri webview window (`CsvEntriesDebug`) that mirrors `rawEntries` and `mergedAccounts` over Tauri events. Useful for inspecting the merger output without touching the wizard UI.

## Architecture

Tauri v2 desktop app. React 19 + TypeScript frontend, Rust backend.

**Frontend ↔ Backend**: `invoke("command_name", { arg })` in TypeScript, `#[tauri::command]` in Rust. Register new commands in `src-tauri/src/lib.rs` `invoke_handler`. Typed wrappers go in `src/lib/tauri.ts`.

**Serde naming**: Rust uses snake_case, TS uses camelCase. Every struct crossing the boundary needs `#[serde(rename_all = "camelCase")]` on the Rust side. `RawEntry`, `MergedAccount`, `PasswordEntry` already have it — follow the pattern.

**Tauri plugins in use**: `opener`, `dialog`. Update `src-tauri/capabilities/default.json` permissions when adding more.

### Directory layout (current)

```
src/
  components/
    wizard/               # Welcome → ConnectSources → ImportSummary →
                          # MergeConflict → ReviewMerges → TriageCard → TriageComplete
    debug/                # CsvEntriesDebug (Cmd+Shift+D window)
    shell/                # AppShell
    ui/                   # shadcn base (do not modify)
    ui-vaultsweep/        # Custom wrappers (empty for now; put overrides here)
  lib/
    store.ts              # Zustand wizard state — one store for the whole flow
    tauri.ts              # Typed invoke() wrappers + pickCsvFile + openDebugCsvWindow
  types/
    parser.ts             # RawEntry, MergedAccount, PasswordEntry, ImportTarget mirrors
src-tauri/src/
  commands/
    mod.rs, parser.rs     # parse_csvs, merge_entries
  parsers/
    icloud.rs, chromium.rs, firefox.rs, mod.rs   # all CSV sources → RawEntry
  merger/
    mod.rs                # merge() → Vec<MergedAccount>
    boring_subdomains.rs  # set of "boring" subdomain labels (www, mail, accounts, ...)
  lib.rs, main.rs
```

Planned but not yet built: `src-tauri/src/llm/` (Ollama + prompts), `src-tauri/src/hibp/`, `src-tauri/src/op/`.

### Three merge groupings (Architecture Phase 1)

The merger groups by `(registrable_domain, lowercased_username)` and emits one of:

1. **Clean merge** — same key, same password. Sources unioned silently. `isSubdomainMerge = false`, `hasConflict = false`.
2. **Subdomain merge** — same key, same password, different subdomains. `isSubdomainMerge = true`, `allUrls` holds every distinct URL. If every subdomain label is in `BORING_SUBDOMAIN_LABELS` (www/mail/accounts/login/auth/m/app/…), `subdomainIsInteresting = false` and it's merged silently; otherwise it's surfaced in the Review Merges window. See `boring_subdomains.rs`.
3. **Conflict** — same key, different passwords. `hasConflict = true`, `passwords` has one entry per distinct password (each carrying its own `url` + `source`). User resolves on `MergeConflictScreen`.

### Wizard flow and skip rules

`store.advance()` auto-skips steps with nothing to do:
- Skip `merge-conflict` when no `hasConflict` accounts.
- Skip `review-merges` when no `isSubdomainMerge` accounts.

Raw merger output lives in `rawMergedAccounts` (frozen after merge). `mergedAccounts` is the working list that downstream screens consume — rebuilt after conflict resolution and again after Review Merges commit.

### Conflict resolution shape

`ConflictResolution` is a tagged union: `{kind:'combine', passwordIdx} | {kind:'separate'} | {kind:'discard'}`. Applied by `applyConflictResolutions` in `src/lib/store.ts`:
- **combine** → one account with the chosen password, `hasConflict: false`.
- **separate** → one account per candidate; each keeps its own subdomain URL.
- **discard** → stashed in `discardedAccounts` for Session Phase 2's deletion review.

### Review Merges shape

`ReviewAccount` rows hold `urls: string[]` — a subset of the source `MergedAccount.allUrls`. Operations: `splitReviewAll` (fan into N one-URL rows), `splitReviewSelected` (peel URLs off), `regroupReview` (merge rows with matching `groupKey = ${domain}|${username}`, at least one of which is split-off). `reviewUndoStack` holds full snapshots for unlimited undo.

Skip semantics: auto-split *interesting* merges, keep boring ones collapsed. Defensive default — don't risk merging two workspace tenants, don't fragment Google-family groups.

## Security invariants — enforce in every PR

1. Plaintext passwords never touch disk (CSVs are read-only input).
2. Plaintext passwords never leave the machine. No telemetry, no cloud calls with password data.
3. The LLM (Ollama) only ever sees domain names and usernames — never passwords. Prompts constructed in `src-tauri/src/llm/prompts.rs` with sanitized input only.
4. HIBP: first 5 chars of SHA-1 hash only (k-anonymity).
5. Use `zeroize` crate for any Rust struct holding a password. JS passwords cleared as soon as no longer needed. `PasswordEntry` and `MergedAccount` derive `ZeroizeOnDrop` — preserve that on changes.
6. Logs never contain credentials. `RawEntry` and `PasswordEntry` have hand-written `Debug` impls that redact the password field. Never `#[derive(Debug)]` on a struct that holds a plaintext password directly.

## Code conventions

**TypeScript**: Strict mode. No `any`. No non-null assertions without a comment.

**Rust**: `Result` over `panic!`. `thiserror` for error types. `tracing` for logging. `zeroize` for credential structs.

**State management**: Zustand. One store (`src/lib/store.ts`) for the wizard. No Redux.

**Testing**:
- Frontend: Vitest + Testing Library (jsdom). Tests are colocated in `src/` as `*.test.ts(x)` so `tsc` typechecks them. Config is standalone in `vitest.config.ts` (not `vite.config.ts`). Fixture builders live in `src/test/factories.ts`; `SENTINEL_PASSWORD` is the greppable password used by leak assertions.
- Pure wizard logic lives in `src/lib/wizard-logic.ts` and is tested without a DOM or store; `store.test.ts` covers orchestration only and mocks `@/lib/tauri`.
- Rust: inline `#[cfg(test)]` modules for parsers + merger (extend them when changing grouping logic); integration tests in `src-tauri/tests/` (`parse_pipeline.rs`, `security.rs`) driven by CSVs in `src-tauri/tests/fixtures/`. `merge()` output order is not deterministic — sort or look up by key, never index.
- Known bugs are encoded, not skipped: `it.fails` in Vitest, `#[ignore = "bug: …"]` in Rust. When you fix one, the marker goes red — flip it to a normal test.
- Playwright is not installed (Tauri e2e needs `tauri-driver`).

**shadcn**: Do not modify `src/components/ui/`. Custom wrappers go in `src/components/ui-vaultsweep/` so `pnpm dlx shadcn@latest add` keeps working. Installed components: button, card, dialog, input, radio-group, checkbox, label, accordion, separator, plus `cmdk` for the command palette.

## Key config

- `src-tauri/tauri.conf.json`: App identifier `tech.vishrut.vaultsweep`, window 800×600
- Tailwind v4 — no `tailwind.config.js`, configured via Vite plugin and CSS
- Package manager: **pnpm**
