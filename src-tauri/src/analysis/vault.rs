use std::collections::HashMap;
use std::fmt;

use zeroize::Zeroizing;

use crate::merger::MergedAccount;

/// Backend-side copy of every merged password, keyed by `PasswordEntry::password_id`.
///
/// Analysis (HIBP, rotation) reads passwords from here by id, so work items and the
/// events sent back to the frontend only ever carry the id. Values are `Zeroizing`, so
/// they are wiped when replaced, cleared, or dropped.
#[derive(Default)]
pub struct PasswordVault {
    by_id: HashMap<String, Zeroizing<String>>,
}

impl PasswordVault {
    /// Drop (and zeroize) every stored password and load the ones in `accounts`.
    pub fn replace_from(&mut self, accounts: &[MergedAccount]) {
        self.by_id.clear();
        for pw in accounts.iter().flat_map(|a| &a.passwords) {
            self.by_id
                .insert(pw.password_id.clone(), Zeroizing::new(pw.password.clone()));
        }
    }

    pub fn get(&self, password_id: &str) -> Option<&str> {
        self.by_id.get(password_id).map(|p| p.as_str())
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn clear(&mut self) {
        self.by_id.clear();
    }
}

// WARNING: Do not derive Debug — it would print every password.
impl fmt::Debug for PasswordVault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PasswordVault")
            .field("count", &self.by_id.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merger::merge;
    use crate::parsers::RawEntry;

    fn entry(url: &str, username: &str, password: &str) -> RawEntry {
        RawEntry {
            source: "Chrome".to_string(),
            title: None,
            url: Some(url.to_string()),
            username: Some(username.to_string()),
            password: password.to_string(),
            notes: None,
            otp_auth: None,
        }
    }

    #[test]
    fn holds_every_candidate_by_password_id() {
        let accounts = merge(vec![
            entry("https://github.com", "alice", "old-pass"),
            entry("https://github.com", "alice", "new-pass"),
            entry("https://gitlab.com", "bob", "other"),
        ]);
        let mut vault = PasswordVault::default();
        vault.replace_from(&accounts);

        assert_eq!(vault.len(), 3);
        for pw in accounts.iter().flat_map(|a| &a.passwords) {
            assert_eq!(vault.get(&pw.password_id), Some(pw.password.as_str()));
        }
        assert_eq!(vault.get("pw:nope#0"), None);
    }

    #[test]
    fn replace_drops_previous_passwords() {
        let mut vault = PasswordVault::default();
        vault.replace_from(&merge(vec![entry("https://a.com", "alice", "first")]));
        vault.replace_from(&merge(vec![entry("https://b.com", "bob", "second")]));

        assert_eq!(vault.len(), 1);
        assert_eq!(vault.get("pw:acct:a.com|alice#0"), None);
        assert_eq!(vault.get("pw:acct:b.com|bob#0"), Some("second"));
    }

    #[test]
    fn debug_prints_only_the_count() {
        let mut vault = PasswordVault::default();
        vault.replace_from(&merge(vec![entry(
            "https://a.com",
            "alice",
            "ZZ-SENTINEL-9137",
        )]));
        let rendered = format!("{vault:?}");
        assert_eq!(rendered, "PasswordVault { count: 1 }");
    }
}
