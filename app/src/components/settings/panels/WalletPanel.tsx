import { useState } from 'react';

import { useT } from '../../../lib/i18n/I18nContext';
import { Alert, AlertDescription } from '../../ui/Alert';
import SettingsTabbedPage from '../layout/SettingsTabbedPage';
import RecoveryPhrasePanel from './RecoveryPhrasePanel';
import WalletBalancesPanel from './WalletBalancesPanel';

type WalletTab = 'balance' | 'recovery';

/**
 * WalletPanel — the Connections "Wallet" destination as a two-tab view:
 * **Wallet balance** (multi-chain balances) and **Recovery** (recovery phrase).
 * A chip row switches between the two existing panels, which each keep their own
 * header + scroll.
 */
export default function WalletPanel() {
  const { t } = useT();
  const [tab, setTab] = useState<WalletTab>('balance');

  return (
    <SettingsTabbedPage
      title={t('pages.settings.account.walletBalances')}
      description={t('connections.header.wallet')}
      tabs={[
        { id: 'balance', label: t('wallet.tabs.balance') },
        { id: 'recovery', label: t('wallet.tabs.recovery') },
      ]}
      value={tab}
      onChange={setTab}
      tabsAriaLabel={t('wallet.ariaLabel')}
      tabsTestIdPrefix="wallet"
      // Balances is a fill-height table (only its rows scroll); Recovery is a
      // normal scrolling form.
      scrollable={tab !== 'balance'}>
      <div
        className={tab === 'balance' ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}
        data-testid="wallet-panel">
        <Alert variant="warning" role={undefined} className="shrink-0">
          <AlertDescription>{t('walletBalances.earlyAlphaNotice')}</AlertDescription>
        </Alert>
        {tab === 'balance' ? (
          <div className="min-h-0 flex-1">
            <WalletBalancesPanel />
          </div>
        ) : (
          <RecoveryPhrasePanel />
        )}
      </div>
    </SettingsTabbedPage>
  );
}
