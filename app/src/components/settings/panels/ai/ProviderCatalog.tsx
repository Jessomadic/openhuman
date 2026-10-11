/*
 * "Add a provider" as an inline catalogue: one titled block per category
 * (cloud / local / CLI) of tiles for the providers not yet connected, plus a
 * custom-endpoint tile. Picking a tile starts the same connect flow the
 * header's Add-provider dialog does — the dialog stays as the quick path, the
 * catalogue is what makes the options discoverable without opening anything.
 */
import { Plus, SquarePen } from 'lucide-react';

import { useT } from '../../../../lib/i18n/I18nContext';
import Card from '../../../ui/Card';
import type { ProviderCategory } from './AddProviderDialog';
import { ProviderSwatch } from './ProviderListRow';

const tileClass =
  'group flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500/25';

export const ProviderCatalog = ({
  categories,
  onPick,
  onAddCustom,
}: {
  categories: ProviderCategory[];
  onPick: (slug: string) => void;
  onAddCustom: () => void;
}) => {
  const { t } = useT();
  const visible = categories.filter(category => category.options.length > 0);

  return (
    <Card
      title={t('settings.ai.providers.catalogTitle')}
      description={t('settings.ai.providers.addProviderSubtitle')}
      data-testid="provider-catalog">
      {visible.map(category => (
        <section
          key={category.id}
          className="space-y-2.5 p-4"
          data-testid={`provider-catalog-${category.id}`}>
          <div>
            <h4 className="text-sm font-medium text-content">{category.title}</h4>
            <p className="text-xs text-content-muted">{category.helper}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {category.options.map(option => (
              <button
                key={option.slug}
                type="button"
                className={tileClass}
                onClick={() => onPick(option.slug)}
                data-testid={`provider-catalog-option-${option.slug}`}>
                <ProviderSwatch slug={option.slug} label={option.label} tone={option.tone} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-content">{option.label}</span>
                  <span className="truncate font-mono text-[11px] text-content-muted">
                    {option.detail}
                  </span>
                </span>
                <Plus
                  className="h-4 w-4 shrink-0 text-content-faint transition-colors group-hover:text-content"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          className={tileClass}
          onClick={onAddCustom}
          data-testid="provider-catalog-custom">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-secondary">
            <SquarePen className="h-4 w-4" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-content">
              {t('settings.ai.providers.addCustomAction')}
            </span>
            <span className="truncate text-[11px] text-content-muted">
              {t('settings.ai.providers.customDetail')}
            </span>
          </span>
          <Plus
            className="h-4 w-4 shrink-0 text-content-faint transition-colors group-hover:text-content"
            aria-hidden
          />
        </button>
      </section>
    </Card>
  );
};

export default ProviderCatalog;
