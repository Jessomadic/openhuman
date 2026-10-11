/**
 * Connections → Computer. One TinyComputer module drives both the desktop and
 * the browser, so their setup lives on one page: Desktop and Browser keep
 * their own panels as sub-tabs, and Models picks the decision model that
 * chooses each step plus the planner and rescue models a task runs with.
 */
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../lib/i18n/I18nContext';
import { setCloudProviderKey } from '../../../services/api/aiSettingsApi';
import {
  type ComputerSettings,
  type DecisionModel,
  openhumanGetConfig,
  openhumanUpdateComputerSettings,
} from '../../../utils/tauriCommands/config';
import DesktopConnectionPage from '../../desktop/DesktopConnectionPage';
import { Alert, AlertDescription } from '../../ui/Alert';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import Input from '../../ui/Input';
import Label from '../../ui/Label';
import NativeSelect from '../../ui/NativeSelect';
import Switch from '../../ui/Switch';
import SettingsTabbedPage from '../layout/SettingsTabbedPage';
import BrowserConnectionsPanel from './BrowserConnectionsPanel';
import ComputerStatusCard from './ComputerStatusCard';

export type ComputerSection = 'desktop' | 'browser' | 'models';

const MAX_RESCUES = 5;

const defaults: ComputerSettings = {
  decision_model: 'jev',
  sage_fast: false,
  planner_model: '',
  rescue_model: '',
  max_rescues: null,
};

export interface ComputerPanelProps {
  section?: ComputerSection;
  onSectionChange?: (section: ComputerSection) => void;
}

export function ComputerModelsSection({ onSaved }: { onSaved?: () => void } = {}) {
  const { t } = useT();
  const [settings, setSettings] = useState<ComputerSettings>(defaults);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // OpenJev and Sage bill their own accounts; Jev rides the TinyHumans
  // session or the OpenRouter key from the LLM settings.
  const keySlug =
    settings.decision_model === 'open_jev'
      ? 'openjev'
      : settings.decision_model === 'sage'
        ? 'sage'
        : null;

  const refresh = useCallback(async () => {
    const response = await openhumanGetConfig();
    const computer = (response.result.config.computer ?? {}) as Partial<ComputerSettings>;
    setSettings({ ...defaults, ...computer });
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const save = async () => {
    const rescues = settings.max_rescues;
    if (rescues != null && (!Number.isInteger(rescues) || rescues < 0 || rescues > MAX_RESCUES)) {
      setMessage(t('computer.models.rescuesBounds'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (keySlug && apiKey.trim()) {
        await setCloudProviderKey(keySlug, apiKey.trim());
        setApiKey('');
      }
      await openhumanUpdateComputerSettings({
        decision_model: settings.decision_model,
        sage_fast: settings.sage_fast,
        planner_model: settings.planner_model ?? '',
        rescue_model: settings.rescue_model ?? '',
        ...(rescues != null ? { max_rescues: rescues } : {}),
      });
      await refresh();
      setMessage(t('computer.models.saved'));
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-4 text-sm text-content" data-testid="computer-models">
      <Card title={t('computer.models.decisionTitle')} padded divided={false}>
        <p className="mb-3 text-content-muted">{t('computer.models.decisionDescription')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="computer-decision-model">{t('computer.models.decisionModel')}</Label>
            <NativeSelect
              id="computer-decision-model"
              className="w-full"
              value={settings.decision_model}
              onChange={event =>
                setSettings(current => ({
                  ...current,
                  decision_model: event.target.value as DecisionModel,
                }))
              }>
              <option value="jev">{t('computer.models.jev')}</option>
              <option value="open_jev">{t('computer.models.openJev')}</option>
              <option value="sage">{t('computer.models.sage')}</option>
            </NativeSelect>
          </div>
          {keySlug && (
            <div className="space-y-1.5">
              <Label htmlFor="computer-decision-key">
                {keySlug === 'sage'
                  ? t('computer.models.sageKey')
                  : t('computer.models.openJevKey')}
              </Label>
              <Input
                id="computer-decision-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
              />
              <p className="text-xs text-content-muted">{t('computer.models.keyHint')}</p>
            </div>
          )}
          {settings.decision_model === 'sage' && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="computer-sage-fast">{t('computer.models.sageFast')}</Label>
              <Switch
                id="computer-sage-fast"
                checked={settings.sage_fast}
                onCheckedChange={sage_fast => setSettings(current => ({ ...current, sage_fast }))}
              />
            </div>
          )}
        </div>
      </Card>
      <Card title={t('computer.models.rescueTitle')} padded divided={false}>
        <p className="mb-3 text-content-muted">{t('computer.models.rescueDescription')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="computer-rescue-model">{t('computer.models.rescueModel')}</Label>
            <Input
              id="computer-rescue-model"
              placeholder={t('computer.models.moduleDefault')}
              value={settings.rescue_model ?? ''}
              onChange={event =>
                setSettings(current => ({ ...current, rescue_model: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="computer-max-rescues">{t('computer.models.maxRescues')}</Label>
            <Input
              id="computer-max-rescues"
              type="number"
              min={0}
              max={MAX_RESCUES}
              placeholder={t('computer.models.moduleDefault')}
              value={settings.max_rescues == null ? '' : String(settings.max_rescues)}
              onChange={event =>
                setSettings(current => ({
                  ...current,
                  max_rescues: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="computer-planner-model">{t('computer.models.plannerModel')}</Label>
            <Input
              id="computer-planner-model"
              placeholder={t('computer.models.moduleDefault')}
              value={settings.planner_model ?? ''}
              onChange={event =>
                setSettings(current => ({ ...current, planner_model: event.target.value }))
              }
            />
          </div>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
      {message && (
        <Alert variant="info" density="compact">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function ComputerPanel({
  section: controlled,
  onSectionChange,
}: ComputerPanelProps = {}) {
  const { t } = useT();
  const [local, setLocal] = useState<ComputerSection>('desktop');
  const [statusKey, setStatusKey] = useState(0);
  const section = controlled ?? local;
  const change = (next: ComputerSection) => {
    setLocal(next);
    onSectionChange?.(next);
  };

  return (
    <SettingsTabbedPage<ComputerSection>
      title={t('computer.title')}
      description={t('computer.description')}
      tabs={[
        { id: 'desktop', label: t('computer.tabs.desktop') },
        { id: 'browser', label: t('computer.tabs.browser') },
        { id: 'models', label: t('computer.tabs.models') },
      ]}
      value={section}
      onChange={change}
      tabsAriaLabel={t('computer.title')}
      tabsTestIdPrefix="computer-tab">
      <div className="space-y-4">
        <Alert variant="warning" density="compact" role={undefined}>
          <AlertDescription>{t('connections.earlyAlphaNotice')}</AlertDescription>
        </Alert>
        <ComputerStatusCard refreshKey={statusKey} />
        {section === 'desktop' && <DesktopConnectionPage embedded />}
        {section === 'browser' && <BrowserConnectionsPanel embedded />}
        {section === 'models' && (
          <ComputerModelsSection onSaved={() => setStatusKey(key => key + 1)} />
        )}
      </div>
    </SettingsTabbedPage>
  );
}
