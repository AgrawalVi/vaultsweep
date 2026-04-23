# Vaultsweep

A desktop app that helps a semi-technical person migrate their passwords into 1Password in one sitting. Imports from multiple sources (iCloud Keychain, Chrome, Arc), merges and dedupes, walks through each account to decide keep, delete, or change, and commits everything to 1Password at the end.

## The user

**Who this is for (v1):** A semi-technical user migrating their own passwords. Comfortable with installing a desktop app, following basic setup instructions, and understanding what a password manager is. Not a developer, not an engineer. Thinks of themselves as "decent with computers" but not "technical." Examples: a designer, a marketer, a project manager, a teacher, a small business owner.

**Who this is NOT for in v1:** Non-technical older adults, or cases where one person is helping another. That's the "family mode" (v3). Keeping v1 focused on solo semi-technical users means faster shipping, tighter feedback loops, and a chance to validate the core migration engine before layering on the more ambitious two-person flow.

**Who the builder is NOT:** You, the person building this, are significantly more technical than the target user. That's a real risk. The most common failure mode for strong engineers building consumer apps is designing for themselves. Combat this by doing early and frequent user testing with actual semi-technical people (non-engineer friends count). Every major flow should be tested with at least 2-3 real users before it ships.

## The session

One sitting, 30-45 minutes for Phase 1, a few more minutes for Phase 2, and Phase 3 is resumable across sittings. A typical full migration of 200-300 passwords completes in under an hour for Phases 1 and 2, with Phase 3 (rotations) often stretched over a week or two at the user's pace.

Every UX decision should pass the "would a competent non-engineer understand this without help" test. Plain language, not jargon. No terminal. No config files. No "just run this command." At the same time, don't condescend: semi-technical users can handle density, keyboard shortcuts, and a bit of power. Treat them like smart adults who haven't done this specific task before.

## Session structure

The migration is split into three phases. This separation is deliberate: mixing decision-making with action-taking slows everything to a crawl and wastes work on accounts that will be deleted anyway.

### Phase 1: Triage (decisions only)

Fast, one account at a time. For each account, the user picks one of three actions:

- **Keep:** This account stays. It will be imported into 1Password.
- **Delete:** Mark for removal. The actual removal happens in Phase 2, not now.
- **Skip:** Decide later. Comes back at the end of the queue.

Target pace: about 5 seconds per account for a semi-technical user using keyboard shortcuts. A 250-account session fits in 20-25 minutes.

No passwords are changed and no accounts are deleted during Phase 1. The user is only answering one question per account: "do I still use this?" This is deliberately the simplest possible mental model. Keeping it binary (well, ternary with Skip) makes triage feel fast and decisive.

Keyboard shortcuts are enabled by default and shown prominently on each card: K (keep), D (delete), S (skip). Power users will learn these in the first minute and fly through the rest of the session.

Note: Phase 1 comes after a Review Merges window (see below), which is where the user reviews automatic subdomain merges and can split or regroup them before triage begins.

### Review Merges (between conflicts and Phase 1)

Before triage begins, the user has a chance to review accounts the merger combined automatically. This is optional and skippable but is shown by default. It exists because the merger groups entries by registrable domain, which is right most of the time (mail.google.com and accounts.google.com are the same Google account) but wrong for workspace-style SaaS where subdomains represent different organizations (company-a.okta.com and company-b.okta.com are different accounts).

The window shows a list of silently-merged accounts. "Interesting" merges (semantically different subdomains) are surfaced by default. Boring merges (www vs bare, or common prefixes like mail/accounts/login) are hidden behind a "show all" toggle so the default list stays focused.

Actions per row:

- **Keep merged:** default, no action.
- **Split:** expand the row to see each subdomain as its own card. User can split all apart, or selectively split by choosing which subdomains to separate.
- **Regroup:** after splitting, the user can select two or more split-off rows from the same base domain and merge them back together. This is the symmetric inverse of split and exists so users don't feel trapped by a split decision.

All changes are reversible within the window. An "Undo last action" affordance is always available. Nothing is committed until the user clicks Continue at the bottom.

Empty state: if there are zero interesting merges, the window shows "Everything looked clearly separate, nothing to review" and auto-advances after a brief moment.

Primary URL for merged accounts: defaults to the bare registrable domain, with all subdomain variants preserved as additional URLs on the eventual 1Password item. User cannot edit the primary URL in v1; add that control later if needed.

### Phase 2: Execute deletions

Before doing anything destructive, show a "confirm the damage" review: "You marked 63 accounts for deletion. Want to double-check before we remove them?" A scrollable list of everything queued, with a last-chance "actually, keep this" on each entry.

On confirm, the app removes those accounts (or, more accurately, never imports them into 1Password). For each deleted account, optionally offer to open the account-deletion page on the actual service if the domain is in a known-deletion-URL mapping we maintain. The user can choose to delete the remote account too, or just remove it from their vault.

Target pace: a few minutes, mostly automated.

### Phase 3: Rotate passwords (recommended, opt-in)

After Phase 2 completes, the user has a clean 1Password vault with only the accounts they still use. Phase 3 recommends rotating all of those passwords.

The framing matters: this is not a backlog of items the user flagged during triage. It's a security recommendation applied to everything they kept. Many of these passwords have been sitting in browsers or iCloud for years, potentially weak, reused, or breached. The responsible default is to rotate all of them.

Entry to Phase 3 is opt-in and clearly bounded:

> "Your vault is clean. We recommend changing all 183 passwords you kept. This is the most important step for security, but it takes time. You can do a few today and come back tomorrow. Want to start?"

Two options: "Start rotating" or "Skip for now (I'll do this later)."

If the user skips, all kept items get a `vaultsweep:needs-rotation` tag so the user can return to this phase from the app's main screen at any time. If they start, the tool walks them through one account at a time:

- Open the change-password URL (using the site's `.well-known/change-password` redirect if available, otherwise a domain-to-URL mapping we maintain)
- Generate a strong new password, copy to clipboard
- User submits it on the site
- Capture the new password back into 1Password via `op item edit`
- Remove the `vaultsweep:needs-rotation` tag for that item
- Next account

This phase is explicitly resumable across many sittings. State lives in 1Password itself via the tag. If the user closes the app, opening it again shows: "You have 127 passwords left to rotate. Keep going?"

Pacing note: do not try to push users through all rotations in one session. Default framing is "do a few at a time." Offer an end-of-session summary: "Nice, you rotated 12 passwords. 171 to go. See you next time?"

Note for v4: automated browser-agent rotation becomes an alternative path within Phase 3 rather than a replacement. "Rotate manually" vs "let the agent do them for me" becomes a choice when entering the phase. The three-phase structure does not change when v4 lands.

## MVP scope (v1)

**In scope:**
- Import CSVs from iCloud Keychain, Chrome / Google Passwords, and Arc (multiple profiles)
- Merge and dedupe across sources, with three grouping types: clean merges (silent), subdomain merges (silent with review), and conflicts (user resolves)
- Merge conflict resolution UI with options to combine, keep separate (preserving subdomain identity), or discard
- Review Merges window: optional, skippable step after conflicts where the user can split silently-merged subdomain groups or regroup split-off rows
- Local-only categorization and risk scoring via Gemma 4 E4B on Ollama
- Phase 1: Guided triage wizard, one account at a time, three actions only: Keep / Delete / Skip. No destructive actions yet, no password changes mentioned.
- Phase 2: Confirm-and-execute deletions, with a last-chance review screen. Optional links to service-specific deletion pages.
- Phase 3: Opt-in bulk password rotation recommended for all kept accounts. Walk-through one account at a time, explicitly resumable across many sittings via a `vaultsweep:needs-rotation` tag in 1Password.
- Push kept accounts to 1Password via the `op` CLI, tagged with `migration:<date>`

**Out of scope for v1 (do not build):**
- Fully automated browser-agent password rotation (planned for v3)
- Cloud sync, accounts, or any backend service
- Support for password managers other than 1Password
- Mobile apps
- Anything that requires the helper to write code or edit config files

## Tech stack

- **Shell:** Tauri 2.x. Chosen over Electron for smaller bundle, better security posture for a tool handling credentials, and native webview. Not Electron.
- **Frontend:** React 18 + TypeScript. Vite for dev server.
- **UI components:** shadcn/ui on top of Radix primitives. Components are copied into the repo (not a runtime dependency), which is good for auditability and supply-chain safety in a credential-handling app. Radix handles accessibility (keyboard nav, focus, ARIA) correctly out of the box, which matters for the secondary user.
- **Styling:** Tailwind. Customize the base theme for larger defaults (see UI & visual identity section). Do not fork shadcn base components. Put custom-sized wrappers in `src/components/ui-vaultsweep/` so `pnpm dlx shadcn@latest add` keeps working.
- **Local LLM:** Gemma 4 E4B via Ollama. Apache 2.0 licensed, native function calling for clean JSON output, runs in roughly 4 GB RAM. Assume the user has Ollama running locally on port 11434. If not, the app detects this and guides them through installation. Keep the LLM client abstracted so Gemma 3 4B or another model can be swapped in if the E4B integration hits bugs.
- **1Password integration:** Shell out to the `op` CLI. Do not attempt to reimplement 1Password's encryption or talk to their API directly.
- **State management:** Zustand. No Redux.
- **Testing:** Vitest for unit tests, Playwright for the rare e2e test.

## Architecture

The app has three phases, and data flow is intentionally restricted between them.

### Phase 1: Import and merge (Rust backend)

CSV parsing and merging happens in the Rust layer, not JS. This minimizes the time plaintext passwords spend in the JS heap and the renderer process.

- Each source has a parser that normalizes to a common `RawEntry` struct
- A `Merger` groups entries by (normalized_domain, username) and produces `MergedAccount` records
- The merger emits three types of groupings:
  - **Clean merge:** same registrable domain, same username, same password. Collapsed silently. Common case (e.g., duplicates across sources).
  - **Subdomain merge:** same registrable domain, same username, different subdomains, same password. Collapsed but flagged. "Interesting" subdomain merges (semantically different labels, not just www/mail/accounts) are surfaced in the Review Merges window.
  - **Conflict:** same registrable domain, same username, different passwords. Never silently merged. Surfaced in the merge conflict resolution screen, with options to combine, keep separate, or discard, plus an option to preserve subdomain identity when keeping separate.
- Each `MergedAccount` preserves all source URLs, so split/regroup decisions in the Review Merges window have the full metadata available.
- Output: an in-memory list of `MergedAccount` records. Never written to disk in plaintext.

Domain normalization: strip protocol, strip `www.`, use `publicsuffix` crate to get the registrable domain. "Boring" subdomain labels (www, mail, accounts, login, auth, m, app) are treated as mergeable without surfacing to the user. Everything else is treated as "interesting" and surfaced for review when merged.

### Phase 2: Triage (React frontend + Rust backend)

Frontend queries the backend for accounts one at a time. For each account, the backend:
1. Sends only the domain (and optionally the username pattern) to the local Ollama instance
2. Gets back a category and a "likely still in use" score
3. Checks HIBP for breach status (domain only, k-anonymity for the password hash if checking the password itself)
4. Returns metadata to the frontend

User sees one card, picks an action, frontend tells backend, backend records the decision in in-memory session state. No writes to 1Password or filesystem occur during triage.

Actions (these are all MARKS, not executions; see Session structure):
- **Keep:** Mark for import into 1Password. Executed during the Import step of Phase 3 Architecture.
- **Delete:** Mark for removal. Actual removal happens during Session Phase 2 (confirm-and-execute-deletions), not during triage.
- **Skip:** Decide later. Returns to the queue at the end.

Do not show any password-rotation affordance during Phase 1. Rotation is a recommendation made later, in Session Phase 3, applied to everything the user kept. Mixing rotation into triage confuses the mental model and implies passwords might be changing now.

### Phase 3: Execute decisions

This backend phase maps to Session Phase 2 (execute deletions) and Session Phase 3 (rotate passwords). It has two sub-steps.

**Import step** (runs after the user confirms in Session Phase 2):
- For accounts marked Keep: create items in 1Password via `op item create`, rate-limited
- For accounts marked Delete: do not import. They are never written to the vault.
- All imported items get two tags: `migration:<date>` and `vaultsweep:needs-rotation`
- Run a dedupe pass against existing vault items before creating

Note: every kept item gets the `vaultsweep:needs-rotation` tag by default. This sets up Session Phase 3 as an opt-in bulk rotation recommendation applied to everything kept. If the user completes rotations, the tag is removed per-item.

**Rotation step** (runs during Session Phase 3, can span many sittings):
- Query 1Password for all items with the `vaultsweep:needs-rotation` tag
- For each one, open the change-password URL in the default browser
- User changes the password on the site manually
- Capture the new password from the autofill flow or a paste box
- Update the item via `op item edit`
- Remove the `vaultsweep:needs-rotation` tag

State persistence for rotations lives in 1Password itself via the tag. No separate state file. If the app closes mid-rotation, reopening it queries the vault and picks up where the session left off. If the user skips Phase 3 entirely, the tag persists and they can return later from the app's main screen.

## Security invariants (non-negotiable)

These rules are enforced in code and code review. Any change that weakens them needs a very good reason.

1. **Plaintext passwords never touch the disk** except inside the original user-provided CSVs, which we treat as read-only and remind the user to delete after the session.
2. **Plaintext passwords never leave the machine.** No telemetry. No crash reports that include memory contents. No cloud calls with password data.
3. **The LLM only ever sees domain names and usernames,** never passwords. Even for local Ollama. Prompts are constructed in a dedicated module (`src-tauri/src/llm/prompts.rs`) that takes sanitized input only.
4. **HIBP checks use k-anonymity.** Only the first 5 chars of the SHA-1 hash are sent. Never the full hash or the password.
5. **Memory is zeroized.** Use the `zeroize` crate in Rust for any struct holding a password. Passwords in the JS layer are held only as long as needed to render a masked input and then cleared.
6. **Logs never contain credentials.** The logger has a password-scrubbing filter. Test it.
7. **No remote code loading.** No eval, no dynamic imports from URLs, no updater that pulls and runs arbitrary code without signature verification.

If you're about to write code that touches a password, stop and verify it doesn't violate any of the above.

## Directory structure

```
vaultsweep/
├── src/                          # React frontend
│   ├── components/
│   │   ├── wizard/               # Step-by-step flow
│   │   └── triage/               # The one-account-at-a-time UI
│   ├── hooks/
│   ├── lib/
│   │   └── tauri.ts              # Typed wrappers around invoke()
│   └── main.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri command handlers (the JS-Rust boundary)
│   │   ├── parsers/              # CSV parsers per source
│   │   │   ├── icloud.rs
│   │   │   ├── chrome.rs
│   │   │   └── arc.rs
│   │   ├── merger/               # Dedup and merge logic
│   │   ├── llm/                  # Ollama client + prompts
│   │   ├── op/                   # 1Password CLI wrapper
│   │   ├── hibp/                 # Breach checking
│   │   └── main.rs
│   └── Cargo.toml
├── tests/
└── CLAUDE.md
```

## Common commands

```bash
# Dev
pnpm install
pnpm tauri dev                    # Runs the app with hot reload

# Build
pnpm tauri build                  # Produces a signed bundle

# Test
pnpm test                         # Vitest
cargo test --manifest-path src-tauri/Cargo.toml

# Lint
pnpm lint
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Required runtime tools
ollama serve                      # Gemma 4 E4B must be pulled: `ollama pull gemma4:e4b`
op --version                      # 1Password CLI, must be signed in
```

## Code conventions

- **TypeScript:** Strict mode on. No `any`. No non-null assertions unless commented.
- **Rust:** Prefer `Result` over `panic!`. Use `thiserror` for error types. Use `tracing` for logging.
- **Components:** Function components only. No class components. Props are explicitly typed, no spreading props blindly.
- **Naming:** Components PascalCase, files kebab-case, hooks start with `use`.
- **Accessibility:** Every interactive element has a visible label and a keyboard shortcut. The triage screen must be fully operable without a mouse.
- **Copy:** Write for a semi-technical reader. Translate jargon but don't over-explain. "We couldn't reach the password checker" is fine. "Ollama connection refused on port 11434" is too technical. "We couldn't reach the password checker (a small program called Ollama that helps categorize your accounts)" is too patronizing.

## UX principles (read before building any UI)

1. **One decision per screen during triage.** Do not show a table. Do not show five accounts at once. One card, centered. Density is fine, but the decision is singular.
2. **Keyboard-first for power users.** Every triage action has a one-key shortcut shown on screen. Power users will learn them quickly and fly through. Mouse/trackpad is a fallback, not the primary interaction.
3. **Never ask the user a question they cannot answer.** "Do you still use pinterest.com?" is fine. "Is this a shared vault item?" is not.
4. **Destructive actions are reversible.** "Delete" during triage means "mark for removal, but we'll confirm before actually deleting." Keep an undo stack for the last few decisions.
5. **Errors explain what to do next.** "Ollama isn't running. Start it in your terminal with `ollama serve`, or install it from ollama.com." Technical is fine for semi-technical users, but never a raw stack trace.
6. **Progress is always visible.** "Account 43 of 247" at the top of every triage screen, plus a subtle progress bar.
7. **The app never takes destructive or modifying action without an explicit "let's go" confirmation.** Applies before any deletions in Session Phase 2, before any rotations in Session Phase 3, and before any write to 1Password. Always show exactly what will happen and provide a last-chance opt-out per account where possible.

## UI & visual identity

This section is about the look and feel. UX principles above are about flow and behavior. Both matter and should not contradict each other.

### Accessibility targets

Accessibility matters even when the target user isn't elderly. Visual accessibility benefits everyone, keyboard-first design is faster for power users, and good focus handling is table stakes for a quality desktop app.

- Body text contrast ratio 4.5:1 minimum (WCAG AA). Push to 7:1 (AAA) where it doesn't fight the visual identity.
- Minimum body font size 15px. Primary triage text 17-18px. The slightly smaller defaults vs grandma-mode are fine because semi-technical users can handle density.
- Every interactive element is keyboard-operable. Triage screen is fully usable with just keyboard shortcuts (K, D, C, S, arrow keys, Enter).
- Focus indicators are always visible, never removed with `outline: none` without a replacement.
- Never rely on color alone to convey state. Pair color with icon or text.

### Liquid Glass decision

Apple's Liquid Glass design language (macOS Tahoe 26 and later) is NOT the primary visual style. Reasons:

- Translucency plus blur reduces text legibility, which Apple itself addressed by adding an opaque "tinted" mode. The target user cannot afford this tradeoff.
- Tauri uses the system webview, so Liquid Glass is not available natively. Recreating it in CSS is possible but adds complexity for a style that hurts this audience.
- Cross-platform: Windows and Linux builds would feel inconsistent.

Use Liquid Glass sparingly as chrome only: window vibrancy on macOS via the `tauri-plugin-window-vibrancy` crate for the titlebar and sidebar. Content areas, triage cards, and any surface containing text are solid, high-contrast, and opaque.

### shadcn/ui base theme customization

Before building the first screen, adjust `globals.css` and the Tailwind config:

- Base `font-size: 15-16px` (shadcn default is fine, no need to inflate)
- Default button height: 40px (standard, not oversized)
- Focus ring: 2-3px, high contrast, visible on all backgrounds
- Reduce default border radius slightly for a less "generic AI app" feel
- Keep the density appropriate for a tool, not a landing page

### Distinctive visual identity

shadcn + Tailwind is the most common stack in React right now, which means Claude Code is very productive with it, but default usage produces apps that look like every other AI-generated project. For a product that asks for deep trust, this is a liability.

Pick ONE distinctive decision and commit to it. Do not try to do all three:

1. A non-default color palette (not slate, not blue, not zinc). Consider a warm neutral + one saturated accent.
2. A non-default typeface pairing (not Inter alone, not SF Pro alone). Consider a serif for headings, or a distinctive sans like Söhne, GT America, Instrument Sans.
3. A signature UI motif (e.g., Linear's precise borders, Raycast's soft gradient backgrounds, Notion's playful empty states).

Document the choice at the top of `src/styles/identity.md` so it stays consistent as the app grows.

### Copywriting voice

Warm, direct, competent. Write like a thoughtful tool built by someone who respects the user's time and intelligence. Not corporate, not overly cheerful, not condescending.

- "Couldn't reach the password checker" not "Ollama connection failed" (translate jargon but don't over-explain)
- "Let's go through them" not "Initiating triage flow" (natural, not technical)
- "Come back to this later" not "Decision deferred" (human, not system-speak)
- "You'll need to sign into 1Password first" not "Please authenticate with the 1Password CLI before proceeding"
- Never "Oops!" or "Whoops!" or corporate cheer
- Never apologize with "Sorry!" and an exclamation point. Calm, direct, respectful

Don't over-explain things the user already understands. If they opened a password migration tool, they know what a password manager is. Avoid the trap of treating every user as a total beginner.

### Empty states and error states

These moments define how the product feels. Most apps treat them as afterthoughts. Do not.

Every empty state has: a clear reason, a clear next action, and a human tone. Every error state has: what happened (in plain language), what the user can do, and a way to recover or retry. Never show a stack trace, never show a raw error code without translation.

## Working with external dependencies

- **Ollama:** Assume it may not be installed or running. First-run flow checks for it and links to install instructions. If Gemma 4 E4B is not pulled, offer to pull it with a progress bar.
- **`op` CLI:** Assume it may not be installed, may not be signed in, or may have a different default vault than the user wants. Guide through each case.
- **HIBP:** Respect their rate limits and k-anonymity requirements. Cache responses per session.

## What "done" looks like for v1

A semi-technical user can complete a full migration of 200+ passwords in under an hour for Phases 1 and 2, the resulting 1Password vault is clean and tagged, Phase 3 rotations are resumable across multiple sittings, and at no point did the user need to open a terminal, edit a config file, or read documentation to get unstuck. You've tested this with at least 3 non-engineer users before calling v1 shipped.

## User testing workflow

The builder of this app (you) is significantly more technical than the target user. This creates a systematic risk: you will build things that feel obvious to you and confusing to everyone else. User testing is how you counter this risk.

**Cadence:** Test with at least one semi-technical non-engineer friend or family member after each major flow is built (import, triage, deletions, rotations). Don't wait until the whole app is done. Bugs and UX issues found at 40% complete are cheap to fix; the same issues found at 90% complete are expensive.

**Protocol:** Hand them the app. Tell them the goal ("migrate your passwords to 1Password"). Do not tell them how to use it. Sit silently and watch. Resist the urge to jump in when they get stuck. Note every moment of hesitation, confusion, or wrong turn. Those are bugs.

**What to watch for:**
- Where do they pause and re-read?
- What do they click first on a new screen? Is it what you expected?
- What words do they ask about? ("What does triage mean?")
- Where do they get visibly frustrated or embarrassed?
- Do they trust the app enough to hit the big destructive confirm button, or do they hesitate?

**Red flags that mean something is broken:**
- They ask you a question about how to use the app (the UI should answer it)
- They make a decision they didn't intend to (e.g., accidentally deleted an account they wanted to keep)
- They express surprise at something that happened
- They suggest you "add a tooltip" or "add instructions" (those are bandages for a design problem)

## Future phases (context only, do not build yet)

- **v2:** Support for Bitwarden, Dashlane, LastPass as target managers
- **v3:** Family mode ("sit next to grandma"). Two-person guided flow where a tech-savvy helper operates the app while a less-technical owner makes the decisions. Higher AAA contrast, larger type, softer copy, slower pacing. Mode selector on first launch. This is the more defensible product long-term but needs the v1 solo engine proven first.
- **v4:** AI browser agent for automated bulk password rotation (becomes an option within Session Phase 3: "rotate manually" vs "let the agent do them for me")
- **v5:** "Audit mode" for existing 1Password users to clean up legacy accounts

Anything in future phases is out of scope. If a decision in v1 would make v3 (family mode) significantly harder, note it. Specifically: keep copy in "let's" / "we" voice so it works for both modes, parameterize pacing and density as settings even if only one preset ships in v1, don't hardcode solo assumptions in the state machine.