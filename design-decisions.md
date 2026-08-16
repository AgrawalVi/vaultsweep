# Design decisions

Short log of non-obvious choices made while building features. Append, don't rewrite.

## Merge conflict + Review Merges UI (Milestone pre-5)

### `PasswordEntry.url` added to the Rust `MergedAccount`

The conflict screen needs to show "which subdomain was this password saved under"
per candidate, and "Keep them separate" has to preserve that subdomain URL on
each resulting account. The existing `PasswordEntry { password, source }` lost
that information during merge. Added `url: Option<String>` to `PasswordEntry`
(both Rust and the mirrored TS type) and populated it from `RawEntry::url`
when each distinct password is first encountered. Keeps the "URL per distinct
password" semantics aligned with how the conflict check works (dedup by password).

### No "last updated" timestamp on candidate cards

The spec asks for "when it was last updated in that source, if available." None of
the CSV formats we import (iCloud Keychain, Chrome, Arc) expose a last-modified
timestamp in a reliable or comparable way, and `RawEntry` doesn't carry one
today. Rather than stub a misleading relative time, this pass shows source + URL
only. Revisit once we have real timestamps in the parsers.

### Conflict resolution state shape

`conflictResolutions: Record<number, ConflictResolution>` keyed by the index of
the conflicted account in `rawMergedAccounts`. Resolutions are a tagged union
(`combine | separate | discard`). Applying them produces the working
`mergedAccounts` that downstream screens consume; discarded accounts are stashed
in `discardedAccounts` for Phase 2's deletion review to pick up. The old "pick a
password index" flow was removed wholesale per the spec.

### Review Merges: split/regroup modeled as reshaping `urls` on a row

Every row holds a `urls: string[]` (subset of the underlying merged account's
`allUrls`). Split-all fans one row into `n` one-URL rows. Split-selected peels
selected URLs off into their own rows and leaves the rest in place. Regroup
merges rows with the same `groupKey = ${domain}|${username}`. Because a
subdomain merge by definition shares a single password across all URLs, the row
doesn't need to track per-URL passwords — one `passwords[0]` covers the group.

### Regroup eligibility

Enabled only when ≥2 selected rows share the same `(domain, username)` AND at
least one is a split-off row. This prevents the user from accidentally selecting
two distinct untouched originals (they can't regroup — they were different
accounts to begin with), and keeps the UI faithful to the spec's phrasing
("split-off rows that share the same base domain and username").

### Undo as a simple stack of prior `reviewAccounts` snapshots

Each split/regroup pushes the pre-op snapshot onto `reviewUndoStack` and
replaces `reviewAccounts`. Undo pops. One level is sufficient per the spec
("simple undo stack is sufficient; do not build full multi-level history"), but
the stack approach gives unlimited undo for free without adding complexity.

### Skip semantics: auto-split interesting merges, keep boring ones collapsed

The spec for "Skip this step" was clarified as: split the questionable
(interesting) merges apart but leave clearly-safe (boring) merges collapsed.
This matches the defensive posture the Review Merges window is there to
support: if the user doesn't want to look, don't risk merging two different
workspace-SaaS tenants, but don't uselessly fragment the Google-family groups
either.

### Auto-advance on empty state

When the filtered list is empty (no interesting merges AND the user hasn't
toggled "show all"), we render the "Everything looked clearly separate,
nothing to review" copy and fire `skipReview` on a 1.5s timeout. Auto-advance
uses the same Skip behavior as a manual skip, so the merger state is treated
consistently regardless of path.

### shadcn components used

`radio-group`, `checkbox`, `accordion` (installed but not yet used — we built
expand-in-place with a simple toggle instead of Accordion because we needed
fine control over the row layout and checkboxes above the header; revisit if
we standardize on Accordion across screens), `label`. No custom theming.

### Tests deferred

Per product direction, component tests for the two screens are intentionally
not included in this pass. The Rust merger tests were updated to cover the new
`url` field.

## Test harness

### Pure wizard logic extracted to `src/lib/wizard-logic.ts`

The store's transforms (conflict resolution, review split/regroup, upload naming,
source rewriting) were module-private, so the densest logic in the repo was
untestable. They now live in `wizard-logic.ts` as exported pure functions and the
store actions are thin `set()` wrappers. `regroup` takes an `idSeed` instead of
calling `Date.now()` so it is deterministic under test; the store passes the clock.

### Known bugs are encoded as tests, not skipped

A known defect gets a test that asserts the *correct* behavior, marked `it.fails`
(Vitest) or `#[ignore = "bug: …"]` (Rust). The suite stays green while the bug
exists and the marker turns red the moment someone fixes it — at which point it
becomes an ordinary test. Each marker names its Linear issue.

This supersedes the "Tests deferred" note above.

### Leak assertions use one greppable sentinel

Rust and TS tests both use `ZZ-SENTINEL-9137` as the planted password, so a leak
check is a plain substring search. The Rust log-capture test installs one global
`tracing` subscriber for the whole test binary (thread-local `set_default` raced
under parallel tests), which also means every test in that binary is covered by
the no-sentinel assertion.

## LLM categorization + HIBP breach checks

### HTTP client: reqwest with the `native-tls` backend

reqwest 0.13.2 was already in `Cargo.lock` transitively via tauri, but with no
TLS backend resolved at all — any HTTPS request would have failed at
client-build time with an opaque error. Adding it as an explicit dependency
forces the choice.

Two naming traps worth recording, because both silently produce the wrong
thing:

1. **`rustls-tls` does not exist in 0.13.** That was the 0.12 name. The 0.13
   features are `rustls`, `rustls-no-provider`, and `native-tls` (plus
   `-vendored` / `-no-alpn` variants).
2. **`default-tls` means rustls in 0.13**, the reverse of 0.12 where it meant
   native-tls. Taking the default here would have been a silent switch of
   crypto stack.

Chose `native-tls`: on macOS it is Security.framework, so no new system
dependencies and no bundle growth. The `rustls` feature pulls `aws-lc-rs`,
whose build script requires `cmake` — not installed on the dev machine, and an
avoidable install step for a macOS-first app. Cost of this choice is that a
Linux build would need OpenSSL dev headers; revisit if Linux packaging happens.

Declared with `default-features = false` and the remaining 0.13 defaults
restored by hand (`http2`, `charset`, `system-proxy`) plus `json`.
`system-proxy` is deliberately kept so HIBP still works behind a corporate
proxy; the Ollama client instead calls `.no_proxy()` so a proxy can never
hijack a loopback request. `stream` is *not* enabled — NDJSON reading for
`/api/pull` uses the inherent `Response::chunk()`, which needs no feature.
