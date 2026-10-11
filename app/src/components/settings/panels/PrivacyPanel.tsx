import { useT } from '../../../lib/i18n/I18nContext';
import { useCoreState } from '../../../providers/CoreStateProvider';
import { SettingsRow, SettingsSection, SettingsSwitch } from '../controls';
import SettingsPanel from '../layout/SettingsPanel';
import PrivacyModeSection from './PrivacyModeSection';

const PrivacyPanel = () => {
  const { snapshot, setAnalyticsEnabled } = useCoreState();
  const analyticsEnabled = snapshot.analyticsEnabled;
  const { t } = useT();

  const handleToggleAnalytics = async () => {
    const newValue = !analyticsEnabled;
    try {
      await setAnalyticsEnabled(newValue);
    } catch (error) {
      console.warn('[privacy] failed to persist analytics setting:', error);
    }
  };

  return (
    <SettingsPanel
      testId="settings-privacy-panel"
      description={t('pages.settings.account.privacyDesc')}>
      <>
        {/* Privacy Mode selector (#4435) — data-egress posture */}
        <PrivacyModeSection />

        {/* Analytics Section */}
        <SettingsSection title={t('privacy.anonymizedAnalytics')}>
          <SettingsRow
            htmlFor="switch-analytics"
            label={t('privacy.shareAnonymizedData')}
            description={t('privacy.shareAnonymizedDataDesc')}
            control={
              <SettingsSwitch
                id="switch-analytics"
                checked={analyticsEnabled}
                onCheckedChange={() => {
                  void handleToggleAnalytics();
                }}
                data-testid="privacy-analytics-toggle"
              />
            }
          />
        </SettingsSection>

        {/* Info Box */}
        <div className="p-4 bg-surface-muted rounded-xl border border-line">
          <div className="flex items-start space-x-3">
            <svg
              className="w-5 h-5 text-content-faint mt-0.5 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-xs text-content-muted leading-relaxed">
                {t('privacy.analyticsDisclaimer')}
              </p>
            </div>
          </div>
        </div>
      </>
    </SettingsPanel>
  );
};

export default PrivacyPanel;
