//! Local LLM account categorisation (Ollama).
//!
//! For each account the model answers two questions: what kind of service is
//! this, and is the account likely still in use. Both are hints for the triage
//! card — the user always makes the Keep/Delete call.
//!
//! # Security
//!
//! Invariant 3 lives here: the model only ever sees a domain and a username,
//! never a password — even though Ollama runs on this machine. The seam that
//! enforces it is [`prompts::PromptInput`], the only type the prompt builders
//! accept. It has no field a password could travel in. Widening it is a
//! review-blocking change.

pub mod client;
pub mod prompts;

use serde::{Deserialize, Serialize};

/// What kind of service an account belongs to.
///
/// Crosses to the frontend and to the model as a camelCase token (`workSaas`),
/// never as a display string — copy belongs to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Finance,
    Shopping,
    Social,
    Email,
    WorkSaas,
    Entertainment,
    Travel,
    Utilities,
    Developer,
    Other,
}

impl Category {
    pub const ALL: [Category; 10] = [
        Category::Finance,
        Category::Shopping,
        Category::Social,
        Category::Email,
        Category::WorkSaas,
        Category::Entertainment,
        Category::Travel,
        Category::Utilities,
        Category::Developer,
        Category::Other,
    ];

    /// The wire token. Must match the serde rename — a test pins the two together.
    pub const fn as_token(self) -> &'static str {
        match self {
            Category::Finance => "finance",
            Category::Shopping => "shopping",
            Category::Social => "social",
            Category::Email => "email",
            Category::WorkSaas => "workSaas",
            Category::Entertainment => "entertainment",
            Category::Travel => "travel",
            Category::Utilities => "utilities",
            Category::Developer => "developer",
            Category::Other => "other",
        }
    }

    /// Read a category the model produced, falling back to [`Category::Other`].
    ///
    /// Ignores case, spacing, and punctuation, so `workSaas`, `Work/SaaS`, and
    /// `work_saas` all land on [`Category::WorkSaas`]. A wrong category is a
    /// cosmetic problem on a triage card; failing the whole analysis over it
    /// is not worth it.
    pub fn parse_lenient(raw: &str) -> Category {
        let wanted = squash(raw);
        Category::ALL
            .into_iter()
            .find(|c| squash(c.as_token()) == wanted)
            .unwrap_or(Category::Other)
    }
}

/// Lowercase and drop everything that is not a letter or digit.
fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Lowest and highest "likely still in use" score.
pub const SCORE_MIN: u8 = 1;
pub const SCORE_MAX: u8 = 5;
/// Used when the model gives no usable score: the middle, i.e. "can't tell".
pub const SCORE_DEFAULT: u8 = 3;
/// Longest `reason` shown on a triage card, in characters.
pub const REASON_MAX_CHARS: usize = 140;

/// The model's read on one account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAnalysis {
    pub category: Category,
    /// 1 (almost certainly abandoned) to 5 (almost certainly active).
    pub likely_still_in_use: u8,
    /// One line, at most [`REASON_MAX_CHARS`] characters.
    pub reason: String,
}

/// The model's reply before it is tidied. Every field is optional and loosely
/// typed so a slightly-off reply degrades to defaults instead of an error.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAnalysis {
    category: Option<String>,
    #[serde(alias = "likely_still_in_use")]
    likely_still_in_use: Option<serde_json::Value>,
    reason: Option<String>,
}

impl AccountAnalysis {
    /// Parse the JSON object the model returned for one account.
    ///
    /// Only a reply that is not a JSON object at all is an error. Anything
    /// else is repaired: unknown category → `Other`, score clamped to 1–5 (or
    /// 3 when missing), reason squeezed to one line of 140 characters.
    pub fn from_model_json(content: &str) -> Result<AccountAnalysis, LlmError> {
        let raw: RawAnalysis =
            serde_json::from_str(content.trim()).map_err(|_| LlmError::BadResponse)?;

        Ok(AccountAnalysis {
            category: raw
                .category
                .as_deref()
                .map(Category::parse_lenient)
                .unwrap_or(Category::Other),
            likely_still_in_use: raw
                .likely_still_in_use
                .as_ref()
                .and_then(read_score)
                .unwrap_or(SCORE_DEFAULT),
            reason: single_line(raw.reason.as_deref().unwrap_or(""), REASON_MAX_CHARS),
        })
    }
}

/// Accept `4`, `4.4`, or `"4"`, clamped to the valid range.
fn read_score(value: &serde_json::Value) -> Option<u8> {
    let n = match value {
        serde_json::Value::Number(n) => n.as_f64()?,
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if !n.is_finite() {
        return None;
    }
    // Clamped to 1..=5 first, so the cast cannot truncate or wrap.
    Some(n.round().clamp(f64::from(SCORE_MIN), f64::from(SCORE_MAX)) as u8)
}

/// Collapse all whitespace and control characters to single spaces, trim, and
/// cut to `max_chars` characters.
pub(crate) fn single_line(s: &str, max_chars: usize) -> String {
    let spaced: String = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    spaced
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    /// Nothing is listening — Ollama is not installed or not running.
    #[error("could not reach the local model server")]
    Unreachable,

    /// Ollama is up but the model has not been pulled.
    #[error("model {model} is not installed")]
    ModelMissing { model: String },

    #[error("local model server returned HTTP {status}")]
    Http { status: u16 },

    #[error("local model server returned an unreadable response")]
    BadResponse,

    #[error("local model server took too long to answer")]
    Timeout,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `as_token` and the serde rename are two spellings of the same thing.
    #[test]
    fn test_category_token_matches_serde() {
        for category in Category::ALL {
            let json = serde_json::to_string(&category).unwrap();
            assert_eq!(json, format!("\"{}\"", category.as_token()));
            let back: Category = serde_json::from_str(&json).unwrap();
            assert_eq!(back, category);
        }
        assert_eq!(Category::WorkSaas.as_token(), "workSaas");
    }

    #[test]
    fn test_parse_lenient_accepts_loose_spellings() {
        for raw in [
            "workSaas",
            "Work/SaaS",
            "work_saas",
            " WORK-SAAS ",
            "worksaas",
        ] {
            assert_eq!(Category::parse_lenient(raw), Category::WorkSaas, "{raw:?}");
        }
        assert_eq!(Category::parse_lenient("Finance"), Category::Finance);
        assert_eq!(Category::parse_lenient("DEVELOPER"), Category::Developer);
    }

    #[test]
    fn test_parse_lenient_unknown_is_other() {
        for raw in ["", "gaming", "finance and shopping", "🤷"] {
            assert_eq!(Category::parse_lenient(raw), Category::Other, "{raw:?}");
        }
    }

    #[test]
    fn test_from_model_json_happy_path() {
        let analysis = AccountAnalysis::from_model_json(
            r#"{"category":"finance","likelyStillInUse":5,"reason":"Major bank."}"#,
        )
        .unwrap();
        assert_eq!(
            analysis,
            AccountAnalysis {
                category: Category::Finance,
                likely_still_in_use: 5,
                reason: "Major bank.".to_string(),
            }
        );
    }

    #[test]
    fn test_score_is_clamped_and_defaulted() {
        let score = |json: &str| {
            AccountAnalysis::from_model_json(json)
                .unwrap()
                .likely_still_in_use
        };
        assert_eq!(score(r#"{"likelyStillInUse":0}"#), 1);
        assert_eq!(score(r#"{"likelyStillInUse":-7}"#), 1);
        assert_eq!(score(r#"{"likelyStillInUse":99}"#), 5);
        assert_eq!(score(r#"{"likelyStillInUse":1e300}"#), 5);
        assert_eq!(score(r#"{"likelyStillInUse":3.6}"#), 4);
        assert_eq!(score(r#"{"likelyStillInUse":"2"}"#), 2);
        assert_eq!(score(r#"{"likely_still_in_use":4}"#), 4);
        assert_eq!(score(r#"{"likelyStillInUse":null}"#), 3);
        assert_eq!(score(r#"{"likelyStillInUse":"often"}"#), 3);
        assert_eq!(score(r#"{"likelyStillInUse":[4]}"#), 3);
        assert_eq!(score(r#"{}"#), 3);
    }

    #[test]
    fn test_missing_fields_fall_back_to_defaults() {
        let analysis = AccountAnalysis::from_model_json("{}").unwrap();
        assert_eq!(
            analysis,
            AccountAnalysis {
                category: Category::Other,
                likely_still_in_use: 3,
                reason: String::new(),
            }
        );
    }

    #[test]
    fn test_reason_is_one_line_and_capped() {
        let long = "é".repeat(400);
        let json = serde_json::json!({
            "category": "other",
            "likelyStillInUse": 3,
            "reason": format!("  first line\n\tsecond\r\nline  {long}"),
        })
        .to_string();

        let reason = AccountAnalysis::from_model_json(&json).unwrap().reason;
        assert!(reason.starts_with("first line second line é"));
        assert!(!reason.contains(|c: char| c.is_control()));
        // Counted in characters, not bytes — "é" is two bytes.
        assert_eq!(reason.chars().count(), REASON_MAX_CHARS);
    }

    #[test]
    fn test_non_json_is_bad_response() {
        for bad in ["", "finance", "[1,2,3]", "\"finance\"", "{\"category\":"] {
            assert!(
                matches!(
                    AccountAnalysis::from_model_json(bad),
                    Err(LlmError::BadResponse)
                ),
                "expected {bad:?} to be rejected"
            );
        }
    }

    /// The frontend reads camelCase.
    #[test]
    fn test_analysis_serializes_camel_case() {
        let json = serde_json::to_value(AccountAnalysis {
            category: Category::WorkSaas,
            likely_still_in_use: 4,
            reason: "Team chat.".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "category": "workSaas",
                "likelyStillInUse": 4,
                "reason": "Team chat.",
            })
        );
    }
}
