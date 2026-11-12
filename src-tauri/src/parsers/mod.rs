pub mod chromium;
pub mod firefox;
pub mod icloud;

use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

// WARNING: Do not derive Debug — password field must remain REDACTED.
#[derive(Zeroize, ZeroizeOnDrop, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// A raw entry from a password CSV file.
pub struct RawEntry {
    pub source: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: String,
    pub notes: Option<String>,
    /// The OTP authentication string for the entry, if any.
    pub otp_auth: Option<String>,
}

impl fmt::Debug for RawEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RawEntry")
            .field("source", &self.source)
            .field("title", &self.title)
            .field("url", &self.url)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("notes", &self.notes)
            .field("otp_auth", &self.otp_auth)
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
/// Errors that can occur when parsing a password CSV file.
pub enum ParseError {
    /// An error that can occur when parsing a password CSV file, usually due to a malformed file.
    #[error("CSV parse error at {path}: {source}")]
    CsvError {
        path: std::path::PathBuf,
        #[source]
        source: csv::Error,
    },

    #[error("Missing required field '{field}' in header of {path}")]
    MissingRequiredField {
        field: String,
        path: std::path::PathBuf,
    },
}

#[derive(Debug, Serialize, Clone)]
/// A warning that can occur when parsing a password CSV file.
pub struct ParseWarning {
    /// The source of the warning (e.g. "chromium", "firefox", "icloud").
    pub source: String,
    pub row: u64,
    pub message: String,
}

pub(crate) fn opt_str(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Strip UTF-8 BOM from the first header field (Passwords.app and Chrome sometimes emit one).
pub(crate) fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

/// Open a CSV reader and return it along with a clone of the header row.
/// `flexible` controls whether ragged rows are tolerated (use `true` for Firefox, `false` otherwise).
pub(crate) fn open_reader(
    path: &std::path::Path,
    flexible: bool,
) -> Result<(csv::Reader<std::fs::File>, csv::StringRecord), ParseError> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(flexible)
        .from_path(path)
        .map_err(|e| ParseError::CsvError {
            path: path.to_path_buf(),
            source: e,
        })?;
    let headers = rdr
        .headers()
        .map_err(|e| ParseError::CsvError {
            path: path.to_path_buf(),
            source: e,
        })?
        .clone();
    Ok((rdr, headers))
}

/// Find the index of a column by name, stripping a UTF-8 BOM from the first header if present.
pub(crate) fn find_col(headers: &csv::StringRecord, name: &str) -> Option<usize> {
    headers
        .iter()
        .enumerate()
        .find(|(_, h)| strip_bom(h).trim() == name)
        .map(|(i, _)| i)
}
