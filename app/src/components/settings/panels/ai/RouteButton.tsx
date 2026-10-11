/*
 * The route cell of a routing-table row: one button showing where the task
 * runs (provider mark + name over the model id) that opens the picker. It is a
 * single button on purpose — tests and assistive tech reach the route through
 * the model text's enclosing button.
 */
import { ChevronRight } from 'lucide-react';

import Button from '../../../ui/Button';
import { slugTone } from './aiPanelTypes';
import { ProviderSwatch } from './ProviderListRow';

export const RouteButton = ({
  providerSlug,
  provider,
  model,
  placeholder,
  onClick,
  'data-testid': testId,
}: {
  providerSlug: string | null;
  provider: string;
  /** The pinned model id, or null when nothing is pinned. */
  model: string | null;
  /** Shown (in the prose face, not mono) when `model` is null. */
  placeholder: string;
  onClick: () => void;
  'data-testid'?: string;
}) => (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    onClick={onClick}
    data-testid={testId}
    className="h-auto w-64 justify-start gap-2.5 px-2.5 py-1.5 text-left">
    {providerSlug ? (
      <ProviderSwatch slug={providerSlug} label={provider} tone={slugTone(providerSlug)} />
    ) : null}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-xs font-medium text-content">{provider}</span>
      {model ? (
        <span className="truncate font-mono text-[11px] font-normal text-content-muted">
          {model}
        </span>
      ) : (
        <span className="truncate text-[11px] font-normal text-content-muted">{placeholder}</span>
      )}
    </span>
    <ChevronRight className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
  </Button>
);

export default RouteButton;
