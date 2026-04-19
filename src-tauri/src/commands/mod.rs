pub mod parser;

use serde::{Deserialize, Serialize};

use crate::parsers::{ParseWarning, RawEntry};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportTarget {
    pub format: BrowserFormat,
    /// Display name shown in triage, e.g. "Chrome", "Arc – Personal", "Firefox".
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum BrowserFormat {
    Icloud,
    Chromium,
    Firefox,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub source: String,
    pub message: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub entries: Vec<RawEntry>,
    pub warnings: Vec<ParseWarning>,
    pub errors: Vec<SourceError>,
}
