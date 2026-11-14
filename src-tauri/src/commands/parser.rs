use std::path::Path;
use std::sync::Arc;

use crate::analysis::AnalysisState;
use crate::merger::MergedAccount;
use crate::parsers::RawEntry;

use crate::parsers::{chromium::parse_chromium, firefox::parse_firefox, icloud::parse_icloud};

use super::{BrowserFormat, ImportTarget, ParseResult, SourceError};

/// Parse one or more password CSV files from any supported browser family.
///
/// Returns a ParseResult that always succeeds at the Tauri boundary — individual
/// source failures are degraded to `errors` so one bad file doesn't block the rest.
#[tauri::command]
pub fn parse_csvs(targets: Vec<ImportTarget>) -> ParseResult {
    let mut all_entries = Vec::new();
    let mut all_warnings = Vec::new();
    let mut all_errors: Vec<SourceError> = Vec::new();

    for target in &targets {
        let path = Path::new(&target.path);

        let result = match target.format {
            BrowserFormat::Icloud => parse_icloud(path),
            BrowserFormat::Chromium => parse_chromium(path, &target.name),
            BrowserFormat::Firefox => parse_firefox(path, &target.name),
        };

        match result {
            Ok((mut entries, mut warnings)) => {
                all_entries.append(&mut entries);
                all_warnings.append(&mut warnings);
            }
            Err(e) => {
                all_errors.push(SourceError {
                    source: target.name.clone(),
                    message: e.to_string(),
                });
            }
        }
    }

    tracing::info!(
        entry_count = all_entries.len(),
        warning_count = all_warnings.len(),
        error_count = all_errors.len(),
        "parse_csvs completed"
    );

    ParseResult {
        entries: all_entries,
        warnings: all_warnings,
        errors: all_errors,
    }
}

#[tauri::command]
pub fn merge_entries(
    state: tauri::State<'_, Arc<AnalysisState>>,
    entries: Vec<RawEntry>,
) -> Vec<MergedAccount> {
    merge_into(&state, entries)
}

/// The body of `merge_entries`, minus the Tauri wrapper so tests can call it directly.
/// Merges, then loads every password into the backend vault under a new generation.
pub fn merge_into(state: &AnalysisState, entries: Vec<RawEntry>) -> Vec<MergedAccount> {
    let result = crate::merger::merge(entries);
    let generation = state.load_merge(&result);
    tracing::info!(
        account_count = result.len(),
        vault_count = state.vault().len(),
        generation,
        "merge_entries completed"
    );
    result
}
