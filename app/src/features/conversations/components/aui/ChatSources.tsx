/**
 * The sources a turn drew on, as one row of source badges under its answer:
 * `url` sources (web fetch/search) and `document` sources (memory citations).
 *
 * Sources arrive as assistant-ui `source` parts, emitted by `assistantParts`
 * (`providers/assistantUiMessages.ts`) through `extractAgentSources` for
 * `url` (the one place a model-supplied URL is admitted, http(s) only — a raw
 * tool-call argument, so prompt-injection-influenceable) and directly from
 * the turn's `citations` (memory retrieval) for `document`. `Thread` groups
 * the run of source parts and hands them here through its `SourceGroup` slot.
 *
 * A short list shows every source as a badge inline. Past
 * `MAX_INLINE_SOURCES` the row is grouped behind one summary toggle — the
 * first few sites' favicons stacked, then "N sources" — because a research
 * turn cites twenty-plus pages and a flat wrap of that many badges buried the
 * answer under half a screen of chips. Opening the toggle shows the full row.
 *
 * The favicon comes from the source's real site, not its URL host: grounded
 * answers (Gemini) cite through `vertexaisearch.cloud.google.com` redirect
 * URLs titled with the target domain, so keying the icon on the URL drew the
 * same Google "G" on every badge. `sourceDomain` prefers a hostname-shaped
 * title for that reason.
 */
import { ChevronRightIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Badge } from '../../../../components/assistant-ui/badge';
import {
  DocumentSourceIcon,
  Source,
  SourceIcon,
  SourceTitle,
} from '../../../../components/assistant-ui/elements/sources.aui';
import { cn } from '../../../../components/assistant-ui/lib/utils';
import type { SourceItemPart, SourceUrlPart } from '../../../../components/assistant-ui/thread';
import { useT } from '../../../../lib/i18n/I18nContext';
import { fillPlaceholders } from '../../tools/toolPhrases';

/** Up to this many sources render inline; more collapse behind the summary toggle. */
export const MAX_INLINE_SOURCES = 4;
/** Favicons stacked in the collapsed summary. */
const SUMMARY_ICONS = 4;

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * The site a `url` source belongs to: a hostname-shaped title (a grounding
 * redirect's target domain) wins over the URL's own host.
 */
export function sourceDomain(source: SourceUrlPart): string {
  const title = source.title?.trim().replace(/^www\./i, '');
  if (title && HOSTNAME.test(title)) return title.toLowerCase();
  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return source.url;
  }
}

/** Distinct sites across the url sources, in first-seen order. */
function distinctDomains(sources: readonly SourceItemPart[]): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.sourceType === 'url') seen.add(sourceDomain(source));
  }
  return [...seen];
}

function SourceBadge({ source }: { source: SourceItemPart }) {
  const { t } = useT();
  if (source.sourceType === 'url') {
    return (
      <Source href={source.url} data-testid="agent-source-row">
        <SourceIcon url={`https://${sourceDomain(source)}`} />
        <SourceTitle>{source.title || source.url}</SourceTitle>
      </Source>
    );
  }
  return (
    <Badge variant="secondary" data-testid="agent-memory-source-row">
      <span className="inline-flex items-center gap-1.5">
        <DocumentSourceIcon />
        <SourceTitle>
          {source.title ?? t('conversations.agentTaskInsights.memoryCitationFallbackTitle')}
        </SourceTitle>
      </span>
    </Badge>
  );
}

/**
 * Composes the vendored `sources.aui` primitives (`Source`/`SourceIcon`/
 * `SourceTitle`/`DocumentSourceIcon`/`Badge`) directly rather than calling its
 * `Sources` message-part component: that component's prop type is the full
 * assistant-ui `SourceMessagePartProps` (part `status`, `mediaType`, ...),
 * which this app's `SourceItemPart` (derived from `extractAgentSources` /
 * memory citations, not a live message-part subscription) does not carry.
 */
export function ChatSources({ sources }: { sources: readonly SourceItemPart[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (sources.length === 0) return null;

  const grouped = sources.length > MAX_INLINE_SOURCES;
  const badges = (
    <div
      id={listId}
      data-testid="turn-sources-list"
      className="flex flex-wrap items-center gap-1.5">
      {sources.map(source => (
        <SourceBadge key={source.id} source={source} />
      ))}
    </div>
  );

  return (
    <section
      data-testid="turn-sources"
      data-grouped={grouped ? 'true' : undefined}
      aria-label={t('conversations.agentTaskInsights.sourcesHeading')}
      className="mt-1 flex flex-col items-start gap-1.5">
      {grouped ? (
        <button
          type="button"
          data-testid="turn-sources-toggle"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen(value => !value)}
          className="border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-1">
          <span className="flex items-center -space-x-1" aria-hidden="true">
            {distinctDomains(sources)
              .slice(0, SUMMARY_ICONS)
              .map(domain => (
                <SourceIcon
                  key={domain}
                  url={`https://${domain}`}
                  className="ring-background bg-background size-3.5 rounded-full ring-1"
                />
              ))}
          </span>
          <span>
            {fillPlaceholders(t('conversations.tools.search.sources.other', '{count} sources'), {
              count: String(sources.length),
            })}
          </span>
          <ChevronRightIcon
            className={cn('size-3 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        </button>
      ) : null}
      {!grouped || open ? badges : null}
    </section>
  );
}

export default ChatSources;
