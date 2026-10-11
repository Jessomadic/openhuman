//! The wallet agent tools.
//!
//! The tools live in `tinywallet_web3::tools::wallet`; they are re-exported here
//! so `tools/mod.rs` keeps exposing them under their historical path. Each is
//! built over the process-wide wallet engine
//! ([`crate::web3::seams::engine`]) at registration in `tools/ops.rs`.

pub use tinywallet_web3::tools::wallet::*;
