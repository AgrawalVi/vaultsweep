//! THROWAWAY — step 0 verification only. Delete when `hibp/` lands in step 1.
//!
//! Sole purpose: prove the reqwest TLS backend actually resolves. reqwest 0.13
//! was previously in `Cargo.lock` transitively via tauri with *no* TLS backend
//! at all, so any HTTPS request would have failed at client-build time with an
//! opaque error. This is the cheapest possible check that the feature selection
//! in `Cargo.toml` is right.
//!
//! Network-dependent, so it is `#[ignore]`d — offline `cargo test` still passes.
//! Run it explicitly:
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
//! ```

/// SHA-1("password"), uppercase hex. Split at 5 chars for k-anonymity.
const PASSWORD_SHA1: &str = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";

#[tokio::test]
#[ignore = "hits the network"]
async fn https_get_to_pwnedpasswords_succeeds() {
    let (prefix, suffix) = PASSWORD_SHA1.split_at(5);
    assert_eq!(prefix, "5BAA6");
    assert_eq!(suffix.len(), 35);

    let client = reqwest::Client::builder()
        // HIBP returns 403 to requests with no User-Agent.
        .user_agent("vaultsweep/0.1 (+https://github.com/vishrut/vaultsweep)")
        .build()
        .expect("client build failed — this is the TLS backend check; if it fails \
                 here, reqwest resolved without a TLS feature");

    let resp = client
        .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
        // HIBP pads the response so its size can't leak which bucket was asked for.
        .header("Add-Padding", "true")
        .send()
        .await
        .expect("request failed — TLS handshake or DNS");

    assert_eq!(resp.status(), 200, "unexpected status from HIBP");

    let body = resp.text().await.expect("body read failed");

    // Lines are `SUFFIX:COUNT\r\n`. Padding rows carry a count of 0.
    let hit = body
        .lines()
        .filter_map(|line| line.trim_end().split_once(':'))
        .find(|(s, _)| s.eq_ignore_ascii_case(suffix))
        .map(|(_, count)| count.parse::<u64>().expect("count not a number"));

    assert!(
        hit.is_some_and(|count| count > 0),
        "expected the suffix for \"password\" to be present with a non-zero count"
    );
}
