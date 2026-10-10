//! Whole-turn validation, observation, cancellation, deadlines and dispatch.
use super::*;

impl Turn {
    /// Run the turn.
    ///
    /// Establishes the origin and progress scopes described in the module docs,
    /// then dispatches through [`call`](crate::call::call) so the
    /// `{result, logs}` envelope, [`DomainSet`](openhuman_core::core::runtime::DomainSet)
    /// gating and error classification are handled the same way as every other
    /// facade method.
    ///
    /// # Errors
    ///
    /// [`CoreError::Unavailable`] when the `inference` domain family is off —
    /// that is a build/composition fact, not a failure, and a host should hide
    /// the surface rather than report an error.
    pub async fn send(mut self) -> Result<TurnOutcome, CoreError> {
        // Keep cancellation acknowledgement behind the terminal callback too.
        let _observer_guard = self.cancellation.as_ref().map(|handle| handle.enter());
        let Some(observer) = self.observer.take() else {
            return self.send_controlled().await;
        };
        let capture = self.trace_content;
        let session_id = self
            .session_id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| format!("embed-{}", uuid::Uuid::new_v4()));
        self.session_id = Some(session_id.clone());
        let message = self.request.message.clone();
        crate::observe::observe_turn(
            observer,
            capture,
            &session_id,
            &message,
            self.send_controlled(),
        )
        .await
    }

    // Erase this large dispatch future at the control boundary: composing
    // several observed/cancellable turns must not multiply caller stack use.
    fn send_controlled(
        mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TurnOutcome, CoreError>> + Send>>
    {
        Box::pin(async move {
            let timeout = self.timeout.take();
            let cancellation = match self.cancellation.take() {
                Some(cancellation) => cancellation,
                None if timeout.is_some() => crate::TurnCancellation::default(),
                None => return Box::pin(self.send_inner()).await,
            };
            let _guard = cancellation.enter();
            let outcome = cancellation
                .cleanup()
                .scope(async {
                    tokio::select! {
                        biased;
                        _ = cancellation.cancelled() => {
                            log::debug!("[embed][agent] turn cancelled");
                            Err(CoreError::TurnCancelled { method: AGENT_CHAT })
                        }
                        _ = async {
                            match timeout {
                                Some(duration) => tokio::time::sleep(duration).await,
                                None => std::future::pending().await,
                            }
                        } => Err(CoreError::DeadlineExceeded { method: AGENT_CHAT }),
                        outcome = Box::pin(self.send_inner()) => outcome,
                    }
                })
                .await;
            // The dispatch future is dropped before waiting for its command
            // waiters. No new command can register after this point.
            cancellation.cleanup().wait().await;
            outcome
        })
    }

    /// Observe completion and, on runtime-owned agents, model and tool events.
    /// Caller-built core runtimes provide terminal metadata only. Payloads are
    /// omitted unless [`Self::trace_content`] explicitly enables them.
    pub fn observer(mut self, observer: Arc<dyn crate::observe::TurnObserver>) -> Self {
        self.observer = Some(observer);
        self
    }

    /// Explicitly consent to model messages and tool payloads in observations.
    pub fn trace_content(mut self, content: crate::observe::TraceContent) -> Self {
        self.trace_content = content;
        self
    }

    /// Bound the entire turn, including tool calls and answer repair.
    /// Deadline errors are returned only after registered subprocess cleanup.
    pub fn timeout(mut self, duration: std::time::Duration) -> Self {
        self.timeout = Some(duration);
        self
    }

    /// Obtain a cloneable handle that cancels only this turn and awaits its
    /// subprocess cleanup. Acquire it before moving the turn to `send()`.
    pub fn cancellation_handle(&mut self) -> crate::TurnCancellation {
        self.cancellation
            .get_or_insert_with(Default::default)
            .clone()
    }

    async fn send_inner(mut self) -> Result<TurnOutcome, CoreError> {
        // The core neither mints nor returns a session id, so continuing a
        // conversation would otherwise be impossible without the caller
        // inventing an id scheme — which every embedder has then done
        // differently. Mint one here and hand it back.
        let session_id = self
            .session_id
            .take()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| format!("embed-{}", uuid::Uuid::new_v4()));
        self.request.thread_id = Some(session_id.clone());

        log::debug!(
            "[embed][agent] turn session={session_id} model={:?} routed={} cwd_set={}",
            self.request.model_override,
            self.request.inference_url.is_some(),
            self.request.cwd.is_some(),
        );

        validate_route(&self.request)?;
        self.validate_turn_options()?;

        // Never transmit the bearer over a non-TLS channel. The route accepts
        // an arbitrary base URL, so guard here — before any request is built —
        // rather than trusting every embedder to only name https endpoints. A
        // `Route` is refused when it pairs a credential with a non-HTTPS
        // endpoint; a route without a credential is allowed through (some
        // embedders run a local, unauthenticated OpenAI-compatible server over
        // plain http, and there is nothing sensitive on the wire for them).
        if self
            .request
            .api_key
            .as_deref()
            .is_some_and(|k| !k.is_empty())
        {
            if let Some(endpoint) = self.request.inference_url.as_deref() {
                if !is_safe_endpoint_for_bearer(endpoint) {
                    return Err(crate::error::CoreError::InsecureRoute {
                        method: AGENT_CHAT,
                        endpoint: sanitize_url_for_display(endpoint),
                    });
                }
            }
        }

        // Filled by the turn itself, before any error is raised, so a failed
        // turn is still metered. Read back below whether the dispatch returned
        // a reply or an error.
        let usage: UsageSink = std::sync::Mutex::new(None);
        let meter = self.meter.take();
        let wants_json = self
            .response_format
            .as_ref()
            .is_some_and(crate::complete::ResponseFormat::wants_json);
        let validator =
            crate::structured::Validator::new(self.response_format.as_ref()).map_err(|reason| {
                CoreError::StructuredOutput {
                    method: AGENT_CHAT,
                    failure: crate::structured::StructuredOutputFailure {
                        attempts: 0,
                        reason,
                        finish_reason: None,
                        answered_model: None,
                        usage: None,
                    },
                }
            })?;
        let options = AgentTurnOptions {
            shape: openhuman_core::agent::tinyagents::response_shape::ResponseShapeScope::new(
                openhuman_core::agent::tinyagents::response_shape::ResponseShape {
                    response_format: self
                        .response_format
                        .take()
                        .map(crate::complete::ResponseFormat::into_wire),
                    max_output_tokens: self.max_tokens,
                    validator: wants_json.then(|| std::sync::Arc::new(validator) as std::sync::Arc<dyn openhuman_core::agent::tinyagents::response_shape::ResponseValidator>),
                    structured_retries: self.structured_retries,
                    provider_options: self.provider_options.clone(),
                    require_tool_call: self.require_tool_call,
                    observer: openhuman_core::agent::tinyagents::turn_observer::current_scope(),
                },
            ),
            untrusted_input: self.untrusted_input,
        };
        let budget = self.budget.take().map(|budget| crate::budget::ModelBudget {
            ledger: budget.ledger.child(crate::budget::SpendLimits::default()),
            call: budget.call,
        });
        let dispatch = dispatch(self.target, self.request, self.seed.take(), &usage, options);
        let dispatch = async {
            match &budget {
                Some(budget) => {
                    openhuman_core::agent::tinyagents::budget::with_budget(budget.clone(), dispatch)
                        .await
                }
                None => dispatch.await,
            }
        };

        let reply = match (self.origin, self.progress) {
            (Some(origin), Some(sink)) => {
                openhuman_core::agent::progress_sink::with_progress_sink(
                    sink,
                    openhuman_core::agent::turn_origin::with_origin(origin, dispatch),
                )
                .await
            }
            (Some(origin), None) => {
                openhuman_core::agent::turn_origin::with_origin(origin, dispatch).await
            }
            (None, Some(sink)) => {
                openhuman_core::agent::progress_sink::with_progress_sink(sink, dispatch).await
            }
            (None, None) => dispatch.await,
        }
        .inspect_err(|err| {
            // Log a redacted failure event so dispatch errors are visible in
            // host logs without spilling the request, credentials, working
            // directory, or the error's full payload (CoreError::Domain can
            // carry arbitrary `data`). Only the session id and the coarse
            // variant classification are logged; the error itself propagates
            // to the caller untouched.
            let tag = match err {
                crate::error::CoreError::TurnCancelled { .. } => "turn_cancelled",
                crate::error::CoreError::Cancelled { .. } => "cancelled",
                crate::error::CoreError::DeadlineExceeded { .. } => "deadline",
                crate::error::CoreError::StructuredOutput { .. } => "structured_output",
                crate::error::CoreError::BudgetExceeded { .. } => "budget_exceeded",
                crate::error::CoreError::Domain { .. } => "domain",
                crate::error::CoreError::Unavailable { .. } => "unavailable",
                crate::error::CoreError::Rpc { .. } => "rpc",
                crate::error::CoreError::Encode { .. } => "encode",
                crate::error::CoreError::Decode { .. } => "decode",
                crate::error::CoreError::InsecureRoute { .. } => "insecure_route",
                crate::error::CoreError::InvalidRoute { .. } => "invalid_route",
                crate::error::CoreError::AgentRemoved { .. } => "agent_removed",
            };
            log::debug!("[embed][agent] turn_failed session={session_id} kind={tag}");
        });

        // Before the `?`. A turn that errored still spent what it spent, and
        // this is the only place both the sink and a failing result are in
        // hand -- `TurnOutcome` below is never built on that path.
        if let Some(meter) = meter {
            meter(
                usage
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone(),
            );
        }
        let reply = reply.map_err(|error| {
            match budget.as_ref().and_then(|budget| budget.ledger.refusal()) {
                Some(source) => CoreError::BudgetExceeded {
                    method: AGENT_CHAT,
                    source,
                },
                None => error,
            }
        });
        let (reply, report) = reply?;
        let structured = if wants_json {
            serde_json::from_str(reply.trim()).ok()
        } else {
            None
        };

        log::debug!(
            "[embed][agent] turn_completed session={session_id} reply_len={} structured={} \
             finish_reason={:?}",
            reply.len(),
            structured.is_some(),
            report.as_ref().and_then(|r| r.finish_reason.as_deref())
        );

        let report = report.unwrap_or_default();
        Ok(TurnOutcome {
            reply,
            session_id,
            usage: usage
                .into_inner()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            structured,
            finish_reason: report.finish_reason,
            answered_model: report.answered_model,
        })
    }

    /// Refuse the per-turn options the target cannot honour, before anything
    /// is dispatched.
    fn validate_turn_options(&self) -> Result<(), CoreError> {
        if self.structured_retries > 3 {
            return Err(CoreError::StructuredOutput {
                method: AGENT_CHAT,
                failure: crate::structured::StructuredOutputFailure {
                    attempts: 0,
                    reason: crate::structured::StructuredFailureReason::RetryLimit,
                    finish_reason: None,
                    answered_model: None,
                    usage: None,
                },
            });
        }
        let refuse = |message: &str, kind: &str| {
            Err(CoreError::Domain {
                method: AGENT_CHAT,
                message: message.to_owned(),
                kind: Some(kind.to_owned()),
                data: None,
                expected_user_state: true,
            })
        };
        let host_only = match &self.target {
            TurnTarget::Agent(agent) => agent.host_only,
            TurnTarget::Runtime(_) => {
                if self.response_format.is_some()
                    || self.max_tokens.is_some()
                    || self.structured_retries != 0
                    || !self.provider_options.is_null()
                    || self.require_tool_call
                {
                    return refuse(
                        "response_format and max_tokens need a runtime-owned Agent",
                        "turn_shape_unsupported",
                    );
                }
                false
            }
        };
        if self.untrusted_input && !host_only {
            return refuse(
                "untrusted_input is only allowed on a HostOnly agent",
                "untrusted_input_requires_host_only",
            );
        }
        Ok(())
    }
}
