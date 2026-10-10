//! Host charge normalization preserves streaming settlement and unknown usage.

use super::*;
use futures::StreamExt;
use tinyinference_llm::usage::Usage;

struct StreamingFixture;

#[async_trait]
impl ChatModel<()> for StreamingFixture {
    async fn invoke(&self, _: &(), _: ModelRequest) -> tinyinference_llm::Result<ModelResponse> {
        Ok(ModelResponse {
            usage: Some(Usage::new(10, 5)),
            raw: Some(serde_json::json!({"usage": {"buyer_cost_micro": 10}})),
            ..ModelResponse::assistant("done")
        })
    }
}

#[tokio::test]
async fn streaming_gateway_charge_settles_and_releases_the_reservation() {
    use tinyinference_llm::model::budget::{Budget, BudgetedModel, CallBudget, SpendLimits};
    let budget = Budget::new(SpendLimits {
        tokens: None,
        cost_micros: Some(150),
    });
    let model = BudgetedModel::new(
        Arc::new(GatewayChargeModel::new(Arc::new(StreamingFixture))),
        budget.clone(),
        CallBudget {
            input_tokens: 10,
            output_tokens: 5,
            cost_micros: 100,
        },
    );
    for expected_cost in [10, 20] {
        let mut stream = model.stream(&(), ModelRequest::default()).await.unwrap();
        let mut completed = false;
        while let Some(item) = stream.next().await {
            if let ModelStreamItem::Completed(response) = item {
                assert_eq!(response.usage.unwrap().charged_amount.unwrap().micros, 10);
                completed = true;
            }
        }
        assert!(completed);
        assert_eq!(budget.snapshot().spent.cost_micros, expected_cost);
    }
}

#[test]
fn absent_raw_charge_preserves_typed_charge_and_absent_usage_stays_unknown() {
    let mut response = ModelResponse {
        usage: Some(Usage {
            charged_amount: Some(ChargedAmount::usd_micros(12)),
            ..Usage::new(10, 5)
        }),
        raw: Some(serde_json::json!({"usage": {}})),
        ..ModelResponse::assistant("done")
    };
    normalize_charge(&mut response);
    assert_eq!(response.usage.unwrap().charged_amount.unwrap().micros, 12);
    response.usage = None;
    response.raw = Some(serde_json::json!({"usage": {"buyer_cost_micro": 10}}));
    normalize_charge(&mut response);
    assert!(response.usage.is_none());
}

#[test]
fn integer_buyer_charge_does_not_lose_fixed_point_precision() {
    let amount = 9_007_199_254_740_993_i64;
    let mut response = ModelResponse {
        usage: Some(Usage::new(10, 5)),
        raw: Some(serde_json::json!({"usage": {"buyer_cost_micro": amount}})),
        ..ModelResponse::assistant("done")
    };
    normalize_charge(&mut response);
    assert_eq!(
        response.usage.unwrap().charged_amount.unwrap().micros,
        amount
    );
}
