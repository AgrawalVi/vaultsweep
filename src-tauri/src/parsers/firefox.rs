use std::path::Path;

use super::{find_col, open_reader, opt_str, ParseError, ParseWarning, RawEntry};

/// Parse a Firefox-family password CSV (Firefox, Waterfox, LibreWolf, Floorp, …).
/// `source` is the display name to tag on each entry, e.g. "Firefox", "Waterfox".
///
/// Full header row exported by Firefox:
/// url, username, password, httpRealm, formActionOrigin, guid,
/// timeCreated, timeLastUsed, timePasswordChanged
///
/// Only url, username, and password are required; all other columns are ignored.
pub fn parse_firefox(
    path: &Path,
    source: &str,
) -> Result<(Vec<RawEntry>, Vec<ParseWarning>), ParseError> {
    // flexible(true): Firefox metadata columns may vary across versions; tolerate extras/missing.
    let (mut rdr, headers) = open_reader(path, true)?;

    // Only these three are required; the rest are metadata we don't use.
    for field in &["url", "username", "password"] {
        if find_col(&headers, field).is_none() {
            return Err(ParseError::MissingRequiredField {
                field: field.to_string(),
                path: path.to_path_buf(),
            });
        }
    }

    let idx_url = find_col(&headers, "url").unwrap();
    let idx_username = find_col(&headers, "username").unwrap();
    let idx_password = find_col(&headers, "password").unwrap();

    let mut entries: Vec<RawEntry> = Vec::new();
    let mut warnings: Vec<ParseWarning> = Vec::new();

    for (i, result) in rdr.records().enumerate() {
        let row_num = (i + 1) as u64;

        let record = match result {
            Ok(r) => r,
            Err(e) => {
                warnings.push(ParseWarning {
                    source: source.to_string(),
                    row: row_num,
                    message: format!("CSV error: {e} — entry skipped"),
                });
                continue;
            }
        };

        let password = record.get(idx_password).unwrap_or("").trim().to_string();
        if password.is_empty() {
            tracing::debug!(row = row_num, source, "skipping row with empty password");
            warnings.push(ParseWarning {
                source: source.to_string(),
                row: row_num,
                message: "password is empty — entry skipped".to_string(),
            });
            continue;
        }

        entries.push(RawEntry {
            source: source.to_string(),
            // Firefox has no display-name column; title is derived downstream from the URL.
            title: None,
            url: opt_str(record.get(idx_url).unwrap_or("")),
            username: opt_str(record.get(idx_username).unwrap_or("")),
            password,
            notes: None,
            otp_auth: None,
        });
    }

    tracing::debug!(
        source,
        entries = entries.len(),
        warnings = warnings.len(),
        "firefox parse complete"
    );

    Ok((entries, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_csv(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f
    }

    #[test]
    fn test_parse_firefox_valid() {
        let f = write_csv(
            "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\n\
             https://bank.com,user@example.com,hunter2,,https://bank.com,{abc},1000,2000,3000\n",
        );
        let (entries, warnings) = parse_firefox(f.path(), "Firefox").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
        let e = &entries[0];
        assert_eq!(e.source, "Firefox");
        assert_eq!(e.url, Some("https://bank.com".to_string()));
        assert_eq!(e.username, Some("user@example.com".to_string()));
        assert_eq!(e.password, "hunter2");
        assert!(e.title.is_none());
        assert!(e.notes.is_none());
        assert!(e.otp_auth.is_none());
    }

    #[test]
    fn test_parse_firefox_caller_supplied_source() {
        let f = write_csv("url,username,password\nhttps://a.com,u,hunter2\n");
        let (entries, _) = parse_firefox(f.path(), "Waterfox").unwrap();
        assert_eq!(entries[0].source, "Waterfox");
    }

    #[test]
    fn test_parse_firefox_minimal_headers() {
        // Just the three required columns — no metadata.
        let f = write_csv("url,username,password\nhttps://a.com,u,hunter2\n");
        let (entries, warnings) = parse_firefox(f.path(), "Firefox").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_firefox_metadata_cols_ignored() {
        // Extra columns beyond the standard set should not cause errors.
        let f = write_csv(
            "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged,unknown_future_col\n\
             https://a.com,u,hunter2,,,,,,,extra\n",
        );
        let (entries, warnings) = parse_firefox(f.path(), "Firefox").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_firefox_empty_password_row() {
        let f = write_csv("url,username,password\nhttps://a.com,u,hunter2\nhttps://b.com,u,\n");
        let (entries, warnings) = parse_firefox(f.path(), "Firefox").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].row, 2);
    }

    #[test]
    fn test_parse_firefox_missing_required_header() {
        let f = write_csv("url,username\nhttps://a.com,u\n");
        let err = parse_firefox(f.path(), "Firefox").unwrap_err();
        assert!(
            matches!(err, ParseError::MissingRequiredField { field, .. } if field == "password")
        );
    }

    #[test]
    fn test_parse_firefox_bom_in_first_header() {
        let mut content = "\u{feff}url,username,password\n".to_string();
        content.push_str("https://a.com,u,hunter2\n");
        let f = write_csv(&content);
        let (entries, warnings) = parse_firefox(f.path(), "Firefox").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
    }
}
