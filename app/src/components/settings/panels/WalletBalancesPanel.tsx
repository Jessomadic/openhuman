import { ArrowDown, ArrowUp, Check, Copy, Globe, RefreshCw, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  balanceKey,
  balanceNetworkLabel,
  formatDisplayBalance,
} from '../../../features/wallet/walletDisplay';
// ---------------------------------------------------------------------------
// WalletBalancesPanel — main panel
// ---------------------------------------------------------------------------

import { useUser } from '../../../hooks/useUser';
import { useT } from '../../../lib/i18n/I18nContext';
import {
  type BalanceInfo,
  type EvmNetwork,
  fetchWalletBalances,
  fetchWalletStatus,
  type WalletChain,
} from '../../../services/walletApi';
import { type RootState } from '../../../store';
import { Alert, AlertDescription } from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import DataTable, { type DataTableColumn } from '../../ui/DataTable';
import EmptyState from '../../ui/EmptyState';
import { TableCell, TableRow } from '../../ui/Table';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import SettingsPanel from '../layout/SettingsPanel';
import { ChainIcon, NETWORK_MODAL_ICONS, TOKEN_ICONS } from './wallet/chainIcons';
import ManageTokensModal from './wallet/ManageTokensModal';
import ReceiveModal from './wallet/ReceiveModal';
import SelectNetworkModal from './wallet/SelectNetworkModal';
import SendCryptoModal from './wallet/SendCryptoModal';

// Chain badge colours
const PLACEHOLDER_ROWS: Array<{
  chain: WalletChain;
  evmNetwork?: EvmNetwork;
  assetSymbol: string;
}> = [
  { chain: 'evm', evmNetwork: 'ethereum_mainnet', assetSymbol: 'ETH' },
  { chain: 'evm', evmNetwork: 'base_mainnet', assetSymbol: 'ETH' },
  { chain: 'evm', evmNetwork: 'bsc_mainnet', assetSymbol: 'BNB' },
  { chain: 'btc', assetSymbol: 'BTC' },
  { chain: 'solana', assetSymbol: 'SOL' },
  { chain: 'tron', assetSymbol: 'TRX' },
];

export const NETWORK_FILTERS = [
  { id: 'all', label: 'All networks' },
  { id: 'ethereum_mainnet', label: 'Ethereum' },
  { id: 'base_mainnet', label: 'Base' },
  { id: 'bsc_mainnet', label: 'BNB Smart Chain' },
  { id: 'btc', label: 'Bitcoin' },
  { id: 'solana', label: 'Solana' },
  { id: 'tron', label: 'TRON' },
] as const;

export type NetworkFilterId = (typeof NETWORK_FILTERS)[number]['id'];

// Shorten address for display
function truncateAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

/**
 * Shared column set. Both the real balances and the pre-setup placeholders
 * render through it, so the two states line up column-for-column instead of
 * being two differently-shaped lists.
 *
 * `cell` is omitted throughout: every row here is custom-rendered (a row owns
 * its own copy button, its own clipboard state and its own action pair), and
 * the columns exist to define the header and the alignment.
 */
const COLUMNS_FOR = (t: (key: string) => string): DataTableColumn<BalanceInfo>[] => [
  { id: 'network', header: t('walletBalances.colToken'), className: 'whitespace-nowrap' },
  { id: 'address', header: t('walletBalances.colAddress'), className: 'w-full max-w-0' },
  {
    id: 'balance',
    header: t('walletBalances.colBalance'),
    align: 'right',
    className: 'w-px whitespace-nowrap',
  },
  {
    id: 'actions',
    header: t('walletBalances.colActions'),
    align: 'right',
    className: 'w-px whitespace-nowrap',
  },
];

// ---------------------------------------------------------------------------
// BalanceRow — a single chain/network entry with Send / Receive actions
// ---------------------------------------------------------------------------

interface BalanceRowProps {
  balance: BalanceInfo;
  onSend: (balance: BalanceInfo) => void;
  onReceive: (balance: BalanceInfo) => void;
}

const BalanceRow = ({ balance, onSend, onReceive }: BalanceRowProps) => {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  // Tracks the most recent "Copied" timer so rapid re-clicks reset the 2s
  // window rather than stacking independent setTimeouts (the older one would
  // otherwise flip `copied` back to false while the newest click still wants
  // to show the checkmark).
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    },
    []
  );

  const handleCopyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(balance.address);
      setCopied(true);
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard unavailable (no permissions); silently skip.
    }
  }, [balance.address]);

  const networkLabel = balanceNetworkLabel(balance);

  return (
    <TableRow data-testid={`wallet-row-${balanceKey(balance)}`} className="group">
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-3">
          <ChainIcon chain={balance.chain} evmNetwork={balance.evmNetwork} />
          <div className="flex flex-col">
            <span className="text-sm font-bold text-content font-mono">{balance.assetSymbol}</span>
            <span className="text-xs text-content-muted">{networkLabel}</span>
          </div>
          {balance.providerStatus !== 'ready' && (
            <Badge variant="warning">{t('walletBalances.providerMissing')}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="w-full max-w-0">
        {/* Address + copy button */}
        <div className="flex min-w-0 items-center justify-start gap-1.5">
          <span className="truncate font-mono text-xs text-content-muted" title={balance.address}>
            {truncateAddress(balance.address)}
          </span>
          <Button
            type="button"
            iconOnly
            variant="tertiary"
            size="sm"
            onClick={() => void handleCopyAddress()}
            aria-label={t('walletBalances.copyAddress')}
            className="shrink-0 text-content-faint hover:text-content-secondary dark:hover:text-content-secondary">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-sage-500" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </div>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap text-right">
        <div className="flex items-center justify-end gap-1.5">
          <span
            title={t('walletBalances.rawBalance').replace('{raw}', balance.raw)}
            className="text-sm font-medium text-content font-mono">
            {formatDisplayBalance(balance.formatted)}
          </span>
          {TOKEN_ICONS[balance.assetSymbol] ? (
            <img
              src={TOKEN_ICONS[balance.assetSymbol]}
              alt={balance.assetSymbol}
              title={balance.assetSymbol}
              className="w-4 h-4 shrink-0 object-contain opacity-40 dark:opacity-40 dark:invert"
            />
          ) : (
            <span className="text-xs text-content-muted">{balance.assetSymbol}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap text-right">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onSend(balance)}
            data-testid={`wallet-send-${balanceKey(balance)}`}
            aria-label={t('walletBalances.send')}
            leadingIcon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}>
            {t('walletBalances.send')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onReceive(balance)}
            data-testid={`wallet-receive-${balanceKey(balance)}`}
            aria-label={t('walletBalances.receive')}
            leadingIcon={<ArrowDown className="h-3.5 w-3.5" aria-hidden />}>
            {t('walletBalances.receive')}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

// ---------------------------------------------------------------------------
// ChainPlaceholderCard — shows available networks without implying balances exist.
// ---------------------------------------------------------------------------

const ChainPlaceholderCard = ({
  chain,
  evmNetwork,
  assetSymbol,
}: {
  chain: WalletChain;
  evmNetwork?: EvmNetwork;
  assetSymbol: string;
}) => {
  const { t } = useT();

  return (
    <Card padded divided={false}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChainIcon chain={chain} evmNetwork={evmNetwork} />
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-content">{assetSymbol}</p>
            <p className="truncate text-xs text-content-muted">
              {balanceNetworkLabel({ chain, evmNetwork })}
            </p>
          </div>
        </div>
        <Badge variant="neutral" className="shrink-0">
          {t('walletBalances.notSetUp')}
        </Badge>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// WalletBalancesPanel — main panel
// ---------------------------------------------------------------------------

// Keep balances cached when switching tabs (keyed by user ID to prevent cross-user leakage)
const cachedBalances: Record<string, BalanceInfo[] | null> = {};
const cachedWalletConfigured: Record<string, boolean | null> = {};

const WalletBalancesPanel = () => {
  const { t } = useT();
  const { navigateToSettings } = useSettingsNavigation();
  const { user } = useUser();
  const userId = user?._id || 'anonymous';

  const [balances, setBalances] = useState<BalanceInfo[] | null>(cachedBalances[userId] ?? null);
  const [loading, setLoading] = useState(
    cachedBalances[userId] === undefined || cachedBalances[userId] === null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isNetworkModalOpen, setIsNetworkModalOpen] = useState(false);
  // null = unknown (not yet loaded); false = wallet has no recovery phrase set
  // up yet, in which case we show a hint + placeholder rows instead of erroring.
  const [walletConfigured, setWalletConfigured] = useState<boolean | null>(
    cachedWalletConfigured[userId] ?? null
  );
  // The balance row a Send / Receive modal is currently open for (null = none).
  const [sendTarget, setSendTarget] = useState<BalanceInfo | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<BalanceInfo | null>(null);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkFilterId>('all');

  const hiddenTokenKeys = useSelector(
    (state: RootState) => state.walletPreferences?.hiddenTokenKeys || []
  );

  // Request-sequencing guard: a slower earlier request must not overwrite a
  // newer one. `loadBalances` can fire concurrently (mount + Refresh + Retry),
  // so we tag each call with a monotonic id and drop any response whose id no
  // longer matches the latest dispatched call.
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    setBalances(cachedBalances[userId] ?? null);
    setWalletConfigured(cachedWalletConfigured[userId] ?? null);
    setLoading(cachedBalances[userId] === undefined || cachedBalances[userId] === null);
    setError(null);
    setSendTarget(null);
    setReceiveTarget(null);
  }, [userId]);

  const loadBalances = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    if (!cachedBalances[userId]) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      // Check setup state first: the core errors `wallet_balances` when no
      // recovery phrase is configured. Rather than blocking the panel on that,
      // detect it via the structured `configured` flag and fall through to the
      // hint + placeholder rows.
      const status = await fetchWalletStatus();
      if (requestId !== latestRequestIdRef.current) return;
      if (!status.configured) {
        cachedWalletConfigured[userId] = false;
        cachedBalances[userId] = [];
        setWalletConfigured(false);
        setBalances([]);
        return;
      }
      cachedWalletConfigured[userId] = true;
      setWalletConfigured(true);
      const rows = await fetchWalletBalances();
      if (requestId !== latestRequestIdRef.current) return;
      cachedBalances[userId] = rows;
      setBalances(rows);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      // Log the raw backend phrasing for diagnostics; the UI surfaces a
      // translated, user-facing copy via `walletBalances.errorGeneric`.
      console.debug('[walletBalances] fetch failed:', message);
      setError(message);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  const selectedNetworkLabel =
    selectedNetwork === 'all'
      ? t('walletBalances.allNetworks')
      : (NETWORK_FILTERS.find(f => f.id === selectedNetwork)?.label ??
        t('walletBalances.allNetworks'));

  const filterRows = <
    T extends { chain: WalletChain; evmNetwork?: EvmNetwork; assetSymbol: string },
  >(
    rows: T[]
  ) => {
    return rows.filter(row => {
      const networkId = row.chain === 'evm' ? row.evmNetwork : row.chain;
      const bKey = balanceKey(row);
      if (hiddenTokenKeys.includes(bKey)) return false;
      if (selectedNetwork === 'all') return true;
      return networkId === selectedNetwork;
    });
  };

  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matchesQuery = (row: BalanceInfo) =>
    !needle ||
    row.assetSymbol.toLowerCase().includes(needle) ||
    balanceNetworkLabel(row).toLowerCase().includes(needle) ||
    row.address.toLowerCase().includes(needle);

  const refreshButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void loadBalances()}
      disabled={loading || isRefreshing}
      leadingIcon={
        <RefreshCw
          className={loading || isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
          aria-hidden
        />
      }>
      {t('walletBalances.refresh')}
    </Button>
  );
  const manageButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => setIsManageModalOpen(true)}
      aria-label={t('walletBalances.manageTokens')}
      leadingIcon={<Settings2 className="h-3.5 w-3.5" aria-hidden />}>
      {t('walletBalances.manageTokens')}
    </Button>
  );
  const networkButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => setIsNetworkModalOpen(true)}
      aria-label={selectedNetworkLabel}
      leadingIcon={<Globe className="h-3.5 w-3.5" aria-hidden />}
      className="shrink-0">
      {selectedNetworkLabel}
    </Button>
  );

  const renderContent = () => {
    // Not set up: a setup notice and network cards make it clear these are
    // supported networks, not balances or addresses of an unconfigured wallet.
    if (!loading && !error && walletConfigured === false) {
      return (
        <div className="space-y-4 overflow-y-auto">
          <Alert variant="warning" role="status" className="flex-wrap items-center justify-between">
            <AlertDescription>{t('walletBalances.setupHint')}</AlertDescription>
            <Button type="button" size="sm" onClick={() => navigateToSettings('recovery-phrase')}>
              {t('walletBalances.setupCta')}
            </Button>
          </Alert>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filterRows(PLACEHOLDER_ROWS).map(row => (
              <ChainPlaceholderCard
                key={row.evmNetwork || row.chain}
                chain={row.chain}
                evmNetwork={row.evmNetwork}
                assetSymbol={row.assetSymbol}
              />
            ))}
          </div>
        </div>
      );
    }

    const allRows = balances ?? [];
    const visibleRows = filterRows(allRows).filter(matchesQuery);

    return (
      <DataTable<BalanceInfo>
        testId="wallet-balances-table"
        title={t('walletBalances.tableTitle')}
        description={t('pages.settings.account.walletBalancesDesc')}
        actions={
          <>
            {refreshButton}
            {manageButton}
          </>
        }
        toolbarStart={networkButton}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: t('walletBalances.searchPlaceholder'),
          testId: 'wallet-balances-search',
        }}
        columns={COLUMNS_FOR(t)}
        rows={error ? [] : visibleRows}
        rowKey={balance => balanceKey(balance)}
        renderRow={balance => (
          <BalanceRow
            key={balanceKey(balance)}
            balance={balance}
            onSend={setSendTarget}
            onReceive={setReceiveTarget}
          />
        )}
        pagination={{ pageSize: 25 }}
        loading={loading}
        loadingLabel={t('walletBalances.loading')}
        loadingRows={4}
        error={
          error ? (
            <Alert variant="destructive" density="compact" className="items-center justify-between">
              <AlertDescription>{t('walletBalances.errorGeneric')}</AlertDescription>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void loadBalances()}>
                {t('walletBalances.retry')}
              </Button>
            </Alert>
          ) : undefined
        }
        empty={
          error ? null : (
            <EmptyState
              label={
                allRows.length === 0
                  ? t('walletBalances.emptyState')
                  : t('walletBalances.noFilterMatches')
              }
            />
          )
        }
        ariaLabel={t('walletBalances.tableTitle')}
      />
    );
  };

  const rowsToRender = walletConfigured === false ? PLACEHOLDER_ROWS : balances || [];
  return (
    // The balances table is the page's main content: it fills the height and
    // only its rows scroll.
    <SettingsPanel
      bodyClassName="flex min-h-0 flex-col gap-4"
      description={t('pages.settings.account.walletBalancesDesc')}>
      {walletConfigured === false && !loading && !error && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {networkButton}
          {refreshButton}
          {manageButton}
        </div>
      )}
      <SelectNetworkModal
        open={isNetworkModalOpen}
        onClose={() => setIsNetworkModalOpen(false)}
        selectedNetwork={selectedNetwork}
        onSelect={setSelectedNetwork}
        networkFilters={NETWORK_FILTERS.map(filter =>
          filter.id === 'all' ? { ...filter, label: t('walletBalances.allNetworks') } : filter
        )}
        chainIcons={NETWORK_MODAL_ICONS}
      />
      {renderContent()}

      {sendTarget && (
        <SendCryptoModal
          balance={sendTarget}
          onClose={() => setSendTarget(null)}
          onSuccess={() => void loadBalances()}
        />
      )}
      {receiveTarget && (
        <ReceiveModal balance={receiveTarget} onClose={() => setReceiveTarget(null)} />
      )}
      <ManageTokensModal
        open={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        tokens={rowsToRender}
      />
    </SettingsPanel>
  );
};

export default WalletBalancesPanel;
