/**
 * Connections → Skills: the user's skills, said two ways.
 *
 * The page owns its own header — title, description and the tab strip — the
 * way the MCP page does. **Installed** first: what is on this machine, with
 * run, edit and remove on every row. **Registry** last: the catalogues to
 * install from. **Runner** picks a skill workflow and runs or schedules it.
 */
import { useState } from 'react';

import { useT } from '../../lib/i18n/I18nContext';
import SettingsTabbedPage from '../settings/layout/SettingsTabbedPage';
import BetaIndicator from '../ui/BetaIndicator';
import SkillsExplorerTab, { type ExplorerView } from './SkillsExplorerTab';
import WorkflowRunnerBody from './WorkflowRunnerBody';

/** Installed / Registry are explorer views; Runner runs a skill workflow. */
type SkillsTab = ExplorerView | 'runner';

interface SkillsPageProps {
  onToast?: (toast: { type: 'success' | 'error'; title: string; message?: string }) => void;
  initialTab?: SkillsTab;
}

const SkillsPage = ({ onToast, initialTab = 'installed' }: SkillsPageProps) => {
  const { t } = useT();
  const [tab, setTab] = useState<SkillsTab>(initialTab);

  return (
    <SettingsTabbedPage
      title={t('connections.tabs.skills')}
      description={t('skills.explorer.subtitle')}
      headerAction={<BetaIndicator />}
      tabs={[
        { id: 'installed', label: t('skills.explorer.installedTab') },
        { id: 'registry', label: t('skills.explorer.registryTab') },
        // Moved here from Settings → Skills Runner: running a skill belongs
        // with the skills themselves.
        { id: 'runner', label: t('skills.explorer.runnerTab') },
      ]}
      value={tab}
      onChange={setTab}
      tabsAriaLabel={t('skills.explorer.title')}
      tabsTestIdPrefix="skill-explorer-tab"
      // Installed / Registry are tables that fill the body and scroll their
      // own rows; the Runner is a form that scrolls with the page.
      scrollable={tab === 'runner'}>
      {tab === 'runner' ? (
        <WorkflowRunnerBody />
      ) : (
        <SkillsExplorerTab view={tab} onToast={onToast} />
      )}
    </SettingsTabbedPage>
  );
};

export default SkillsPage;
