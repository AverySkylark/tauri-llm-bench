//! Seed vault backend. See the task description for the required behaviour.

use tauri::{Builder, Runtime};

/// Vault contents, shared by all commands.
pub struct SeedVault {}

impl SeedVault {
    /// Creates a vault from `(lot code, grams)` pairs.
    pub fn with_lots<I, S>(lots: I) -> Self
    where
        I: IntoIterator<Item = (S, u32)>,
        S: Into<String>,
    {
        let _ = lots;
        todo!("store the lots")
    }
}

/// Adds the vault to managed state and registers the vault commands.
pub fn register<R: Runtime>(builder: Builder<R>, vault: SeedVault) -> Builder<R> {
    let _ = vault;
    builder
}
