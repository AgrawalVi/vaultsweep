mod boring_subdomains;

use serde::Serialize;
use std::collections::HashMap;
use std::fmt;
use url::Url;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::parsers::RawEntry;
use boring_subdomains::BORING_SUBDOMAIN_LABELS;

#[derive(Zeroize, ZeroizeOnDrop, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PasswordEntry {
    pub password: String,
    pub source: String,
}

impl fmt::Debug for PasswordEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PasswordEntry")
            .field("password", &"[REDACTED]")
            .field("source", &self.source)
            .finish()
    }
}

// Debug is safe to derive: passwords are Vec<PasswordEntry>, whose own Debug redacts the password field.
#[derive(Debug, Zeroize, ZeroizeOnDrop, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergedAccount {
    pub normalized_domain: String,
    pub username: String,
    pub sources: Vec<String>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub otp_auth: Option<String>,
    pub passwords: Vec<PasswordEntry>,
    pub has_conflict: bool,
    /// All original URLs contributing to this merged account (distinct, insertion-order preserved).
    /// Needed by the Review Merges window to show/split the constituent rows.
    pub all_urls: Vec<String>,
    /// True when two or more distinct subdomains share the same registrable domain + username + password.
    pub is_subdomain_merge: bool,
    /// True when at least one of the merged subdomains is "interesting" (not in the boring set).
    /// Only meaningful when `is_subdomain_merge` is true.
    pub subdomain_is_interesting: bool,
}

/// Extract the subdomain prefix for a URL, relative to its registrable domain.
/// E.g. "https://login.accounts.google.com/foo" with registrable "google.com" → "login.accounts".
/// A leading `www.` is normalised away: `https://www.github.com` → "" (same as the bare domain).
/// Returns an empty string for the bare registrable domain or when parsing fails.
fn extract_subdomain(url_str: &str, registrable: &str) -> String {
    let host = match Url::parse(url_str)
        .ok()
        .and_then(|u| u.host_str().map(str::to_lowercase))
    {
        Some(h) => h,
        None => return String::new(),
    };
    if host == registrable {
        return String::new();
    }
    let sub = host
        .strip_suffix(registrable)
        .and_then(|prefix| prefix.strip_suffix('.'))
        .unwrap_or("");
    // Treat `www` as equivalent to the bare domain.
    if sub == "www" {
        return String::new();
    }
    sub.strip_prefix("www.").unwrap_or(sub).to_string()
}

/// A subdomain is "boring" if it's empty (bare domain) or every dot-separated label
/// is in the boring set. Anything else is "interesting".
fn subdomain_is_boring(sub: &str) -> bool {
    if sub.is_empty() {
        return true;
    }
    sub.split('.').all(|label| BORING_SUBDOMAIN_LABELS.contains(&label))
}

/// Extract the registrable domain from a URL string.
/// E.g. "https://login.accounts.google.com/foo" → "google.com".
/// Returns "no-domain" if the URL is missing, unparseable, or has an unrecognised TLD.
pub(crate) fn normalize_domain(url_str: Option<&str>) -> String {
    let url_str = match url_str {
        Some(s) => s,
        None => return "no-domain".to_string(),
    };

    let host = Url::parse(url_str)
        .ok()
        .and_then(|u| u.host_str().map(str::to_lowercase));

    let host = host.unwrap_or_else(|| return "no-domain".to_string());

    psl::domain(host.as_bytes())
        .and_then(|d| std::str::from_utf8(d.as_bytes()).ok().map(str::to_string))
        .unwrap_or_else(|| {
            // Fallback for unrecognised TLDs: strip leading "www." and return bare host.
            host.strip_prefix("www.").unwrap_or(&host).to_string()
        })
}

/// Merge a flat list of `RawEntry` records into deduplicated `MergedAccount` records.
///
/// Grouping key: (normalized_domain, lowercased username).
/// Entries sharing the same key but with different passwords produce `has_conflict = true`.
pub fn merge(entries: Vec<RawEntry>) -> Vec<MergedAccount> {
    let mut buckets: HashMap<(String, String), Vec<RawEntry>> = HashMap::new();

    for entry in entries {
        let domain = normalize_domain(entry.url.as_deref());
        let username = entry
            .username
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_lowercase();

        buckets.entry((domain, username)).or_default().push(entry);
    }

    buckets
        .into_iter()
        .map(|((normalized_domain, username), entries)| {
            let mut sources: Vec<String> = Vec::new();
            let mut passwords: Vec<PasswordEntry> = Vec::new();
            let mut title: Option<String> = None;
            let mut notes: Option<String> = None;
            let mut otp_auth: Option<String> = None;
            let mut all_urls: Vec<String> = Vec::new();
            let mut subdomains: Vec<String> = Vec::new();

            for entry in entries {
                if !sources.contains(&entry.source) {
                    sources.push(entry.source.clone());
                }
                if title.is_none() {
                    title = entry.title.clone();
                }
                if notes.is_none() {
                    notes = entry.notes.clone();
                }
                if otp_auth.is_none() {
                    otp_auth = entry.otp_auth.clone();
                }

                if let Some(url) = entry.url.as_deref() {
                    if !all_urls.iter().any(|u| u == url) {
                        all_urls.push(url.to_string());
                    }
                    let sub = extract_subdomain(url, &normalized_domain);
                    if !subdomains.iter().any(|s| s == &sub) {
                        subdomains.push(sub);
                    }
                }

                let already_seen = passwords.iter().any(|p| p.password == entry.password);
                if !already_seen {
                    passwords.push(PasswordEntry {
                        password: entry.password.clone(),
                        source: entry.source.clone(),
                    });
                }
            }

            let has_conflict = passwords.len() > 1;
            let is_subdomain_merge = !has_conflict && subdomains.len() > 1;
            let subdomain_is_interesting =
                is_subdomain_merge && subdomains.iter().any(|s| !subdomain_is_boring(s));

            MergedAccount {
                normalized_domain,
                username,
                sources,
                title,
                notes,
                otp_auth,
                passwords,
                has_conflict,
                all_urls,
                is_subdomain_merge,
                subdomain_is_interesting,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(url: &str, username: &str, password: &str, source: &str) -> RawEntry {
        RawEntry {
            source: source.to_string(),
            title: None,
            url: if url.is_empty() {
                None
            } else {
                Some(url.to_string())
            },
            username: if username.is_empty() {
                None
            } else {
                Some(username.to_string())
            },
            password: password.to_string(),
            notes: None,
            otp_auth: None,
        }
    }

    #[test]
    fn same_domain_same_password_merges() {
        let entries = vec![
            make_entry("https://github.com", "alice", "secret", "icloud"),
            make_entry("https://github.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].passwords.len(), 1);
        assert!(!result[0].has_conflict);
        assert_eq!(result[0].sources.len(), 2);
    }

    #[test]
    fn same_domain_different_passwords_flags_conflict() {
        let entries = vec![
            make_entry("https://github.com", "alice", "old-pass", "icloud"),
            make_entry("https://github.com", "alice", "new-pass", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].passwords.len(), 2);
        assert!(result[0].has_conflict);
    }

    #[test]
    fn www_strips_to_root() {
        let entries = vec![
            make_entry("https://www.github.com", "alice", "secret", "icloud"),
            make_entry("https://github.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].normalized_domain, "github.com");
    }

    #[test]
    fn different_usernames_separate() {
        let entries = vec![
            make_entry("https://github.com", "alice", "secret", "icloud"),
            make_entry("https://github.com", "bob", "secret", "icloud"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn no_url_groups_as_no_domain() {
        let entries = vec![
            make_entry("", "alice", "secret", "icloud"),
            make_entry("", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].normalized_domain, "no-domain");
    }

    #[test]
    fn sources_deduplicated() {
        let entries = vec![
            make_entry("https://github.com", "alice", "s1", "icloud"),
            make_entry("https://github.com", "alice", "s2", "icloud"),
        ];
        let result = merge(entries);
        assert_eq!(result[0].sources, vec!["icloud"]);
    }

    #[test]
    fn otp_preserved() {
        let mut entry = make_entry("https://github.com", "alice", "secret", "icloud");
        entry.otp_auth = Some("otpauth://totp/github:alice?secret=JBSWY3DPEHPK3PXP".to_string());
        let result = merge(vec![entry]);
        assert!(result[0].otp_auth.is_some());
    }

    #[test]
    fn subdomain_normalizes_to_root() {
        let entries = vec![
            make_entry(
                "https://login.accounts.google.com",
                "alice",
                "secret",
                "icloud",
            ),
            make_entry("https://mail.google.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].normalized_domain, "google.com");
    }

    #[test]
    fn boring_subdomain_merge_not_interesting() {
        // mail + bare: boring merge, flagged but not interesting.
        let entries = vec![
            make_entry("https://mail.google.com", "alice", "secret", "icloud"),
            make_entry("https://google.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_subdomain_merge);
        assert!(!result[0].subdomain_is_interesting);
    }

    #[test]
    fn www_merges_clean_not_subdomain() {
        // www.github.com + github.com should be a clean merge, not a subdomain merge.
        let entries = vec![
            make_entry("https://www.github.com", "alice", "secret", "icloud"),
            make_entry("https://github.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert!(!result[0].is_subdomain_merge);
        assert!(!result[0].subdomain_is_interesting);
        assert_eq!(result[0].sources.len(), 2);
    }

    #[test]
    fn interesting_subdomain_merge_flagged() {
        // company-a.okta.com vs company-b.okta.com: interesting merge.
        let entries = vec![
            make_entry("https://company-a.okta.com", "alice", "secret", "icloud"),
            make_entry("https://company-b.okta.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_subdomain_merge);
        assert!(result[0].subdomain_is_interesting);
    }

    #[test]
    fn clean_merge_not_subdomain_merge() {
        // Same URL from two sources: clean merge, no subdomain flag.
        let entries = vec![
            make_entry("https://github.com", "alice", "secret", "icloud"),
            make_entry("https://github.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert!(!result[0].is_subdomain_merge);
        assert!(!result[0].subdomain_is_interesting);
    }

    #[test]
    fn conflict_is_not_subdomain_merge() {
        // Different passwords: classified as conflict, subdomain flags stay false.
        let entries = vec![
            make_entry("https://mail.google.com", "alice", "old", "icloud"),
            make_entry("https://accounts.google.com", "alice", "new", "chrome"),
        ];
        let result = merge(entries);
        assert!(result[0].has_conflict);
        assert!(!result[0].is_subdomain_merge);
    }

    #[test]
    fn all_urls_preserved() {
        let entries = vec![
            make_entry("https://mail.google.com", "alice", "secret", "icloud"),
            make_entry("https://accounts.google.com", "alice", "secret", "chrome"),
            make_entry("https://mail.google.com", "alice", "secret", "arc"),
        ];
        let result = merge(entries);
        assert_eq!(result[0].all_urls.len(), 2);
        assert!(result[0]
            .all_urls
            .iter()
            .any(|u| u == "https://mail.google.com"));
        assert!(result[0]
            .all_urls
            .iter()
            .any(|u| u == "https://accounts.google.com"));
    }

    #[test]
    fn username_case_insensitive() {
        let entries = vec![
            make_entry("https://github.com", "Alice", "secret", "icloud"),
            make_entry("https://github.com", "alice", "secret", "chrome"),
        ];
        let result = merge(entries);
        assert_eq!(result.len(), 1);
    }
}
