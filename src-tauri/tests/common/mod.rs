//! Shared helpers for the integration tests.
//!
//! Lives under `tests/common/` rather than `tests/common.rs` so Cargo treats it as a
//! module to include, not as a test binary of its own.

use std::path::{Path, PathBuf};

use vaultsweep_lib::commands::{BrowserFormat, ImportTarget};

/// Absolute path to a file in `tests/fixtures/`, resolved off the manifest dir so the
/// tests do not depend on the working directory the runner happens to use.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// An `ImportTarget` pointing at a fixture, with the display name the merger will use
/// as the entry's `source`.
pub fn target(format: BrowserFormat, name: &str, fixture_name: &str) -> ImportTarget {
    ImportTarget {
        format,
        name: name.to_string(),
        path: fixture(fixture_name).to_string_lossy().into_owned(),
    }
}
