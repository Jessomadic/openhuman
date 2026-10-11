/**
 * SuggestedWorkflows — the body of the Workflows → Discoveries page.
 *
 * Surfaces the read-only Flow Scout's workflow suggestions as a filterable
 * grid of discovery cards ({@link SuggestionCard}).
 * A "Discover" button runs the `flow_discovery` agent
 * (`openhuman.flows_discover`), which reasons over the user's
 * memory/threads/connections/existing flows and records concrete, buildable
 * suggestions. Each card shows the pitch (title, one-liner, rationale) plus two
 * actions:
 *
 *   - "Build this" creates a new blank flow (named from the suggestion's
 *     title, mirroring {@link WorkflowPromptBar}'s instant-create path), then
 *     navigates into the new flow's canvas with the suggestion's
 *     `build_prompt` PRE-FILLED into the copilot's input
 *     (`location.state.copilotPrefill`, carrying `mode: 'build'` so the
 *     first Send drives a full build → dry-run → propose turn against the
 *     just-created flow) — never auto-sent. The user reviews/edits the brief
 *     and presses Send themselves. The card is dropped from THIS session's
 *     local list right away (`removeSuggestion`), but `markSuggestionBuilt`
 *     is deliberately NOT called here: that RPC's contract is "the user
 *     SAVED a flow authored from this suggestion", and this path only
 *     creates a blank flow + an unsent prompt — the user may close the
 *     canvas, never press Send, reject the proposal, or navigate away
 *     without saving. There's no clean hook back from the canvas's Save to
 *     this suggestion id yet, so we leave it un-built server-side rather
 *     than risk permanently hiding an abandoned build from Flow Scout; it
 *     can simply resurface on a later discovery run.
 *   - "Dismiss" marks the suggestion `dismissed` (kept server-side so a later
 *     discovery run won't re-surface it).
 *
 * Nothing here persists or enables a flow directly beyond the blank-flow
 * create itself — the copilot only proposes, and the canvas's explicit Save
 * is the only thing that ever persists a built graph.
 */
import createDebug from 'debug';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../lib/cn';
import { createBlankWorkflowGraph, deriveWorkflowName } from '../../lib/flows/newFlow';
import { useT } from '../../lib/i18n/I18nContext';
import {
  createFlow,
  discoverWorkflows,
  dismissSuggestion,
  type FlowSuggestion,
  listSuggestions,
} from '../../services/api/flowsApi';
import { Alert, AlertDescription, Button, Spinner } from '../ui';
import SuggestionCard, {
  type SuggestionTrigger,
  suggestionTrigger,
  triggerLabelKey,
} from './SuggestionCard';

type TriggerFilter = 'all' | SuggestionTrigger;

/** Filter chips, in display order. `other` never gets its own chip. */
const FILTERS: TriggerFilter[] = ['all', 'schedule', 'app_event', 'manual'];

const log = createDebug('app:flows:suggested');

export default function SuggestedWorkflows() {
  const { t } = useT();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<FlowSuggestion[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The suggestion whose blank flow is currently being created, or `null`. */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TriggerFilter>('all');

  // Load any previously-discovered active suggestions on mount.
  useEffect(() => {
    let cancelled = false;
    void listSuggestions('new')
      .then(loaded => {
        if (!cancelled) setSuggestions(loaded);
      })
      .catch(e => log('initial listSuggestions failed: %o', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const discover = useCallback(async () => {
    if (discovering) return;
    setDiscovering(true);
    setError(null);
    try {
      const fresh = await discoverWorkflows();
      setSuggestions(fresh);
    } catch (e) {
      log('discoverWorkflows failed: %o', e);
      setError(t('flows.suggest.error'));
    } finally {
      setDiscovering(false);
    }
  }, [discovering, t]);

  const removeSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }, []);

  // Mirrors `WorkflowPromptBar`'s instant-create path: creates a blank flow
  // named from the suggestion, then opens its canvas with the copilot's input
  // PRE-FILLED (never auto-sent) with the suggestion's `build_prompt`, tagged
  // `mode: 'build'` so the panel's first Send runs a full build → dry-run →
  // propose turn against this already-created (blank) flow — matching the
  // server's `BuildMode::Build` contract — rather than treating it as a
  // draft to merely `revise` (see `WorkflowCopilotPanel.submit`).
  //
  // Deliberately does NOT call `markSuggestionBuilt`: that RPC's contract is
  // "the user SAVED a flow authored from this suggestion" (the old inline
  // path only called it from the proposal card's "Save & enable" `onSaved`
  // callback). This path only creates a blank flow and pre-fills an unsent
  // prompt — the user may close the canvas, never press Send, reject the
  // copilot's proposal, or navigate away without saving, and marking built
  // here would permanently hide/dedupe a suggestion nothing was ever built
  // from. There's no clean hook yet from the canvas's Save back to the
  // originating suggestion id, so — per the safer option — we leave it
  // un-built server-side; it can simply reappear on a later discovery run.
  // We still drop it from THIS session's local list (`removeSuggestion`) so
  // it doesn't linger in the UI right after the user has already acted on
  // it once.
  const onBuild = useCallback(
    async (suggestion: FlowSuggestion) => {
      if (openingId) return;
      setOpeningId(suggestion.id);
      const name = deriveWorkflowName(suggestion.title, t('flows.page.newWorkflow'));
      try {
        log('onBuild: creating blank flow name=%s for suggestion=%s', name, suggestion.id);
        // Safe default: suggestion-authored flows require approval so outbound
        // Slack/Gmail/HTTP/code nodes cannot fire unattended, matching
        // `WorkflowPromptBar`'s instant-create default.
        const flow = await createFlow(
          name,
          createBlankWorkflowGraph(name, t('flows.nodeKind.trigger')),
          true
        );
        log('onBuild: created id=%s — opening canvas with prefill seed', flow.id);
        removeSuggestion(suggestion.id);
        navigate(`/flows/${flow.id}`, {
          state: { copilotPrefill: { text: suggestion.build_prompt, mode: 'build' } },
        });
      } catch (e) {
        log('onBuild: createFlow failed err=%o', e);
        setError(t('flows.suggest.error'));
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, navigate, removeSuggestion, t]
  );

  const onDismiss = useCallback(
    async (id: string) => {
      // Optimistically remove; reconcile on failure by reloading.
      removeSuggestion(id);
      try {
        await dismissSuggestion(id);
      } catch (e) {
        log('dismissSuggestion failed: %o', e);
        void listSuggestions('new')
          .then(setSuggestions)
          .catch(() => {});
      }
    },
    [removeSuggestion]
  );

  const hasSuggestions = suggestions.length > 0;

  const counts = useMemo(() => {
    const byTrigger: Record<TriggerFilter, number> = {
      all: suggestions.length,
      schedule: 0,
      app_event: 0,
      manual: 0,
      other: 0,
    };
    for (const s of suggestions) byTrigger[suggestionTrigger(s.trigger_hint)] += 1;
    return byTrigger;
  }, [suggestions]);

  // A filter whose last card was built/dismissed falls back to "All" rather
  // than leaving an empty grid behind a chip that no longer renders.
  const activeFilter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter;
  const visible =
    activeFilter === 'all'
      ? suggestions
      : suggestions.filter(s => suggestionTrigger(s.trigger_hint) === activeFilter);

  const discoverButton = (
    <Button
      type="button"
      variant={hasSuggestions ? 'secondary' : 'primary'}
      size="sm"
      data-testid="flow-suggestions-discover"
      disabled={discovering}
      leadingIcon={
        discovering ? (
          <Spinner />
        ) : hasSuggestions ? (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        )
      }
      onClick={() => void discover()}>
      {discovering
        ? t('flows.suggest.discovering')
        : hasSuggestions
          ? t('flows.suggest.rediscover')
          : t('flows.suggest.discover')}
    </Button>
  );

  return (
    <section data-testid="suggested-workflows" className="space-y-4">
      {/* ── Toolbar: trigger filters on the left, discovery on the right ── */}
      {hasSuggestions && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label={t('flows.suggest.filterAria')}
            className="flex flex-wrap items-center gap-1.5">
            {FILTERS.filter(f => f === 'all' || counts[f] > 0).map(f => {
              const active = activeFilter === f;
              const labelKey = f === 'all' ? 'flows.suggest.filterAll' : triggerLabelKey(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  data-testid={`flow-suggestions-filter-${f}`}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-transparent bg-content text-surface'
                      : 'border-line bg-surface text-content-secondary hover:bg-surface-hover'
                  )}>
                  {labelKey ? t(labelKey) : f}
                  <span
                    className={cn(
                      'tabular-nums',
                      active ? 'text-surface/70' : 'text-content-faint'
                    )}>
                    {counts[f]}
                  </span>
                </button>
              );
            })}
          </div>
          {discoverButton}
        </div>
      )}

      {error && (
        <Alert variant="destructive" density="compact" data-testid="flow-suggestions-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Scanning: a status strip, plus placeholder cards on a first run ── */}
      {discovering && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-primary-500/30 bg-primary-500/5 px-4 py-3 text-sm text-content-secondary">
          <Spinner />
          {t('flows.suggest.scanning')}
        </div>
      )}

      {!hasSuggestions && discovering && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-hidden>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
              </div>
              <div className="h-3 w-full animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-muted" />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty: explain what discovery does and offer to run it ── */}
      {!hasSuggestions && !discovering && (
        <div
          data-testid="flow-suggestions-empty"
          className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-content">
            {t('flows.suggest.emptyTitle')}
          </h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-content-muted">
            {t('flows.suggest.empty')}
          </p>
          <div className="mt-5">{discoverButton}</div>
        </div>
      )}

      {hasSuggestions && (
        <div className="grid items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map(suggestion => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              opening={openingId === suggestion.id}
              buildInProgress={openingId !== null}
              onBuild={() => void onBuild(suggestion)}
              onDismiss={() => void onDismiss(suggestion.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
