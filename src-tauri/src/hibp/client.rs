//! The real [`RangeSource`] — HTTPS to `api.pwnedpasswords.com`.

use std::time::Duration;

use super::{HibpError, RangeSource, PREFIX_LEN};

const RANGE_URL: &str = "https://api.pwnedpasswords.com/range/";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = concat!("vaultsweep/", env!("CARGO_PKG_VERSION"));

pub struct HibpRangeClient {
    http: reqwest::Client,
}

impl HibpRangeClient {
    pub fn new() -> Result<Self, HibpError> {
        let http = reqwest::Client::builder()
            // HIBP answers 403 to requests without a User-Agent.
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| HibpError::Unreachable(e.without_url().to_string()))?;
        Ok(Self { http })
    }
}

#[async_trait::async_trait]
impl RangeSource for HibpRangeClient {
    async fn fetch_range(&self, prefix: &str) -> Result<String, HibpError> {
        // SECURITY (invariant 4): last line of defence before the wire. Anything
        // other than exactly 5 hex characters means a caller widened the seam,
        // so refuse rather than leak the extra characters.
        if prefix.len() != PREFIX_LEN || !prefix.bytes().all(|b| b.is_ascii_hexdigit()) {
            tracing::error!(
                len = prefix.len(),
                "refusing range request: not a 5-char hex prefix"
            );
            return Err(HibpError::BadResponse);
        }

        let resp = self
            .http
            .get(format!("{RANGE_URL}{prefix}"))
            // HIBP pads the response with invented suffixes so its size cannot
            // reveal which bucket was requested.
            .header("Add-Padding", "true")
            .send()
            .await
            .map_err(|e| HibpError::Unreachable(e.without_url().to_string()))?;

        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(HibpError::RateLimited {
                retry_after: retry_after(&resp),
            });
        }
        if !status.is_success() {
            return Err(HibpError::Http {
                status: status.as_u16(),
            });
        }

        resp.text().await.map_err(|_| HibpError::BadResponse)
    }
}

/// Read `Retry-After`, seconds form only. The HTTP-date form is legal but HIBP
/// does not use it, and guessing wrong is worse than backing off on a default.
fn retry_after(resp: &reqwest::Response) -> Option<Duration> {
    resp.headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SECURITY (invariant 4): the guard must reject anything but a 5-char hex
    /// prefix, so a widened caller fails closed instead of leaking.
    #[tokio::test]
    async fn test_rejects_non_prefix_input() {
        let client = HibpRangeClient::new().unwrap();
        for bad in [
            "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8", // full digest
            "5BAA61",                                   // one char too many
            "5BAA",                                     // too short
            "5BAAZ",                                    // right length, not hex
            "",
        ] {
            assert!(
                matches!(
                    client.fetch_range(bad).await,
                    Err(HibpError::BadResponse)
                ),
                "expected {bad:?} to be refused before any request"
            );
        }
    }

    /// Step 0 gate (C7): proves the reqwest TLS backend actually resolved.
    /// reqwest was previously in `Cargo.lock` transitively via tauri with *no*
    /// TLS backend, so HTTPS would have failed at client-build time.
    ///
    /// Also exercises the real User-Agent (missing UA gets 403) and the
    /// `Add-Padding` response path end to end.
    ///
    /// Network-dependent, so `#[ignore]`d — offline `cargo test` still passes.
    /// Run it with:
    ///
    /// ```sh
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "hits the network"]
    async fn test_live_range_lookup() {
        let client = HibpRangeClient::new().expect(
            "client build failed — reqwest resolved without a TLS backend, see Cargo.toml",
        );
        let result = crate::hibp::check_password(&client, "password")
            .await
            .expect("live range lookup failed");

        assert!(result.breached, "\"password\" must be in the corpus");
        assert!(
            result.count > 1_000,
            "implausibly low count ({}) — response parsing is probably wrong",
            result.count
        );
        println!("live HIBP lookup ok: \"password\" seen {} times", result.count);
    }
}
