use std::path::Path;

use super::{find_col, open_reader, opt_str, ParseError, ParseWarning, RawEntry};

/// Parse a Chromium-family password CSV (Chrome, Arc, Brave, Edge, Opera, …).
/// `source` is the display name to tag on each entry, e.g. "Chrome", "Arc – Personal".
pub fn parse_chromium(
    path: &Path,
    source: &str,
) -> Result<(Vec<RawEntry>, Vec<ParseWarning>), ParseError> {
    let (mut rdr, headers) = open_reader(path, false)?;

    for field in &["name", "url", "username", "password"] {
        if find_col(&headers, field).is_none() {
            return Err(ParseError::MissingRequiredField {
                field: field.to_string(),
                path: path.to_path_buf(),
            });
        }
    }

    let idx_name = find_col(&headers, "name").unwrap();
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

        // Keep the password byte-for-byte: leading/trailing whitespace is part of it.
        // Trim only to decide whether the cell is empty.
        let password = record.get(idx_password).unwrap_or("").to_string();
        if password.trim().is_empty() {
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
            title: opt_str(record.get(idx_name).unwrap_or("")),
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
        "chromium parse complete"
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
    fn test_parse_chromium_valid() {
        let f = write_csv(
            "name,url,username,password\nMy Bank,https://bank.com,user@example.com,hunter2\n",
        );
        let (entries, warnings) = parse_chromium(f.path(), "Chrome").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
        let e = &entries[0];
        assert_eq!(e.source, "Chrome");
        assert_eq!(e.title, Some("My Bank".to_string()));
        assert_eq!(e.url, Some("https://bank.com".to_string()));
        assert_eq!(e.username, Some("user@example.com".to_string()));
        assert_eq!(e.password, "hunter2");
        assert!(e.notes.is_none());
        assert!(e.otp_auth.is_none());
    }

    #[test]
    fn test_parse_chromium_caller_supplied_source() {
        let f = write_csv("name,url,username,password\nSite,https://a.com,u,hunter2\n");
        let (entries, _) = parse_chromium(f.path(), "Arc – Personal").unwrap();
        assert_eq!(entries[0].source, "Arc – Personal");
    }

    #[test]
    fn test_parse_chromium_empty_password_row() {
        let f = write_csv(
            "name,url,username,password\nGood,https://a.com,u,hunter2\nBad,https://b.com,u,\n",
        );
        let (entries, warnings) = parse_chromium(f.path(), "Chrome").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].row, 2);
    }

    #[test]
    fn test_parse_chromium_keeps_password_whitespace() {
        let f = write_csv(
            "name,url,username,password\nSite,https://a.com,u, hunter2 \nBlank,https://b.com,u,   \n",
        );
        let (entries, warnings) = parse_chromium(f.path(), "Chrome").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].password, " hunter2 ");
        // A whitespace-only cell still counts as empty.
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].row, 2);
    }

    #[test]
    fn test_parse_chromium_missing_header() {
        let f = write_csv("name,url,username\nSite,https://a.com,u\n");
        let err = parse_chromium(f.path(), "Chrome").unwrap_err();
        assert!(
            matches!(err, ParseError::MissingRequiredField { field, .. } if field == "password")
        );
    }

    #[test]
    fn test_parse_chromium_bom_in_first_header() {
        let mut content = "\u{feff}name,url,username,password\n".to_string();
        content.push_str("Site,https://a.com,u,hunter2\n");
        let f = write_csv(&content);
        let (entries, warnings) = parse_chromium(f.path(), "Chrome").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_chromium_nonexistent_file() {
        let err = parse_chromium(Path::new("/nonexistent/file.csv"), "Chrome").unwrap_err();
        assert!(matches!(err, ParseError::CsvError { .. }));
    }

    #[test]
    fn test_password_redacted_in_debug() {
        let entry = RawEntry {
            source: "Chrome".to_string(),
            title: Some("Bank".to_string()),
            url: None,
            username: Some("user@example.com".to_string()),
            password: "super_secret_pw".to_string(),
            notes: None,
            otp_auth: None,
        };
        let debug_str = format!("{entry:?}");
        assert!(!debug_str.contains("super_secret_pw"));
        assert!(debug_str.contains("[REDACTED]"));
    }
}
