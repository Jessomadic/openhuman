//! `web3_dapp` — generic EVM contract interactions from caller-supplied
//! calldata. Logic lives in `tinywallet_web3::crypto::service` (reached through
//! [`super::seams`]); this module owns the RPC controllers and their schemas.
//! The agent tools are in `tinywallet_web3::tools::web3`.

pub mod schemas;
