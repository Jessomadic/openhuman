/*
 * Routing → "Default model": the managed catalog model a `chat` turn runs on
 * when the workload is routed to Managed (`config.default_model`).
 *
 * Rendered in the same shape as a workload row so the routing page reads as
 * one matrix. The picker is the shared provider/model dialog narrowed to the
 * managed source, so the list, search and pricing are the same ones the chat
 * composer's pill shows.
 */
import { useState } from 'react';

import { useT } from '../../../../lib/i18n/I18nContext';
import { TableCell, TableRow } from '../../../ui/Table';
import { ProviderModelPickerDialog } from './ProviderModelPickerDialog';
import { RouteButton } from './RouteButton';

/** What the picker opens on when nothing is pinned yet. */
export const RECOMMENDED_DEFAULT_MODEL = 'openrouter/deepseek/deepseek-v4-flash';

/**
 * A managed passthrough id (`openrouter/<author>/<slug>[:tag]`). Anything else
 * in `default_model` — a retired tier such as `chat-v1`, a hint, or empty — is not a
 * pin: the backend picks, and the row says so rather than naming a tier.
 */
export const isPinnedManagedModel = (value: string | undefined): value is string => {
  if (!value?.startsWith('openrouter/')) return false;
  const rest = value.slice('openrouter/'.length).split(':')[0];
  return rest.split('/').filter(Boolean).length === 2;
};

export const DefaultModelRow = ({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (model: string) => Promise<void> | void;
}) => {
  const { t } = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pinned = isPinnedManagedModel(value) ? value : null;

  return (
    <TableRow data-slot="workload-row" data-testid="default-model-row">
      <TableCell className="py-3 pl-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-content">
            {t('settings.ai.routing.defaultModel')}
          </span>
          <span className="text-xs text-content-muted">
            {t('settings.ai.routing.defaultModelDesc')}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3 pr-4">
        <RouteButton
          providerSlug="openhuman"
          provider={t('settings.ai.managedSourceLabel')}
          model={pinned}
          placeholder={t('settings.ai.routing.defaultModelUnset')}
          onClick={() => setPickerOpen(true)}
          data-testid="default-model-change"
        />

        {pickerOpen && (
          <ProviderModelPickerDialog
            cloudProviders={[]}
            localModels={[]}
            ollamaRunning={false}
            claudeCodeEnabled={false}
            initial={{ source: { kind: 'managed' }, model: pinned ?? RECOMMENDED_DEFAULT_MODEL }}
            onClose={() => setPickerOpen(false)}
            onSelect={({ model }) => {
              setPickerOpen(false);
              void onChange(model);
            }}
          />
        )}
      </TableCell>
    </TableRow>
  );
};

export default DefaultModelRow;
