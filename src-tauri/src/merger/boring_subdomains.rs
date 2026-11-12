//! Subdomain labels considered "boring" for the purposes of the Review Merges window.
//!
//! A merge with same registrable domain + same username + same password across entries is
//! classified as a "subdomain merge" when it involves more than one distinct subdomain. If
//! EVERY merged subdomain is boring (either empty/bare or composed only of labels in this list),
//! the merge is hidden by default in the Review Merges window — the user doesn't need to see
//! `mail.google.com` and `accounts.google.com` grouped together because that's expected.
//!
//! Anything NOT in this list is treated as "interesting" and surfaced for review, because it's
//! likely to be a semantically different subdomain (e.g. `company-a.okta.com` vs
//! `company-b.okta.com`).
//!
//! Note: `www` is handled separately in `extract_subdomain` — it is stripped entirely and
//! treated as identical to the bare domain, so a www-vs-bare merge counts as a clean merge,
//! not a subdomain merge. Do not add `www` to this list.
//!
//! Add new labels here as user testing surfaces them. One label per line so diffs stay clean.

pub const BORING_SUBDOMAIN_LABELS: &[&str] = &[
    // --- Auth / account portals ---
    "myaccount",
    "accounts",
    "account",
    "account2",
    "profile",
    "oauth",
    "auth",
    "login",
    "signin",
    "signup",
    "sso",
    "id",
    "identity",
    "reg",
    // --- Mail ---
    "mail",
    "webmail",
    // --- Generic "the app" / "the web app" ---
    "app",
    "apps",
    "web",
    "portal",
    "dashboard",
    "my",
    "home",
    "online",
    // --- Mobile ---
    "m",
    "mobile",
    // --- Security / access ---
    "secure",
    "secure1",
    "secure2",
    "secure3",
    "secure4",
    "ssl",
    // --- Support / help ---
    "help",
    "support",
    // --- E-Commerce ---
    "pay",
    "checkout",
    "store",
    "shop",
    // --- Apple ---
    "idmsa",
    "appleid",
    // --- API / static / content delivery (rarely a login URL but safe to treat as same-org) ---
    "api",
    "ws",
    "static",
    "cdn",
    "assets",
    "services",
    "verified",
];
