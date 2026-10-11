import debug from 'debug';
import { Cloud, Laptop, type LucideIcon, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '../../../lib/cn';
import { useT } from '../../../lib/i18n/I18nContext';
import { callCoreRpc } from '../../../services/coreRpcClient';
import { CORE_RPC_METHODS } from '../../../services/rpcMethods';
import Card from '../../ui/Card';
import { RadioGroupItem, RadioGroupRoot } from '../../ui/RadioGroup';
import { SettingsStatusLine } from '../controls';

const log = debug('privacy-mode');

/** Privacy Mode values as serialized by the Rust core (snake_case). */
type PrivacyMode = 'local_only' | 'standard' | 'sensitive';

interface PrivacyModeResult {
  mode: PrivacyMode;
}

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

const MODES: { value: PrivacyMode; labelKey: string; descKey: string; icon: LucideIcon }[] = [
  {
    value: 'local_only',
    labelKey: 'privacy.mode.localOnly',
    descKey: 'privacy.mode.localOnlyDesc',
    icon: Laptop,
  },
  {
    value: 'standard',
    labelKey: 'privacy.mode.standard',
    descKey: 'privacy.mode.standardDesc',
    icon: Cloud,
  },
  {
    value: 'sensitive',
    labelKey: 'privacy.mode.sensitive',
    descKey: 'privacy.mode.sensitiveDesc',
    icon: ShieldCheck,
  },
];

/**
 * Privacy Mode selector (#4435). Reads and writes the data-egress posture
 * (local_only | standard | sensitive) via the core RPCs. Distinct from the
 * autonomy access mode. Rendered inside {@link PrivacyPanel}, but kept a
 * standalone component so it can be unit-tested without the CoreStateProvider.
 */
const PrivacyModeSection = () => {
  const { t } = useT();
  const [mode, setMode] = useState<PrivacyMode | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    log('[privacy-mode] fetching current mode');
    callCoreRpc<{ result: PrivacyModeResult }>({
      method: CORE_RPC_METHODS.configGetPrivacyMode,
      params: {},
    })
      .then(resp => {
        if (cancelled) return;
        log('[privacy-mode] current mode', resp.result.mode);
        setMode(resp.result.mode);
        setStatus('idle');
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[privacy-mode] failed to load privacy mode:', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    async (next: PrivacyMode) => {
      if (next === mode) return;
      log('[privacy-mode] setting mode', next);
      setStatus('saving');
      setError(null);
      try {
        const resp = await callCoreRpc<{ result: PrivacyModeResult }>({
          method: CORE_RPC_METHODS.configSetPrivacyMode,
          params: { mode: next },
        });
        setMode(resp.result.mode);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } catch (err) {
        console.warn('[privacy-mode] failed to set privacy mode:', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [mode]
  );

  return (
    <Card title={t('privacy.mode.title')} description={t('privacy.mode.description')}>
      <div className="p-4">
        <RadioGroupRoot
          value={mode ?? undefined}
          onValueChange={next => void handleSelect(next as PrivacyMode)}
          aria-label={t('privacy.mode.title')}
          className="grid gap-2 md:grid-cols-3"
          data-testid="privacy-mode-options">
          {MODES.map(({ value, labelKey, descKey, icon: Icon }) => {
            const isSelected = mode === value;
            const inputId = `privacy-mode-option-${value}-input`;
            // Icon, text, then a visible radio. The radio used to be an
            // `sr-only` element inside the label, which still pushed the title
            // off the description's left edge.
            return (
              <label
                key={value}
                htmlFor={inputId}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover',
                  status === 'saving' && 'opacity-50'
                )}>
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    isSelected
                      ? 'bg-primary-500 text-content-inverted'
                      : 'bg-surface-muted text-content-secondary'
                  )}>
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-content">{t(labelKey)}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-content-muted">
                    {t(descKey)}
                  </span>
                </span>
                <RadioGroupItem
                  id={inputId}
                  value={value}
                  data-testid={`privacy-mode-option-${value}`}
                  disabled={status === 'saving' || status === 'loading'}
                  className="shrink-0"
                />
              </label>
            );
          })}
        </RadioGroupRoot>
        <SettingsStatusLine
          saving={status === 'saving'}
          savedNote={status === 'saved' ? t('privacy.mode.saved') : null}
          error={status === 'error' ? (error ?? t('privacy.mode.saveError')) : null}
          savingLabel={t('autonomy.statusSaving')}
          // The live region stays mounted for announcements, but takes no
          // space until it has something to say, so the card's bottom
          // padding matches its top.
          className="min-h-0 [&:not(:empty)]:mt-3"
        />
      </div>
    </Card>
  );
};

export default PrivacyModeSection;
