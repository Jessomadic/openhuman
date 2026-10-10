//! Normalize measured gateway charges before the shared budget settles calls.

use std::sync::Arc;

use async_trait::async_trait;
use tinyinference_llm::model::{
    ChatModel, InputModality, InputSource, ModelProfile, ModelRequest, ModelResponse, ModelStream,
    ModelStreamItem,
};
use tinyinference_llm::usage::ChargedAmount;

pub(super) struct GatewayChargeModel {
    inner: Arc<dyn ChatModel<()>>,
}

impl GatewayChargeModel {
    pub(super) fn new(inner: Arc<dyn ChatModel<()>>) -> Self {
        Self { inner }
    }
}

fn normalize_charge(response: &mut ModelResponse) {
    let Some(usage) = response.usage.as_mut() else {
        // Missing usage must retain conservative token and charge reservations.
        return;
    };
    let Some(raw) = response.raw.as_ref() else {
        return;
    };
    if let Some(micros) = raw
        .pointer("/usage/buyer_cost_micro")
        .and_then(serde_json::Value::as_i64)
    {
        usage.charged_amount = (micros >= 0).then(|| ChargedAmount::usd_micros(micros));
        return;
    }
    let micros = raw
        .pointer("/usage/buyer_cost_micro")
        .and_then(serde_json::Value::as_f64)
        .or_else(|| {
            raw.pointer("/usage/cost")
                .and_then(serde_json::Value::as_f64)
                .map(|cost| cost * 1_000_000.0)
        });
    let Some(micros) = micros else {
        return;
    };
    // Buyer charge is authoritative, including zero. Invalid reported amounts
    // remain unknown, and fractional micro-units round up rather than refunding
    // money the gateway billed. No local price estimate enters the ledger.
    usage.charged_amount = (micros.is_finite() && micros >= 0.0 && micros < i64::MAX as f64)
        .then(|| ChargedAmount::usd_micros(micros.ceil() as i64));
}

#[async_trait]
impl ChatModel<()> for GatewayChargeModel {
    fn profile(&self) -> Option<&ModelProfile> {
        self.inner.profile()
    }

    fn supports_input(&self, modality: InputModality, mime: &str, source: InputSource) -> bool {
        self.inner.supports_input(modality, mime, source)
    }

    fn cache_identity(&self) -> Option<String> {
        self.inner.cache_identity()
    }

    async fn invoke(
        &self,
        state: &(),
        request: ModelRequest,
    ) -> tinyinference_llm::Result<ModelResponse> {
        let mut response = self.inner.invoke(state, request).await?;
        normalize_charge(&mut response);
        Ok(response)
    }

    async fn stream(
        &self,
        state: &(),
        request: ModelRequest,
    ) -> tinyinference_llm::Result<ModelStream> {
        let stream = self.inner.stream(state, request).await?;
        Ok(stream.map_items(|mut item| {
            if let ModelStreamItem::Completed(response) = &mut item {
                normalize_charge(response);
            }
            item
        }))
    }
}

#[cfg(test)]
#[path = "budget_charge_tests.rs"]
mod tests;
