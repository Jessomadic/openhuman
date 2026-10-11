/**
 * One Flow Scout suggestion as a discovery card: what it does (trigger icon,
 * title, pitch), how it would run (the outlined steps), which apps it uses,
 * and — tucked behind a toggle — why the Scout suggested it. "Build this"
 * and "Dismiss" live in the footer; their behaviour is owned by
 * {@link SuggestedWorkflows}.
 */
import {
  CalendarClock,
  ChevronDown,
  Hammer,
  type LucideIcon,
  MousePointerClick,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n/I18nContext';
import type { FlowSuggestion } from '../../services/api/flowsApi';
import { composioToolkitMeta } from '../composio/toolkitMeta';
import { Badge, Button, Spinner } from '../ui';

/** How many outline steps a card shows before collapsing the rest into "+N". */
const MAX_STEPS = 4;

export type SuggestionTrigger = 'schedule' | 'app_event' | 'manual' | 'other';

const TRIGGER_ICON: Record<SuggestionTrigger, LucideIcon> = {
  schedule: CalendarClock,
  app_event: Zap,
  manual: MousePointerClick,
  other: Workflow,
};

/** Normalises the agent's free-form `trigger_hint` onto the known kinds. */
export function suggestionTrigger(hint?: string | null): SuggestionTrigger {
  return hint === 'schedule' || hint === 'app_event' || hint === 'manual' ? hint : 'other';
}

/** Translation key for a trigger's short label, or `null` for unknown hints. */
export function triggerLabelKey(trigger: SuggestionTrigger): string | null {
  return trigger === 'other' ? null : `flows.suggest.trigger.${trigger}`;
}

/** Confidence (0–1) bucketed into a match strength chip. */
function matchStrength(confidence: number): {
  key: string;
  variant: 'success' | 'primary' | 'neutral';
} {
  if (confidence >= 0.75) return { key: 'flows.suggest.match.high', variant: 'success' };
  if (confidence >= 0.5) return { key: 'flows.suggest.match.good', variant: 'primary' };
  return { key: 'flows.suggest.match.possible', variant: 'neutral' };
}

/**
 * `suggested_connections` are connection ids (`composio:gmail:ca_…`); a card
 * shows the app, not the id, and one chip per app even when two accounts of
 * it are connected.
 */
function connectionApps(connections: string[]): string[] {
  const slugs = connections
    .map(id => {
      const parts = id.split(':').filter(Boolean);
      return (parts[0] === 'composio' ? parts[1] : parts[0]) ?? '';
    })
    .filter(Boolean);
  return [...new Set(slugs)];
}

interface SuggestionCardProps {
  suggestion: FlowSuggestion;
  /** True while THIS suggestion's blank flow is being created + navigated to. */
  opening: boolean;
  /**
   * True while ANY suggestion's blank flow is being created — disables every
   * card's "Build this" so a second click can't silently no-op against the
   * host's re-entry guard.
   */
  buildInProgress: boolean;
  onBuild: () => void;
  onDismiss: () => void;
}

export default function SuggestionCard({
  suggestion,
  opening,
  buildInProgress,
  onBuild,
  onDismiss,
}: SuggestionCardProps) {
  const { t } = useT();
  const [whyOpen, setWhyOpen] = useState(false);

  const trigger = suggestionTrigger(suggestion.trigger_hint);
  const TriggerIcon = TRIGGER_ICON[trigger];
  const triggerKey = triggerLabelKey(trigger);
  const match = matchStrength(suggestion.confidence ?? 0);
  const steps = suggestion.steps_outline ?? [];
  const hiddenSteps = Math.max(0, steps.length - MAX_STEPS);
  const apps = connectionApps(suggestion.suggested_connections ?? []);
  const whyId = `flow-suggestion-why-${suggestion.id}`;

  return (
    <article
      data-testid="flow-suggestion-card"
      className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-line-strong">
      <div className="flex-1 space-y-4 p-4">
        {/* ── Identity: trigger icon, title, trigger + match chips ── */}
        <header className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-300"
            aria-hidden>
            <TriggerIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug text-content">{suggestion.title}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {triggerKey && <Badge variant="neutral">{t(triggerKey)}</Badge>}
              <Badge variant={match.variant}>{t(match.key)}</Badge>
            </div>
          </div>
        </header>

        <p className="text-sm leading-relaxed text-content-secondary">{suggestion.one_liner}</p>

        {/* ── How it would run ── */}
        {steps.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-content-faint">
              {t('flows.suggest.steps')}
            </p>
            <ol className="mt-2 space-y-1.5">
              {steps.slice(0, MAX_STEPS).map((step, i) => (
                <li key={`${i}-${step}`} className="flex items-start gap-2.5 text-xs">
                  <span className="mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-surface-muted font-mono text-[10px] font-semibold text-content-secondary">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed text-content-secondary">{step}</span>
                </li>
              ))}
            </ol>
            {hiddenSteps > 0 && (
              <p className="mt-1.5 pl-7 text-xs text-content-faint">
                {t('flows.suggest.moreSteps').replace('{count}', String(hiddenSteps))}
              </p>
            )}
          </div>
        )}

        {/* ── Why the Scout suggested it (collapsed by default) ── */}
        {suggestion.rationale && (
          <div>
            <button
              type="button"
              aria-expanded={whyOpen}
              aria-controls={whyId}
              onClick={() => setWhyOpen(open => !open)}
              className="flex items-center gap-1 text-xs font-medium text-content-muted hover:text-content">
              {t('flows.suggest.whyToggle')}
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', whyOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            {whyOpen && (
              <p
                id={whyId}
                className="mt-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs leading-relaxed text-content-muted">
                {suggestion.rationale}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: the apps it uses, then the actions ── */}
      <footer className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {apps.map(slug => {
            const meta = composioToolkitMeta(slug);
            return (
              <span
                key={slug}
                title={t('flows.suggest.uses')}
                className="inline-flex items-center gap-1.5 rounded-md border border-line/60 bg-content/5 py-0.5 pl-1.5 pr-2 text-xs font-medium text-content">
                <img
                  src={meta.logoUrl}
                  alt=""
                  className="h-3.5 w-3.5 rounded-sm object-contain"
                  loading="lazy"
                  onError={e => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                {meta.name}
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            data-testid="flow-suggestion-dismiss"
            leadingIcon={<X className="h-3.5 w-3.5" aria-hidden />}
            onClick={onDismiss}>
            {t('flows.suggest.dismiss')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="flow-suggestion-build"
            disabled={buildInProgress}
            leadingIcon={opening ? <Spinner /> : <Hammer className="h-3.5 w-3.5" aria-hidden />}
            onClick={onBuild}>
            {opening ? t('flows.suggest.opening') : t('flows.suggest.build')}
          </Button>
        </div>
      </footer>
    </article>
  );
}
