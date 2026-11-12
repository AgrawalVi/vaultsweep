//! Tests for the security invariants in CLAUDE.md that are assertable against the code
//! as it stands today.
//!
//! Invariant 6 ("Logs never contain credentials. Test it.") is the one the product spec
//! orders by name.

use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};

use tempfile::TempDir;
use zeroize::ZeroizeOnDrop;

use vaultsweep_lib::commands::parser::{merge_entries, parse_csvs};
use vaultsweep_lib::commands::{BrowserFormat, ImportTarget};
use vaultsweep_lib::merger::{MergedAccount, PasswordEntry};
use vaultsweep_lib::parsers::RawEntry;

/// Distinctive enough that a substring match cannot be a coincidence.
const SENTINEL: &str = "ZZ-SENTINEL-9137";

// ------------------------------------------------------------- log capture

/// A `MakeWriter` that appends everything the subscriber emits to a shared buffer.
#[derive(Clone, Default)]
struct CapturedLog(Arc<Mutex<Vec<u8>>>);

impl CapturedLog {
    fn contents(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
    fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

/// Capture is installed once, process-wide, rather than per-test.
///
/// `tracing::subscriber::set_default` is scoped to the calling thread, and with tests
/// running in parallel the events raced against it — the capture came up empty depending
/// on scheduling. A single global subscriber is deterministic. It also strengthens the
/// assertion: the buffer accumulates logging from *every* test in this binary, so the
/// no-sentinel check covers all of them, not just the one below.
fn captured_log() -> &'static CapturedLog {
    static CAPTURED: OnceLock<CapturedLog> = OnceLock::new();
    CAPTURED.get_or_init(|| {
        let captured = CapturedLog::default();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(captured.clone())
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .finish();
        tracing::subscriber::set_global_default(subscriber)
            .expect("no other global subscriber should be installed");
        captured
    })
}

impl Write for CapturedLog {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLog {
    type Writer = CapturedLog;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// Write a CSV holding the sentinel password into a fresh temp dir.
fn sentinel_csv(dir: &TempDir) -> String {
    let path = dir.path().join("sentinel.csv");
    let body = format!(
        "name,url,username,password\n\
         Sentinel Site,https://sentinel.example.com,user@example.com,{SENTINEL}\n\
         Second Site,https://other.example.com,user@example.com,{SENTINEL}\n"
    );
    std::fs::write(&path, body).unwrap();
    path.to_string_lossy().into_owned()
}

fn sentinel_target(path: String) -> ImportTarget {
    ImportTarget {
        format: BrowserFormat::Chromium,
        name: "Chrome".to_string(),
        path,
    }
}

#[test]
fn logs_never_contain_a_password() {
    let dir = TempDir::new().unwrap();
    let path = sentinel_csv(&dir);

    let captured = captured_log();
    let before = captured.len();

    let result = parse_csvs(vec![sentinel_target(path)]);
    assert_eq!(result.entries.len(), 2, "fixture should have parsed");
    let accounts = merge_entries(result.entries);
    assert!(!accounts.is_empty());

    let logs = captured.contents();
    assert!(
        logs.len() > before,
        "nothing was captured — the test proves nothing"
    );
    assert!(
        !logs.contains(SENTINEL),
        "a password reached the logs:\n{logs}"
    );
}

// ------------------------------------------------------------- Debug redaction

fn sentinel_entry() -> RawEntry {
    RawEntry {
        source: "Chrome".to_string(),
        title: Some("Sentinel".to_string()),
        url: Some("https://sentinel.example.com".to_string()),
        username: Some("user@example.com".to_string()),
        password: SENTINEL.to_string(),
        notes: None,
        otp_auth: None,
    }
}

/// Control for the redaction tests below. They all assert "the rendering does not contain
/// SENTINEL" — which would also pass if the rendering were empty, or if the sentinel never
/// made it into the struct. This proves the detector fires on an actual leak, so a green
/// redaction test means redaction, not a vacuous assertion.
#[test]
fn the_leak_detector_catches_an_unredacted_debug_impl() {
    #[derive(Debug)]
    // check-debug-derive: allow (control: this type must leak)
    #[allow(dead_code)]
    struct Unredacted {
        password: String,
    }

    let rendered = format!(
        "{:?}",
        Unredacted {
            password: SENTINEL.to_string(),
        }
    );
    assert!(rendered.contains(SENTINEL));
}

#[test]
fn raw_entry_debug_redacts_the_password() {
    let rendered = format!("{:?}", sentinel_entry());
    assert!(
        !rendered.contains(SENTINEL),
        "RawEntry Debug leaked: {rendered}"
    );
    assert!(rendered.contains("[REDACTED]"));
    // The non-secret fields should still be there, or the impl is useless for debugging.
    assert!(rendered.contains("sentinel.example.com"));
}

#[test]
fn password_entry_debug_redacts_the_password() {
    let entry = PasswordEntry {
        password: SENTINEL.to_string(),
        source: "Chrome".to_string(),
        url: Some("https://sentinel.example.com".to_string()),
    };
    let rendered = format!("{entry:?}");
    assert!(
        !rendered.contains(SENTINEL),
        "PasswordEntry Debug leaked: {rendered}"
    );
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn merged_account_debug_redacts_transitively() {
    // MergedAccount *derives* Debug — it is only safe because every PasswordEntry it
    // holds redacts itself. This test is what keeps that true.
    let accounts = merge_entries(vec![sentinel_entry()]);
    let rendered = format!("{accounts:?}");
    assert!(
        !rendered.contains(SENTINEL),
        "MergedAccount Debug leaked: {rendered}"
    );
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn parse_result_debug_redacts_transitively() {
    let dir = TempDir::new().unwrap();
    let result = parse_csvs(vec![sentinel_target(sentinel_csv(&dir))]);
    let rendered = format!("{result:?}");
    assert!(
        !rendered.contains(SENTINEL),
        "ParseResult Debug leaked: {rendered}"
    );
}

// ------------------------------------------------------------- zeroize

#[test]
fn credential_structs_zeroize_on_drop() {
    // A compile-time assertion: this stops compiling the moment a derive is dropped.
    fn assert_zeroize_on_drop<T: ZeroizeOnDrop>() {}

    assert_zeroize_on_drop::<RawEntry>();
    assert_zeroize_on_drop::<PasswordEntry>();
    assert_zeroize_on_drop::<MergedAccount>();
}

// ------------------------------------------------------------- read-only parsing

/// Every file in `dir`, as (relative path, bytes, modified time).
fn snapshot(dir: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>, std::time::SystemTime)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let meta = entry.metadata().unwrap();
        if meta.is_file() {
            out.push((
                entry.path(),
                std::fs::read(entry.path()).unwrap(),
                meta.modified().unwrap(),
            ));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[test]
fn parsing_never_writes_to_disk() {
    let dir = TempDir::new().unwrap();
    let path = sentinel_csv(&dir);

    let before = snapshot(dir.path());
    let result = parse_csvs(vec![sentinel_target(path)]);
    let _accounts = merge_entries(result.entries);
    let after = snapshot(dir.path());

    assert_eq!(before.len(), 1, "expected exactly the input CSV");
    assert_eq!(
        before, after,
        "the parse/merge pass altered the directory — no file may be created or modified"
    );
}

#[test]
fn a_failed_parse_leaves_no_debris_behind() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("broken.csv");
    // Header without the required `password` column.
    std::fs::write(&path, "name,url,username\nA,https://a.com,me\n").unwrap();

    let before = snapshot(dir.path());
    let result = parse_csvs(vec![sentinel_target(path.to_string_lossy().into_owned())]);
    assert_eq!(
        result.errors.len(),
        1,
        "the fixture should have failed to parse"
    );
    assert_eq!(before, snapshot(dir.path()));
}

// ------------------------------------------------------------- error messages

#[test]
fn parse_errors_never_quote_a_password() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("nopassword.csv");
    // A valid-looking row whose header lacks `password`, so the error path runs while the
    // sentinel is present in the file body.
    std::fs::write(
        &path,
        format!("name,url,username\nSentinel,https://a.com,{SENTINEL}\n"),
    )
    .unwrap();

    let result = parse_csvs(vec![sentinel_target(path.to_string_lossy().into_owned())]);
    assert_eq!(result.errors.len(), 1);
    assert!(
        !result.errors[0].message.contains(SENTINEL),
        "error message leaked file contents: {}",
        result.errors[0].message
    );
}
