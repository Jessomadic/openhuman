//! Wire and domain types for wallet setup, status, and secret material.

use serde::{Deserialize, Serialize};

// The wallet's vocabulary lives in `tinywallet-web3`, which the engine and the
// tools share; the host keeps only the persisted shape and the setup params.
pub use tinywallet_web3::crypto::wallet::{
    WalletAccount, WalletChain, WalletSetupSource, WalletStatus,
};
/// Error message returned when the wallet has not been set up yet. Downstream
/// boundaries match against it to classify the condition as an expected user
/// state, so it stays out of Sentry; it is defined once in `tinywallet-web3`
/// so the producer and any classifier cannot drift apart.
pub use tinywallet_web3::quote::WALLET_NOT_CONFIGURED_MESSAGE;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletSetupParams {
    pub consent_granted: bool,
    pub source: WalletSetupSource,
    pub mnemonic_word_count: u8,
    #[serde(default)]
    pub encrypted_mnemonic: Option<String>,
    pub accounts: Vec<WalletAccount>,
    /// When `true`, allows overwriting an existing wallet.
    /// Requires explicit user confirmation in the frontend.
    /// Defaults to `false` — a guard against silent overwrites.
    #[serde(default)]
    pub force: bool,
}

/// Persisted on-disk (and/or keychain-backed) representation of wallet state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredWalletState {
    pub consent_granted: bool,
    pub source: WalletSetupSource,
    pub mnemonic_word_count: u8,
    #[serde(default)]
    pub encrypted_mnemonic: Option<String>,
    pub accounts: Vec<WalletAccount>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WalletSecretMaterial {
    pub encrypted_mnemonic: String,
    pub derivation_path: String,
}

/// Result returned by `reveal_recovery_phrase`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealRecoveryPhraseResult {
    pub phrase: String,
    pub word_count: usize,
}
