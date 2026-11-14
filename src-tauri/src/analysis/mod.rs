//! Backend state for triage enrichment (Architecture Phase 2).
//!
//! One `Arc<AnalysisState>` is managed by Tauri for the whole session. The analysis
//! orchestrator (LLM + HIBP workers, caches, progress) builds on it; for now it holds
//! the password vault and the generation counter that invalidates stale work.

mod vault;

pub use vault::PasswordVault;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use crate::merger::MergedAccount;

/// Maps are behind `std::sync::Mutex`: every critical section is short and synchronous.
/// Never hold one of these guards across an `.await`.
// Debug is safe to derive: the vault's own Debug prints only a count.
#[derive(Debug, Default)]
pub struct AnalysisState {
    /// Bumped on every new merge. Analysis work tagged with an older generation is stale
    /// and must be discarded instead of reported.
    generation: AtomicU64,
    vault: Mutex<PasswordVault>,
}

impl AnalysisState {
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Lock the vault. A poisoned lock is recovered rather than propagated: the vault has
    /// no invariant a panicking holder could have half-broken.
    pub fn vault(&self) -> MutexGuard<'_, PasswordVault> {
        self.vault.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start a new session generation from a fresh merge result: reload the vault from
    /// `accounts` and return the new generation number.
    pub fn load_merge(&self, accounts: &[MergedAccount]) -> u64 {
        self.vault().replace_from(accounts);
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merger::merge;
    use crate::parsers::RawEntry;

    fn entry(password: &str) -> RawEntry {
        RawEntry {
            source: "Chrome".to_string(),
            title: None,
            url: Some("https://github.com".to_string()),
            username: Some("alice".to_string()),
            password: password.to_string(),
            notes: None,
            otp_auth: None,
        }
    }

    #[test]
    fn load_merge_fills_vault_and_bumps_generation() {
        let state = AnalysisState::default();
        assert_eq!(state.generation(), 0);

        let accounts = merge(vec![entry("secret")]);
        assert_eq!(state.load_merge(&accounts), 1);
        assert_eq!(state.generation(), 1);
        assert_eq!(
            state.vault().get("pw:acct:github.com|alice#0"),
            Some("secret")
        );

        assert_eq!(state.load_merge(&merge(vec![entry("newer")])), 2);
        assert_eq!(
            state.vault().get("pw:acct:github.com|alice#0"),
            Some("newer")
        );
    }

    #[test]
    fn debug_does_not_leak_vault_contents() {
        let state = AnalysisState::default();
        state.load_merge(&merge(vec![entry("ZZ-SENTINEL-9137")]));
        let rendered = format!("{state:?}");
        assert!(!rendered.contains("ZZ-SENTINEL-9137"), "{rendered}");
        assert!(rendered.contains("count: 1"), "{rendered}");
    }
}
