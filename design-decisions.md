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
