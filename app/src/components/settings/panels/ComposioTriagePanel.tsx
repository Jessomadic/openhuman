import { Save } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { useT } from '../../../lib/i18n/I18nContext';
import {
  openhumanGetComposioTriggerSettings,
  openhumanUpdateComposioTriggerSettings,
} from '../../../utils/tauriCommands';
import {
  Button,
  Card,
  CenteredLoadingState,
  Field,
  Spinner,
  StatusLine,
  Switch,
  TextField,
} from '../../ui';
import SettingsPanel from '../layout/SettingsPanel';

interface ComposioTriagePanelProps {
  /** When true, render without the SettingsPanel chrome (used when embedded in
   *  the Connections Composio page). */
  embedded?: boolean;
}

const ComposioTriagePanel = ({ embedded = false }: ComposioTriagePanelProps = {}) => {
  const { t } = useT();

  const [triageDisabled, setTriageDisabled] = useState(false);
  const [disabledToolkits, setDisabledToolkits] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;
    openhumanGetComposioTriggerSettings()
      .then(res => {
        if (!isMounted) return;
        const settings = res.result;
        if (!settings) return;
        setTriageDisabled(settings.triage_disabled ?? false);
        setDisabledToolkits((settings.triage_disabled_toolkits ?? []).join(', '));
      })
      .catch(err => {
        if (!isMounted) return;
        console.warn('[ComposioTriagePanel] failed to load settings:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      if (saveStatusTimer.current !== null) {
        clearTimeout(saveStatusTimer.current);
      }
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const toolkitList = disabledToolkits
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
      await openhumanUpdateComposioTriggerSettings({
        triage_disabled: triageDisabled,
        triage_disabled_toolkits: toolkitList,
      });
      setSaveStatus('saved');
      if (saveStatusTimer.current !== null) {
        clearTimeout(saveStatusTimer.current);
      }
      saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.warn('[ComposioTriagePanel] failed to save settings:', err);
      if (saveStatusTimer.current !== null) {
        clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = null;
      }
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const wrap = (node: ReactNode) =>
    embedded ? (
      node
    ) : (
      <SettingsPanel description={t('settings.developerMenu.composio.desc')}>{node}</SettingsPanel>
    );

  if (loading) {
    return wrap(<CenteredLoadingState label={t('settings.composio.loading')} />);
  }

  return wrap(
    <Card
      title={t('composio.triageTitle')}
      description={`${t('composio.triageDesc')} OPENHUMAN_TRIGGER_TRIAGE_DISABLED ${t('composio.envVarOverrides')}`}
      data-testid="composio-triage-card">
      <Field
        htmlFor="switch-triage-disabled"
        label={t('composio.disableAllTriage')}
        description={t('composio.triggersStillRecorded')}
        control={
          <Switch
            id="switch-triage-disabled"
            checked={triageDisabled}
            onCheckedChange={next => setTriageDisabled(next)}
            aria-label={t('composio.disableAllTriage')}
          />
        }
      />
      <Field
        htmlFor="disabled-toolkits"
        disabled={triageDisabled}
        label={t('composio.disableSpecificIntegrations')}
        description={`${t('composio.integrationSlugsHelp')} ${t('composio.integrationSlugsExample')}. ${t('composio.integrationSlugsCaseInsensitive')}`}
        control={
          <TextField
            id="disabled-toolkits"
            mono
            inputSize="sm"
            className="w-72"
            value={disabledToolkits}
            onChange={e => setDisabledToolkits(e.target.value)}
            placeholder={t('composio.integrationSlugsPlaceholder')}
            disabled={triageDisabled}
            aria-label={t('composio.disableSpecificIntegrations')}
          />
        }
      />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <StatusLine
          saving={saving}
          savedNote={saveStatus === 'saved' ? t('composio.settingsSaved') : null}
          error={saveStatus === 'error' ? t('composio.saveFailed') : null}
          savingLabel={t('common.loading')}
          className="min-h-0"
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
          leadingIcon={saving ? <Spinner /> : <Save className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => void handleSave()}
          disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Card>
  );
};

export default ComposioTriagePanel;
