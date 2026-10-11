//! Host adapters over the wallet engine: the read and write operations wrapped
//! in the controller contract's [`Outcome`].
//!
//! The logic (balances, transfers, lookups, the quote store) lives in
//! `tinywallet_web3::crypto`. What this file adds is the `Outcome` envelope and
//! its log lines, and the engine the operations run on
//! ([`crate::web3::seams::engine`]).

use crate::core::Outcome;
use crate::web3::seams::engine;

pub use tinywallet_web3::crypto::execution::{
    BalanceInfo, ChainStatus, ExecutePreparedParams, ExecutionResult, PrepareTransferParams,
    PreparedKind, PreparedStatus, PreparedTransaction, ProviderStatus, SupportedAsset,
    TxLookupInfo, TxReceiptInfo, TxState, TxStatusInfo,
};

use tinywallet_web3::crypto::defaults::{EvmNetwork, WalletNetworkDefaults};

use super::ops::WalletChain;

/// Default row for every supported network, with the host's endpoints.
pub async fn network_defaults() -> Result<Outcome<Vec<WalletNetworkDefaults>>, String> {
    Ok(Outcome::new(
        engine().network_defaults(),
        vec!["wallet network defaults listed".to_string()],
    ))
}

/// Every asset the wallet catalogues.
pub async fn supported_assets() -> Result<Outcome<Vec<SupportedAsset>>, String> {
    Ok(Outcome::new(
        engine().supported_assets(),
        vec!["wallet supported_assets listed".to_string()],
    ))
}

/// Which chains have an account and a provider.
pub async fn chain_status() -> Result<Outcome<Vec<ChainStatus>>, String> {
    Ok(Outcome::new(
        engine().chain_status().await?,
        vec!["wallet chain_status listed".to_string()],
    ))
}

/// Live native balances.
pub async fn balances() -> Result<Outcome<Vec<BalanceInfo>>, String> {
    Ok(Outcome::new(
        engine().balances().await?,
        vec!["wallet balances listed".to_string()],
    ))
}

/// Validate a transfer and store a quote for it.
pub async fn prepare_transfer(
    params: PrepareTransferParams,
) -> Result<Outcome<PreparedTransaction>, String> {
    Ok(Outcome::new(
        engine().prepare_transfer(params).await?,
        vec!["wallet transfer prepared".to_string()],
    ))
}

/// Confirm and execute a prepared transfer.
pub async fn execute_prepared(
    params: ExecutePreparedParams,
) -> Result<Outcome<ExecutionResult>, String> {
    Ok(Outcome::new(
        engine().execute_prepared(params).await?,
        vec!["wallet transaction broadcast".to_string()],
    ))
}

/// Check the on-chain lifecycle state of a broadcast transaction.
pub async fn tx_status(
    chain: WalletChain,
    evm_network: Option<EvmNetwork>,
    hash: &str,
) -> Result<Outcome<TxStatusInfo>, String> {
    Ok(Outcome::new(
        engine().tx_status(chain, evm_network, hash).await?,
        vec!["wallet tx status fetched".to_string()],
    ))
}

/// Fetch the receipt of a broadcast transaction.
pub async fn tx_receipt(
    chain: WalletChain,
    evm_network: Option<EvmNetwork>,
    hash: &str,
) -> Result<Outcome<TxReceiptInfo>, String> {
    Ok(Outcome::new(
        engine().tx_receipt(chain, evm_network, hash).await?,
        vec!["wallet tx receipt fetched".to_string()],
    ))
}

/// Look up the raw transaction payload by hash.
pub async fn lookup_tx(
    chain: WalletChain,
    evm_network: Option<EvmNetwork>,
    hash: &str,
) -> Result<Outcome<TxLookupInfo>, String> {
    Ok(Outcome::new(
        engine().lookup_tx(chain, evm_network, hash).await?,
        vec!["wallet tx looked up".to_string()],
    ))
}

/// The quotes that can still be executed. Test support and the introspection
/// harness read the engine's store through this.
pub fn prepared_quotes_for_test() -> Vec<PreparedTransaction> {
    engine().prepared_quotes()
}
