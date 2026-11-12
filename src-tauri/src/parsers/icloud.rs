use std::path::Path;

use super::{find_col, open_reader, opt_str, ParseError, ParseWarning, RawEntry};

/// Parse an iCloud Keychain CSV (exported from Passwords.app / Keychain Access).
///
/// Full header row exported by iCloud:
/// Title,URL,Username,Password,Notes,OTPAuth
///
/// Only Title, URL, Username, Password, and Notes are required. NOTE: OTP Auth is optional
pub fn parse_icloud(path: &Path) -> Result<(Vec<RawEntry>, Vec<ParseWarning>), ParseError> {
    let (mut rdr, headers) = open_reader(path, false)?;

    for field in &["Title", "URL", "Username", "Password", "Notes"] {
        if find_col(&headers, field).is_none() {
            return Err(ParseError::MissingRequiredField {
                field: field.to_string(),
                path: path.to_path_buf(),
            });
        }
    }

    let idx_title = find_col(&headers, "Title").unwrap();
    let idx_url = find_col(&headers, "URL").unwrap();
    let idx_username = find_col(&headers, "Username").unwrap();
    let idx_password = find_col(&headers, "Password").unwrap();
    let idx_notes = find_col(&headers, "Notes").unwrap();
    // OTPAuth was added to iCloud exports in macOS Sonoma; older exports omit it.
    let idx_otp = find_col(&headers, "OTPAuth");

    let mut entries: Vec<RawEntry> = Vec::new();
    let mut warnings: Vec<ParseWarning> = Vec::new();

    for (i, result) in rdr.records().enumerate() {
        let row_num = (i + 1) as u64;

        let record = match result {
            Ok(r) => r,
            Err(e) => {
                warnings.push(ParseWarning {
                    source: "icloud".to_string(),
                    row: row_num,
                    message: format!("CSV error: {e} — entry skipped"),
                });
                continue;
            }
        };

        let password = record.get(idx_password).unwrap_or("").trim().to_string();
        if password.is_empty() {
            tracing::debug!(row = row_num, "icloud: skipping row with empty password");
            warnings.push(ParseWarning {
                source: "icloud".to_string(),
                row: row_num,
                message: "password is empty — entry skipped".to_string(),
            });
            continue;
        }

        entries.push(RawEntry {
            source: "icloud".to_string(),
            title: opt_str(record.get(idx_title).unwrap_or("")),
            url: opt_str(record.get(idx_url).unwrap_or("")),
            username: opt_str(record.get(idx_username).unwrap_or("")),
            password,
            notes: opt_str(record.get(idx_notes).unwrap_or("")),
            otp_auth: idx_otp.and_then(|i| opt_str(record.get(i).unwrap_or(""))),
        });
    }

    tracing::debug!(
        entries = entries.len(),
        warnings = warnings.len(),
        "icloud parse complete"
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
    fn test_parse_icloud_valid() {
        let f = write_csv(
            "Title,URL,Username,Password,Notes,OTPAuth\nMy Bank,https://bank.com,user@example.com,hunter2,some note,\n",
        );
        let (entries, warnings) = parse_icloud(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
        let e = &entries[0];
        assert_eq!(e.source, "icloud");
        assert_eq!(e.title, Some("My Bank".to_string()));
        assert_eq!(e.url, Some("https://bank.com".to_string()));
        assert_eq!(e.username, Some("user@example.com".to_string()));
        assert_eq!(e.password, "hunter2");
        assert_eq!(e.notes, Some("some note".to_string()));
        assert!(e.otp_auth.is_none());
    }

    #[test]
    fn test_parse_icloud_otp_auth() {
        let f = write_csv(
            "Title,URL,Username,Password,Notes,OTPAuth\nSite,https://a.com,u,hunter2,,otpauth://totp/Example\n",
        );
        let (entries, _) = parse_icloud(f.path()).unwrap();
        assert_eq!(
            entries[0].otp_auth,
            Some("otpauth://totp/Example".to_string())
        );
    }

    #[test]
    fn test_parse_icloud_empty_password_row() {
        let f = write_csv(
            "Title,URL,Username,Password,Notes,OTPAuth\nGood,https://a.com,u,hunter2,,\nBad,https://b.com,u,,,\n",
        );
        let (entries, warnings) = parse_icloud(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].row, 2);
    }

    #[test]
    fn test_parse_icloud_missing_header() {
        let f = write_csv("Title,URL,Username,Notes,OTPAuth\nSite,https://a.com,u,,\n");
        let err = parse_icloud(f.path()).unwrap_err();
        assert!(
            matches!(err, ParseError::MissingRequiredField { field, .. } if field == "Password")
        );
    }

    #[test]
    fn test_parse_icloud_all_optional_fields_empty() {
        let f = write_csv("Title,URL,Username,Password,Notes,OTPAuth\n,,,hunter2,,\n");
        let (entries, warnings) = parse_icloud(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
        let e = &entries[0];
        assert!(e.title.is_none());
        assert!(e.url.is_none());
        assert!(e.username.is_none());
        assert!(e.notes.is_none());
        assert!(e.otp_auth.is_none());
    }

    #[test]
    fn test_parse_icloud_bom_in_first_header() {
        let mut content = "\u{feff}Title,URL,Username,Password,Notes,OTPAuth\n".to_string();
        content.push_str("Site,https://a.com,u,hunter2,,\n");
        let f = write_csv(&content);
        let (entries, warnings) = parse_icloud(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_icloud_missing_otpauth_column_ok() {
        // Older iCloud exports (pre-Sonoma) don't include the OTPAuth column.
        let f = write_csv("Title,URL,Username,Password,Notes\nSite,https://a.com,u,hunter2,\n");
        let (entries, warnings) = parse_icloud(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(warnings.is_empty());
        assert!(entries[0].otp_auth.is_none());
    }

    #[test]
    fn test_parse_icloud_nonexistent_file() {
        let err = parse_icloud(Path::new("/nonexistent/file.csv")).unwrap_err();
        assert!(matches!(err, ParseError::CsvError { .. }));
    }
}
