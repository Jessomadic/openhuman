use super::*;

// The variables read here are process-global. Serialise these tests (and the
// ones that repoint every endpoint) so they do not race each other, and restore
// what they touched.
use crate::web3::wallet::test_support::RPC_ENV_LOCK as ENDPOINT_ENV_LOCK;

fn with_env<T>(pairs: &[(&str, Option<&str>)], f: impl FnOnce() -> T) -> T {
    let _guard = ENDPOINT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous: Vec<_> = pairs
        .iter()
        .map(|(name, _)| (*name, std::env::var(name).ok()))
        .collect();
    for (name, value) in pairs {
        match value {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    let out = f();
    for (name, value) in previous {
        match value {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    out
}

#[test]
fn solana_cluster_defaults_to_mainnet() {
    with_env(&[("OPENHUMAN_SOLANA_CLUSTER", None)], || {
        assert_eq!(solana_cluster(), SolanaCluster::Mainnet);
        assert_eq!(
            rpc_url_for_chain(WalletChain::Solana),
            SolanaCluster::Mainnet.rpc_url()
        );
    });
}

#[test]
fn devnet_cluster_is_case_insensitive_and_moves_the_default_endpoint() {
    with_env(
        &[
            ("OPENHUMAN_SOLANA_CLUSTER", Some(" DevNet ")),
            ("OPENHUMAN_WALLET_RPC_SOLANA", None),
        ],
        || {
            assert_eq!(solana_cluster(), SolanaCluster::Devnet);
            assert_eq!(
                rpc_url_for_chain(WalletChain::Solana),
                SolanaCluster::Devnet.rpc_url()
            );
            assert_eq!(HostEndpoints.solana_cluster(), SolanaCluster::Devnet);
        },
    );
}

#[test]
fn an_unknown_cluster_value_falls_back_to_mainnet() {
    with_env(&[("OPENHUMAN_SOLANA_CLUSTER", Some("testnet"))], || {
        assert_eq!(solana_cluster(), SolanaCluster::Mainnet);
    });
}

#[test]
fn an_env_override_wins_and_is_reported_as_one() {
    with_env(
        &[
            ("OPENHUMAN_WALLET_RPC_BTC", Some("  http://btc.test/api  ")),
            ("OPENHUMAN_WALLET_RPC_BASE", Some("http://base.test")),
            ("OPENHUMAN_WALLET_RPC_TRON", Some("   ")),
        ],
        || {
            assert_eq!(rpc_url_for_chain(WalletChain::Btc), "http://btc.test/api");
            assert_eq!(
                rpc_source_for_chain(WalletChain::Btc),
                RpcSource::EnvOverride
            );
            assert_eq!(
                rpc_url_for_evm_network(EvmNetwork::BaseMainnet),
                "http://base.test"
            );
            assert_eq!(
                rpc_source_for_evm_network(EvmNetwork::BaseMainnet),
                RpcSource::EnvOverride
            );
            // A blank override is no override.
            assert_eq!(rpc_source_for_chain(WalletChain::Tron), RpcSource::Default);
            assert_eq!(
                rpc_url_for_chain(WalletChain::Tron),
                default_rpc_url(WalletChain::Tron, SolanaCluster::Mainnet)
            );
        },
    );
}

#[test]
fn the_seam_resolves_an_evm_network_or_the_chain() {
    with_env(
        &[
            ("OPENHUMAN_WALLET_RPC_EVM", None),
            ("OPENHUMAN_WALLET_RPC_ARBITRUM", Some("http://arb.test")),
        ],
        || {
            let endpoints = HostEndpoints;
            assert_eq!(
                endpoints.url(WalletChain::Evm, Some(EvmNetwork::ArbitrumOne)),
                "http://arb.test"
            );
            assert_eq!(
                endpoints.source(WalletChain::Evm, Some(EvmNetwork::ArbitrumOne)),
                RpcSource::EnvOverride
            );
            // No network means Ethereum mainnet.
            assert_eq!(
                endpoints.url(WalletChain::Evm, None),
                EvmNetwork::EthereumMainnet.default_rpc_url()
            );
            assert_eq!(endpoints.source(WalletChain::Evm, None), RpcSource::Default);
            assert_eq!(
                endpoints.url(WalletChain::Btc, None),
                rpc_url_for_chain(WalletChain::Btc)
            );
            assert_eq!(
                endpoints.source(WalletChain::Btc, None),
                rpc_source_for_chain(WalletChain::Btc)
            );
        },
    );
}

#[test]
fn every_chain_and_network_has_its_own_env_var() {
    let mut names: Vec<&str> = EvmNetwork::ALL
        .iter()
        .map(|n| evm_rpc_env_var(*n))
        .collect();
    for chain in [WalletChain::Btc, WalletChain::Solana, WalletChain::Tron] {
        names.push(env_var_for_chain(chain));
    }
    let count = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), count, "no two endpoints share an override");
    assert_eq!(
        env_var_for_chain(WalletChain::Evm),
        "OPENHUMAN_WALLET_RPC_EVM"
    );
}
