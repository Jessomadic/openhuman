/**
 * Model + dimensions card for the Embeddings panel (active provider with
 * catalog models), with the provider's connection test and key removal in the
 * card footer.
 */
import { KeyRound, PlugZap } from 'lucide-react';

import { useT } from '../../../lib/i18n/I18nContext';
import type { EmbeddingModelPreset } from '../../../services/api/embeddingsApi';
import { Button, Card, Field, NativeSelect } from '../../ui';

export interface EmbeddingsModelSectionProps {
  currentModels: readonly EmbeddingModelPreset[];
  allowedDims: readonly number[];
  model: string;
  dimensions: number;
  onModelChange: (modelId: string) => void;
  onDimsChange: (dims: number) => void;
  canClearKey: boolean;
  onClearKey: () => void;
  onTestConnection: () => void;
  testConnectionDisabled: boolean;
}

const EmbeddingsModelSection = ({
  currentModels,
  allowedDims,
  model,
  dimensions,
  onModelChange,
  onDimsChange,
  canClearKey,
  onClearKey,
  onTestConnection,
  testConnectionDisabled,
}: EmbeddingsModelSectionProps) => {
  const { t } = useT();

  return (
    <Card title={t('settings.embeddings.modelCardTitle')}>
      {/* A single choice is shown as a fact, not a one-option dropdown. */}
      {currentModels.length === 1 && (
        <Field
          label={t('settings.embeddings.model')}
          control={
            <span className="font-mono text-xs text-content">
              {currentModels[0].label} ({currentModels[0].id})
            </span>
          }
        />
      )}
      {allowedDims.length <= 1 && (
        <Field
          label={t('settings.embeddings.dimensions')}
          control={<span className="font-mono text-xs text-content">{dimensions}</span>}
        />
      )}
      {currentModels.length > 1 && (
        <Field
          htmlFor="embeddings-model"
          label={t('settings.embeddings.model')}
          control={
            <NativeSelect
              id="embeddings-model"
              value={model}
              inputSize="sm"
              onChange={e => onModelChange(e.target.value)}
              className="w-72">
              {currentModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </NativeSelect>
          }
        />
      )}

      {allowedDims.length > 1 && (
        <Field
          htmlFor="embeddings-dims"
          label={t('settings.embeddings.dimensions')}
          control={
            <NativeSelect
              id="embeddings-dims"
              value={dimensions}
              inputSize="sm"
              onChange={e => onDimsChange(Number(e.target.value))}
              className="w-40">
              {allowedDims.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>
          }
        />
      )}

      {/* Active provider actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        {canClearKey && (
          <Button
            variant="secondary"
            tone="danger"
            size="sm"
            leadingIcon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
            onClick={onClearKey}>
            {t('settings.embeddings.clearKey')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<PlugZap className="h-3.5 w-3.5" aria-hidden />}
          onClick={onTestConnection}
          disabled={testConnectionDisabled}>
          {t('settings.embeddings.testConnection')}
        </Button>
      </div>
    </Card>
  );
};

export default EmbeddingsModelSection;
