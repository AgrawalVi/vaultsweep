//! Integration tests over the real `parse_csvs` command and the merger, driven by the
//! CSV fixtures in `tests/fixtures/`.
//!
//! `parse_csvs` and `merge_entries` are plain sync functions with no `AppHandle` or
//! `State` argument, so `#[tauri::command]` leaves them directly callable — these tests
//! need no Tauri runtime.

mod common;

use common::target;
use vaultsweep_lib::commands::parser::parse_csvs;
use vaultsweep_lib::commands::BrowserFormat;
use vaultsweep_lib::merger::{merge, MergedAccount};
use vaultsweep_lib::parsers::RawEntry;

/// `merge()` collects out of a HashMap, so its output order is not deterministic.
/// Every multi-account assertion sorts first.
fn sorted(mut accounts: Vec<MergedAccount>) -> Vec<MergedAccount> {
    accounts.sort_by(|a, b| {
        (&a.normalized_domain, &a.username).cmp(&(&b.normalized_domain, &b.username))
    });
    accounts
}

fn passwords_of(account: &MergedAccount) -> Vec<&str> {
    account
        .passwords
        .iter()
        .map(|p| p.password.as_str())
        .collect()
}

fn find<'a>(accounts: &'a [MergedAccount], username: &str) -> &'a MergedAccount {
    accounts
        .iter()
        .find(|a| a.username == username)
        .unwrap_or_else(|| panic!("no account for username {username:?}"))
}

// ---------------------------------------------------------------- iCloud

#[test]
fn icloud_valid_parses_every_row() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Icloud,
        "Safari",
        "icloud_valid.csv",
    )]);

    assert!(
        result.errors.is_empty(),
        "unexpected errors: {:?}",
        result.errors
    );
    assert!(result.warnings.is_empty());
    assert_eq!(result.entries.len(), 3);

    let bank = &result.entries[0];
    assert_eq!(bank.title.as_deref(), Some("My Bank"));
    assert_eq!(bank.url.as_deref(), Some("https://bank.example.com"));
    assert_eq!(bank.username.as_deref(), Some("user@example.com"));
    assert_eq!(bank.password, "hunter2");
    assert_eq!(bank.notes.as_deref(), Some("Banking account"));
    assert_eq!(bank.otp_auth, None);

    // iCloud hardcodes its own source label rather than taking the display name.
    assert!(result.entries.iter().all(|e| e.source == "icloud"));
}

#[test]
fn icloud_preserves_the_otpauth_column() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Icloud,
        "Safari",
        "icloud_valid.csv",
    )]);
    let social = &result.entries[1];
    assert_eq!(
        social.otp_auth.as_deref(),
        Some("otpauth://totp/Social:user@example.com?secret=JBSWY3DPEHPK3PXP")
    );
}

#[test]
fn icloud_skips_empty_passwords_and_warns_with_the_data_row_number() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Icloud,
        "Safari",
        "icloud_empty_pw.csv",
    )]);

    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.warnings.len(), 1);
    // Row 2 of the *data*, header excluded.
    assert_eq!(result.warnings[0].row, 2);
    assert_eq!(result.warnings[0].source, "icloud");
    assert!(result.warnings[0].message.contains("empty"));
    assert!(result.errors.is_empty());
}

#[test]
fn a_missing_required_header_becomes_a_source_error_not_a_panic() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Icloud,
        "Safari",
        "icloud_missing_hdr.csv",
    )]);

    assert!(result.entries.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].source, "Safari");
    assert!(
        result.errors[0].message.contains("Password"),
        "error should name the missing column, got {:?}",
        result.errors[0].message
    );
}

// ---------------------------------------------------------------- Chromium

#[test]
fn chromium_takes_its_source_label_from_the_target_name() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Chromium,
        "Arc – Personal",
        "chromium_valid.csv",
    )]);

    assert_eq!(result.entries.len(), 3);
    assert!(result.entries.iter().all(|e| e.source == "Arc – Personal"));
    assert_eq!(result.entries[0].title.as_deref(), Some("My Bank"));
    // Chromium exports carry neither notes nor OTP.
    assert!(result.entries.iter().all(|e| e.notes.is_none()));
    assert!(result.entries.iter().all(|e| e.otp_auth.is_none()));
}

#[test]
fn a_ragged_chromium_row_is_a_warning_and_the_rest_of_the_file_still_loads() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Chromium,
        "Chrome",
        "chromium_ragged.csv",
    )]);

    // The short row is dropped; the good rows on either side survive.
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].title.as_deref(), Some("Good Entry"));
    assert!(!result.warnings.is_empty(), "ragged row should warn");
    assert!(
        result.errors.is_empty(),
        "a ragged row must not fail the whole file: {:?}",
        result.errors
    );
}

// ---------------------------------------------------------------- Firefox

#[test]
fn firefox_reads_the_three_columns_it_needs_and_ignores_the_metadata() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Firefox,
        "Firefox",
        "firefox_valid.csv",
    )]);

    assert!(result.errors.is_empty());
    assert_eq!(result.entries.len(), 2);
    let first = &result.entries[0];
    assert_eq!(first.url.as_deref(), Some("https://bank.example.com"));
    assert_eq!(first.username.as_deref(), Some("user@example.com"));
    assert_eq!(first.password, "hunter2");
    assert_eq!(first.source, "Firefox");
    // Firefox exports have no title column; it is derived downstream from the URL.
    assert!(result.entries.iter().all(|e| e.title.is_none()));
}

#[test]
fn firefox_skips_empty_passwords() {
    let result = parse_csvs(vec![target(
        BrowserFormat::Firefox,
        "Firefox",
        "firefox_empty_pw.csv",
    )]);

    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.warnings.len(), 1);
    assert_eq!(result.warnings[0].row, 2);
}

// ---------------------------------------------------------------- batching

#[test]
fn several_targets_concatenate_in_order() {
    let result = parse_csvs(vec![
        target(
            BrowserFormat::Chromium,
            "Arc – Personal",
            "arc_profile_a.csv",
        ),
        target(BrowserFormat::Chromium, "Arc – Work", "arc_profile_b.csv"),
    ]);

    assert!(result.errors.is_empty());
    assert_eq!(result.entries.len(), 4);
    assert_eq!(
        result
            .entries
            .iter()
            .map(|e| e.source.as_str())
            .collect::<Vec<_>>(),
        [
            "Arc – Personal",
            "Arc – Personal",
            "Arc – Work",
            "Arc – Work"
        ]
    );
}

#[test]
fn one_bad_file_does_not_abort_the_batch() {
    let result = parse_csvs(vec![
        target(BrowserFormat::Icloud, "Broken", "icloud_missing_hdr.csv"),
        target(BrowserFormat::Chromium, "Chrome", "chromium_valid.csv"),
    ]);

    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].source, "Broken");
    assert_eq!(result.entries.len(), 3, "the good file must still load");
}

#[test]
fn a_nonexistent_path_is_reported_as_a_source_error() {
    let mut t = target(BrowserFormat::Chromium, "Ghost", "chromium_valid.csv");
    t.path.push_str(".missing");
    let result = parse_csvs(vec![t]);

    assert!(result.entries.is_empty());
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].source, "Ghost");
}

#[test]
fn an_empty_target_list_yields_an_empty_result() {
    let result = parse_csvs(vec![]);
    assert!(result.entries.is_empty());
    assert!(result.warnings.is_empty());
    assert!(result.errors.is_empty());
}

// ---------------------------------------------------------------- parse → merge

#[test]
fn two_arc_profiles_keep_their_distinct_usernames_apart() {
    // Both profiles hold mail.example.com, under different usernames. The merger keys on
    // (registrable domain, username), so these must never collapse into one account.
    let result = parse_csvs(vec![
        target(
            BrowserFormat::Chromium,
            "Arc – Personal",
            "arc_profile_a.csv",
        ),
        target(BrowserFormat::Chromium, "Arc – Work", "arc_profile_b.csv"),
    ]);
    let accounts = sorted(merge(result.entries));

    assert_eq!(accounts.len(), 2);
    let personal = find(&accounts, "personal@example.com");
    let work = find(&accounts, "work@example.com");

    // Both fixtures normalize to the same registrable domain — only the username splits them.
    assert_eq!(personal.normalized_domain, "example.com");
    assert_eq!(work.normalized_domain, "example.com");
    assert_eq!(personal.sources, ["Arc – Personal"]);
    assert_eq!(work.sources, ["Arc – Work"]);
}

#[test]
fn the_same_account_from_two_sources_merges_and_unions_its_sources() {
    // chromium_valid and icloud_valid carry identical (url, username, password) triples.
    let result = parse_csvs(vec![
        target(BrowserFormat::Chromium, "Chrome", "chromium_valid.csv"),
        target(BrowserFormat::Icloud, "Safari", "icloud_valid.csv"),
    ]);
    assert_eq!(result.entries.len(), 6);

    let accounts = sorted(merge(result.entries));
    let shared = find(&accounts, "user@work.example.com");

    assert_eq!(
        shared.sources,
        ["Chrome", "icloud"],
        "both sources should be recorded"
    );
    assert_eq!(passwords_of(shared), ["staple-battery-horse"]);
    assert!(
        !shared.has_conflict,
        "identical passwords must not conflict"
    );
}

#[test]
fn differing_passwords_under_one_key_surface_as_a_conflict() {
    // Within arc_profile_a, bank and mail share (example.com, personal@example.com) but
    // hold different passwords.
    let result = parse_csvs(vec![target(
        BrowserFormat::Chromium,
        "Arc – Personal",
        "arc_profile_a.csv",
    )]);
    let accounts = merge(result.entries);

    assert_eq!(accounts.len(), 1);
    let account = &accounts[0];
    assert!(account.has_conflict);

    let mut pws = passwords_of(account);
    pws.sort_unstable();
    assert_eq!(pws, ["correct-horse", "hunter2"]);

    // Each candidate keeps the URL it was saved under, so the conflict UI can label them.
    let urls: Vec<_> = account
        .passwords
        .iter()
        .filter_map(|p| p.url.as_deref())
        .collect();
    assert_eq!(urls.len(), 2);
    assert!(urls.contains(&"https://bank.example.com"));
}

#[test]
fn merging_an_empty_entry_list_yields_no_accounts() {
    assert!(merge(Vec::<RawEntry>::new()).is_empty());
}
