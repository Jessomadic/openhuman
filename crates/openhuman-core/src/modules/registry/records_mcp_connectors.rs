//! Registry records for the `tinymcp` and `tinyconnectors` modules.

use crate::modules::types::{LoadPolicy, ModuleRecord, PlatformAsset};

/// The `tinymcp` module: the Model Context Protocol client.
///
/// Owns both transports (Streamable HTTP and a subprocess over stdio), the
/// statically declared server set a host puts in its own configuration, the
/// dynamic registry of user-installed servers with its SQLite store, the
/// reconnect supervisor, the browser sign-in flow, and the write-audit log.
///
/// Lazy, because dialing an MCP server is something most sessions never do: a
/// host with no installed servers and no configured ones would otherwise pay a
/// download and a `dlopen` for a capability it never reaches. That differs from
/// the module's own `lazy = false` export hint, which speaks for a host whose
/// servers should be connected the moment it comes up — this host decides when
/// that moment is, and does so on the first ask.
///
/// **What stays out of the module is host policy**, and the split is the same
/// one the contract's own documentation draws: the prompt-injection scan over
/// remote tool definitions, the `mcp_clients` RPC surface, the
/// agent-facing tools, and the proxy *scoping* decision all belong to this
/// application's threat model, not to a protocol client. `tinymcp-bus` carries
/// the vocabulary; this table says which bytes may speak it.
pub(crate) const TINYMCP: ModuleRecord = ModuleRecord {
    id: "tinymcp",
    description: "Model Context Protocol client: transports, registry, and the write-audit log",
    bus_name: "ai.tinyhumans.tinymcp.Mcp",
    object_path: "/ai/tinyhumans/tinymcp/Mcp",
    version: "0.6.0",
    release_url: "https://github.com/tinyhumansai/tinymcp/releases/tag/v0.6.0",
    assets: &[
        PlatformAsset {
            host_key: "ubuntu-24.04-x86_64",
            archive: "tinymcp-0.6.0-ubuntu-24.04-x86_64.tar.gz",
            sha256: "f32a322f180e24cc942e6744f9be9458eebb2e97c1be67795eb51c03b6cecb42",
        },
        PlatformAsset {
            host_key: "ubuntu-24.04-arm64",
            archive: "tinymcp-0.6.0-ubuntu-24.04-arm64.tar.gz",
            sha256: "cbf0dfc454198b62b6d44830f215abac78100cb211b103984b6b25dbc3eeba41",
        },
        PlatformAsset {
            host_key: "ubuntu-22.04-x86_64",
            archive: "tinymcp-0.6.0-ubuntu-22.04-x86_64.tar.gz",
            sha256: "8ffe34e4fa3d7076cef9dcb755182824bdaaadf6f9182dea098c72e99f5a6081",
        },
        PlatformAsset {
            host_key: "ubuntu-22.04-arm64",
            archive: "tinymcp-0.6.0-ubuntu-22.04-arm64.tar.gz",
            sha256: "7ec7ad75767910696fe472acfd17808cb4b7259b7b3d477cefe133313524bd75",
        },
        PlatformAsset {
            host_key: "macos-26-arm64",
            archive: "tinymcp-0.6.0-macos-26-arm64.tar.gz",
            sha256: "4b0c76f358d80bd7f108fd6c66e8cd881a97271eafa393960360fcd8559a1a7c",
        },
        PlatformAsset {
            host_key: "macos-26-x86_64",
            archive: "tinymcp-0.6.0-macos-26-x86_64.tar.gz",
            sha256: "7934a57ca96aa1525cdd14fa4bd31c47d24b38f957401795569f7f2b92cda761",
        },
        PlatformAsset {
            host_key: "macos-15-arm64",
            archive: "tinymcp-0.6.0-macos-15-arm64.tar.gz",
            sha256: "6fd14c70d5ea1bd140d97b8512f754032afe6e794dfcff6b42d4b925769ce9fe",
        },
        PlatformAsset {
            host_key: "macos-15-x86_64",
            archive: "tinymcp-0.6.0-macos-15-x86_64.tar.gz",
            sha256: "7430221adcb2d8bcda3c010f600df0fcdbe2acf5854d657562601ad561a3fad4",
        },
        PlatformAsset {
            host_key: "windows-2025-x86_64",
            archive: "tinymcp-0.6.0-windows-2025-x86_64.zip",
            sha256: "fab6aebe81bc57f86e1c024d77ea0a01fa08f28204ff186bb57c3f581520d62c",
        },
        PlatformAsset {
            host_key: "windows-2022-x86_64",
            archive: "tinymcp-0.6.0-windows-2022-x86_64.zip",
            sha256: "b490eee140645da47b6eb5edf579af92e3889f25e40fb76ace579afd4e506a66",
        },
        PlatformAsset {
            host_key: "windows-11-arm64",
            archive: "tinymcp-0.6.0-windows-11-arm64.zip",
            sha256: "af8eb16669df093e6dda87a8099e78ce67ec90c8262691249a47b93862480e29",
        },
    ],
    load: LoadPolicy::Lazy,
};

pub(crate) const TINYCONNECTORS: ModuleRecord = ModuleRecord {
    id: "tinyconnectors",
    description: "OAuth connector integrations: accounts, actions, and triggers",
    bus_name: "ai.tinyhumans.connectors.Composio",
    object_path: "/ai/tinyhumans/connectors/Composio",
    version: "0.13.2",
    release_url: "https://github.com/tinyhumansai/tinyconnectors/releases/tag/v0.13.2",
    assets: &[
        PlatformAsset {
            host_key: "ubuntu-24.04-x86_64",
            archive: "tinyconnectors-0.13.2-ubuntu-24.04-x86_64.tar.gz",
            sha256: "aeab20e2cc5fe2849b78150d3df919cb72f1f1d5b0485cae5a07b84b81784ffc",
        },
        PlatformAsset {
            host_key: "ubuntu-24.04-arm64",
            archive: "tinyconnectors-0.13.2-ubuntu-24.04-arm64.tar.gz",
            sha256: "185b91fe3354bd0346e1281b34e066abc092e52a856e4ed3de9f6359c1e05cce",
        },
        PlatformAsset {
            host_key: "ubuntu-22.04-x86_64",
            archive: "tinyconnectors-0.13.2-ubuntu-22.04-x86_64.tar.gz",
            sha256: "72cdb1705acd7598b66d529808191e4eeeb9c83c672061abfa1c92eec112fc8a",
        },
        PlatformAsset {
            host_key: "ubuntu-22.04-arm64",
            archive: "tinyconnectors-0.13.2-ubuntu-22.04-arm64.tar.gz",
            sha256: "05ac114ba4575407aaca39016339ff334affa88a9652c1f66b4dcc1d59f9e7e9",
        },
        PlatformAsset {
            host_key: "macos-26-arm64",
            archive: "tinyconnectors-0.13.2-macos-26-arm64.tar.gz",
            sha256: "2ad04ea45d9c89f7cedfcc4d7448cae70c5468c7460d9ed8a742376040360700",
        },
        PlatformAsset {
            host_key: "macos-26-x86_64",
            archive: "tinyconnectors-0.13.2-macos-26-x86_64.tar.gz",
            sha256: "24e3ab0cfb624118d7371957341661f6e23b1c8379129257c6365395101cebfc",
        },
        PlatformAsset {
            host_key: "macos-15-arm64",
            archive: "tinyconnectors-0.13.2-macos-15-arm64.tar.gz",
            sha256: "6985646cde86616dc60ad3637867db2b8ea2e722ff9990cc4875dd27e68619b0",
        },
        PlatformAsset {
            host_key: "macos-15-x86_64",
            archive: "tinyconnectors-0.13.2-macos-15-x86_64.tar.gz",
            sha256: "dd47655c4a5ef6344978c6780fb8400490e7c5e251dfb57ff99cd3050309fc08",
        },
        PlatformAsset {
            host_key: "windows-2025-x86_64",
            archive: "tinyconnectors-0.13.2-windows-2025-x86_64.zip",
            sha256: "0c1e4569fc655425f6a945dba57fc73c0f01dccc80d84ce297f44386b71202fe",
        },
        PlatformAsset {
            host_key: "windows-2022-x86_64",
            archive: "tinyconnectors-0.13.2-windows-2022-x86_64.zip",
            sha256: "d0e07c73fce16619c1ff5265dc5f49c5ac8812534ec3b2dfb53edd7419ee1083",
        },
        PlatformAsset {
            host_key: "windows-11-arm64",
            archive: "tinyconnectors-0.13.2-windows-11-arm64.zip",
            sha256: "0ae07bf8dacd998fd0edb9097a6e808c94c16059523ae416b150f0477bd4f9ad",
        },
    ],
    // Lazy: a user with no connected accounts should not pay to load it, and
    // most sessions never touch a connector. Safe even signed out — the module
    // loads without configuration and still answers the capability members.
    load: LoadPolicy::Lazy,
};
