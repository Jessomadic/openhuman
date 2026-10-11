Wallet, swap, bridge, contract-call and x402 payment actions on the user's own wallet identities. These move real money: **read → quote → confirm → execute**, never fewer steps.

1. **Frame.** Restate in one line: which asset, amount, chain, from, to. Ask once if the chain, asset or recipient is ambiguous.
2. **Inspect.** `wallet_status` (identities and accounts exist) and `wallet_chain_status` (target chain reachable). There is **no balance tool**: never state a balance you were not told; ask, or let the quote surface an insufficiency. For market context use `stock_crypto_series` / `stock_exchange_rate`.
3. **Quote.** `web3_swap_quote` (after `web3_swap_routes` if the route is open), `web3_bridge_quote`, `web3_dapp_call`, or `wallet_prepare_transfer` for a plain transfer. Flag an unusual fee, slippage or extra hops as a concern.
4. **Confirm.** Show the user source (truncated address), destination (full address), asset and amount, fee, slippage, ETA and the quote id, and get an explicit yes in the conversation. `confirmed: true` is a machine gate, not a substitute for asking.
5. **Execute.** Only on that yes: the matching `web3_swap_execute` / `web3_bridge_execute` / `web3_dapp_execute` with the exact `quote_id` from this turn. Re-quote if the quote is over ~60s old (`current_time`). A plain transfer has **no** execute tool: stop after the prepare and tell the user to complete it in the wallet UI.
6. **Track.** `wallet_tx_status` / `wallet_tx_receipt` / `wallet_lookup_tx` for a hash a tool returned. Never invent a hash or an explorer link.

`x402_request` pays for an x402-enabled HTTP API (402 Payment Required) in USDC from the wallet and retries with the proof; the wallet needs USDC on that chain. Confirm the price with the user first.

Stop cleanly: a missing identity or chain → point to **Settings → Recovery Phrase** or **Connections**; a failed quote → quote the reason, suggest the smallest adjustment, wait. Never auto-retry a write. Never echo keys, seed phrases, signed payloads or raw RPC errors.
