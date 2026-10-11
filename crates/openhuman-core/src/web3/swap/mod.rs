//! `web3_swap` — single-chain swaps via deBridge. Cross-chain swaps are
//! redirected to `web3_bridge`. Logic lives in `tinywallet_web3::crypto::service`
//! (reached through [`super::seams`]); this module owns the RPC controllers and
//! their schemas. The agent tools are in `tinywallet_web3::tools::web3`.

pub mod schemas;
