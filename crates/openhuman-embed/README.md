# OpenHuman Embed

A typed Rust facade for running the OpenHuman core inside your application: one Runtime per process, with independently configured Agents.

Read the [embedding documentation](https://github.com/tinyhumansai/openhuman/blob/main/gitbooks/developing/embed/README.md), [installation](https://github.com/tinyhumansai/openhuman/blob/main/gitbooks/developing/embed/installation.md), and [quickstart](https://github.com/tinyhumansai/openhuman/blob/main/gitbooks/developing/embed/quickstart.md).

The [cookbook](https://github.com/tinyhumansai/openhuman/blob/main/gitbooks/developing/embed/cookbook.md) is generated from executable examples. Generate complete local API docs with `cargo doc -p openhuman-embed --all-features --no-deps --open`; this workspace crate is currently unpublished.

Hosts supply transport, credentials and application resources. Runtime settings establish shared defaults; agents narrow provider, access, prompt and tool behavior. Use ProfileRuntime when users require separate credentials and workspaces.

Standalone exact source pins and generated Cargo patches: [consumer setup](CONSUMERS.md).
Ordered fallbacks and required exploration: [routing](ROUTING.md).
Host telemetry and the existing exporter: [observers](OBSERVERS.md).
