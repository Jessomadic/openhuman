/**
 * Provider picker for the Embeddings panel: one icon tile per provider, with
 * its key / sign-in status as chips. Selecting a tile hands the entry to the
 * panel, which may open the setup modal before switching.
 */
import {
  Ban,
  Boxes,
  Check,
  Cloud,
  Cpu,
  type LucideIcon,
  Server,
  Sparkles,
  Waypoints,
} from 'lucide-react';

import { cn } from '../../../lib/cn';
import { useT } from '../../../lib/i18n/I18nContext';
import type { EmbeddingProviderEntry } from '../../../services/api/embeddingsApi';
import { Badge, Card } from '../../ui';

export interface EmbeddingsProviderListProps {
  providers: readonly EmbeddingProviderEntry[];
  selectedProvider: string;
  isLocalSession: boolean;
  onSelect: (entry: EmbeddingProviderEntry) => void;
}

/** Icon per known provider slug; anything else gets a generic glyph. */
const PROVIDER_ICON: Record<string, LucideIcon> = {
  managed: Cloud,
  openai: Sparkles,
  voyage: Waypoints,
  ollama: Cpu,
  lmstudio: Cpu,
  custom: Server,
  none: Ban,
};

const EmbeddingsProviderList = ({
  providers,
  selectedProvider,
  isLocalSession,
  onSelect,
}: EmbeddingsProviderListProps) => {
  const { t } = useT();

  return (
    <Card
      title={t('settings.embeddings.providerAria')}
      description={t('settings.embeddings.description')}>
      <div
        role="radiogroup"
        aria-label={t('settings.embeddings.providerAria')}
        className="grid gap-2 p-4 sm:grid-cols-2">
        {providers.map(entry => {
          const selected = entry.slug === selectedProvider;
          const Icon = PROVIDER_ICON[entry.slug] ?? Boxes;
          return (
            <button
              key={entry.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(entry)}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500/25',
                selected
                  ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10'
                  : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover'
              )}>
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  selected
                    ? 'bg-primary-500 text-content-inverted'
                    : 'bg-surface-muted text-content-secondary'
                )}>
                <Icon className="h-4.5 w-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-content">{entry.label}</span>
                <span className="mt-0.5 block text-xs text-content-muted">{entry.description}</span>
                {(entry.requires_api_key || (isLocalSession && entry.slug === 'managed')) && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {entry.requires_api_key && (
                      <Badge variant={entry.has_api_key ? 'success' : 'warning'}>
                        {entry.has_api_key
                          ? t('settings.embeddings.statusConfigured')
                          : t('settings.embeddings.statusNeedsKey')}
                      </Badge>
                    )}
                    {isLocalSession && entry.slug === 'managed' && (
                      <Badge variant="warning">{t('settings.embeddings.requiresSignIn')}</Badge>
                    )}
                  </span>
                )}
              </span>
              {selected && (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
};

export default EmbeddingsProviderList;
