//! Have I Been Pwned "Pwned Passwords" range lookups.
//!
//! Answers one question per password: has this exact string appeared in a known
//! breach corpus, and how often. Deliberately *not* the breached-domain API —
//! no API key, no account enumeration, no site-level claims.
//!
//! # Security
//!
//! Invariant 4 (k-anonymity) lives here. The password is hashed locally with
//! SHA-1 and only the **first 5 hex characters** are ever sent. The server
//! returns every suffix sharing that prefix (~800 rows) and the match is made
//! on this machine, so the service cannot tell which password was checked.
//!
//! The seam that enforces it is [`RangeSource`]: its only argument is the
//! 5-char prefix. Nothing downstream of [`check_password`] is handed the
//! suffix, the full hash, or the password. Widening that signature is a
//! review-blocking change.

pub mod client;

use std::fmt;
use std::time::Duration;

use serde::Serialize;
use sha1::{Digest, Sha1};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

/// An uppercase hex SHA-1 digest, split for k-anonymity.
///
/// # Security (invariant 4)
///
/// `prefix` is the ONLY value that may leave the machine. `suffix` completes
/// the digest and must stay local — a full SHA-1 of a password is offline-
/// crackable, so it is treated as credential-adjacent: zeroized on drop and
/// redacted in `Debug`.
// WARNING: Do not derive Debug — suffix must remain REDACTED.
#[derive(Zeroize, ZeroizeOnDrop, Clone)]
pub struct HashSplit {
    /// First 5 hex chars. Safe to transmit.
    pub prefix: String,
    /// Remaining 35 hex chars. Never transmit.
    pub suffix: String,
}

impl fmt::Debug for HashSplit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HashSplit")
            .field("prefix", &self.prefix)
            .field("suffix", &"[REDACTED]")
            .finish()
    }
}

/// Hash `password` and split the digest at the k-anonymity boundary.
///
/// The full digest only ever exists inside a [`Zeroizing`] buffer here.
pub fn split_sha1(password: &str) -> HashSplit {
    let hex = Zeroizing::new(hex::encode_upper(Sha1::digest(password.as_bytes())));
    let (prefix, suffix) = hex.split_at(PREFIX_LEN);
    HashSplit {
        prefix: prefix.to_string(),
        suffix: suffix.to_string(),
    }
}

/// Number of leading hex characters sent to the range API.
const PREFIX_LEN: usize = 5;

/// Whether a password appears in the breach corpus, and how many times.
///
/// `count` is an occurrence count across the corpus, **not** a number of
/// breached sites. Copy that says otherwise is wrong — see `design-decisions.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreachResult {
    pub breached: bool,
    pub count: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum HibpError {
    /// Transport failure — offline, DNS, TLS. Not the service's fault.
    #[error("could not reach the breach service: {0}")]
    Unreachable(String),

    /// Rate limited. `retry_after` is the server's `Retry-After`, when it sends one.
    #[error("breach service rate-limited the request")]
    RateLimited { retry_after: Option<Duration> },

    #[error("breach service returned HTTP {status}")]
    Http { status: u16 },

    #[error("breach service returned an unreadable response")]
    BadResponse,
}

/// Fetches the suffix list for one hash prefix.
///
/// # Security (invariant 4)
///
/// Implementations receive ONLY the 5-char prefix. Never the suffix, never the
/// full hash, never the password. The parameter list is the enforcement — do
/// not add to it.
#[async_trait::async_trait]
pub trait RangeSource: Send + Sync {
    async fn fetch_range(&self, prefix: &str) -> Result<String, HibpError>;
}

/// Check one password against the breach corpus.
///
/// Hashing and matching both happen locally; `src` only sees the prefix.
pub async fn check_password(
    src: &dyn RangeSource,
    password: &str,
) -> Result<BreachResult, HibpError> {
    let split = split_sha1(password);
    let body = src.fetch_range(&split.prefix).await?;
    Ok(match_suffix(&body, &split.suffix))
}

/// Find `suffix` in a range response body.
///
/// Lines are `SUFFIX:COUNT`, uppercase in practice but matched case-
/// insensitively, and CRLF-terminated. When `Add-Padding` is requested the
/// body also carries invented suffixes with a count of `0`; a zero count is
/// therefore treated as "not breached" rather than "breached zero times".
fn match_suffix(body: &str, suffix: &str) -> BreachResult {
    let count = body
        .lines()
        .filter_map(|line| line.trim_end().split_once(':'))
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(suffix))
        .and_then(|(_, count)| count.trim().parse::<u32>().ok())
        .unwrap_or(0);

    BreachResult {
        breached: count > 0,
        count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// SHA-1("password"). The canonical HIBP worked example.
    const PASSWORD_SHA1: &str = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";

    /// A [`RangeSource`] that records every prefix it is handed.
    struct RecordingRange {
        seen: Mutex<Vec<String>>,
        body: String,
    }

    #[async_trait::async_trait]
    impl RangeSource for RecordingRange {
        async fn fetch_range(&self, prefix: &str) -> Result<String, HibpError> {
            self.seen.lock().unwrap().push(prefix.to_string());
            Ok(self.body.clone())
        }
    }

    /// Security test #4 — known-vector anchor for the split.
    #[test]
    fn test_split_sha1_known_vector() {
        let split = split_sha1("password");
        assert_eq!(split.prefix, "5BAA6");
        assert_eq!(split.suffix, "1E4C9B93F3F0682250B6CF8331B7EE68FD8");
        assert_eq!(split.suffix.len(), 35);
        assert_eq!(format!("{}{}", split.prefix, split.suffix), PASSWORD_SHA1);
    }

    /// Security test #1 (invariant 4) — the network layer only ever sees 5 chars.
    #[tokio::test]
    async fn test_only_the_prefix_leaves_the_machine() {
        const SECRET: &str = "correct-horse-battery-staple-92f1";
        let full = hex::encode_upper(Sha1::digest(SECRET.as_bytes()));

        let src = RecordingRange {
            seen: Mutex::new(Vec::new()),
            // Lowercased on purpose: real responses are uppercase, but matching
            // must not depend on it.
            body: format!("{}:7\r\n", full[5..].to_lowercase()),
        };

        let result = check_password(&src, SECRET).await.unwrap();
        assert_eq!(
            result,
            BreachResult {
                breached: true,
                count: 7
            }
        );

        let seen = src.seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "expected exactly one outbound request");
        let sent = &seen[0];

        assert_eq!(sent.len(), 5, "more than 5 characters left the machine");
        assert!(!sent.contains(SECRET), "the password itself was sent");
        assert!(
            !SECRET.contains(sent.as_str()),
            "sent value is a substring of the password"
        );
        assert!(
            full.starts_with(sent.as_str()),
            "sent value is not a prefix of the digest"
        );
        assert_ne!(&full, sent, "the full digest was sent");
    }

    /// Invariant 6 — the completing half of the digest must not reach a log.
    #[test]
    fn test_suffix_redacted_in_debug() {
        let debug_str = format!("{:?}", split_sha1("password"));
        assert!(!debug_str.contains("1E4C9B93F3F0682250B6CF8331B7EE68FD8"));
        assert!(debug_str.contains("[REDACTED]"));
        assert!(debug_str.contains("5BAA6"), "prefix is safe to log");
    }

    /// A padding row (count 0) must not read as a breach.
    #[test]
    fn test_padding_row_is_not_a_breach() {
        let split = split_sha1("password");
        let body = format!("{}:0\r\n", split.suffix);
        assert_eq!(
            match_suffix(&body, &split.suffix),
            BreachResult {
                breached: false,
                count: 0
            }
        );
    }

    #[test]
    fn test_absent_suffix_is_not_a_breach() {
        let split = split_sha1("password");
        let body = "0000000000000000000000000000000000A:12\r\n";
        assert_eq!(
            match_suffix(body, &split.suffix),
            BreachResult {
                breached: false,
                count: 0
            }
        );
    }
}
