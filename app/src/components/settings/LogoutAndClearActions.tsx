import debug from 'debug';
import { LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useT } from '../../lib/i18n/I18nContext';
import { useCoreState } from '../../providers/CoreStateProvider';
import { clearAllAppData } from '../../utils/clearAllAppData';
import {
  Alert,
  AlertDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogRoot,
  AlertDialogTitle,
  Button,
  Card,
  Field,
} from '../ui';
import { Spinner } from '../ui/icons';

const warnLog = debug('settings:account:warn');

/**
 * The bottom of Settings → Account: a single Session card holding both the
 * routine, reversible log-out row and the destructive wipe-local-data row.
 * The wipe keeps its own destructive-zone wrapper and coral/danger button so
 * it doesn't read as a peer of log out — same weight and colour one row apart
 * used to make an irreversible wipe read like a sign-out. The wipe sits
 * behind an `AlertDialog`, which does not dismiss on an outside click.
 */
const LogoutAndClearActions = () => {
  const { t } = useT();
  const { clearSession, snapshot } = useCoreState();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    setError(null);
    setIsLoggingOut(true);
    try {
      await clearSession();
    } catch (err) {
      // Log only the message — `err` may carry stack frames / serialized
      // backend payloads we don't want in renderer console.
      const reason = err instanceof Error ? err.message : String(err);
      warnLog('logout_failed %o', { reason });
      setError(t('clearData.failedLogout'));
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleClearData = async () => {
    setIsClearing(true);
    setError(null);
    try {
      const currentUserId = snapshot.auth.userId ?? snapshot.currentUser?._id ?? null;
      await clearAllAppData({ clearSession, userId: currentUserId }); // restarts the app
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || t('clearData.failed'));
    } finally {
      setIsClearing(false);
    }
  };

  const closeConfirm = (open: boolean) => {
    if (isClearing) return;
    setConfirmOpen(open);
    if (!open) setError(null);
  };

  const errorAlert = (testId?: string) =>
    error && (
      <Alert variant="destructive" density="compact" data-testid={testId}>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );

  return (
    <>
      {/* Log out and Clear app data share one card, but the wipe keeps its
          danger styling (coral button, irreversible note) and sits behind a
          confirm — so the two still don't read as peers. */}
      <Card title={t('settings.account.session')}>
        <Field
          label={t('settings.logOut')}
          description={t('settings.logOutDesc')}
          control={
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={
                isLoggingOut ? <Spinner /> : <LogOut className="h-3.5 w-3.5" aria-hidden />
              }
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              data-testid="settings-nav-logout">
              {t('settings.logOut')}
            </Button>
          }
        />
        {/* The confirm dialog owns error display while it is open. */}
        {!confirmOpen && error && <div className="px-4 py-3">{errorAlert('logout-error')}</div>}
        <div data-testid="account-destructive-zone">
          <Field
            label={t('settings.clearAppData')}
            description={`${t('settings.clearAppDataDesc')} ${t('settings.clearAppDataIrreversible')}`}
            control={
              <Button
                variant="secondary"
                tone="danger"
                size="sm"
                leadingIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setConfirmOpen(true)}
                data-testid="settings-nav-logout-and-clear">
                {t('settings.clearAppDataAction')}
              </Button>
            }
          />
        </div>
      </Card>

      <AlertDialogRoot open={confirmOpen} onOpenChange={closeConfirm}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogTitle>{t('clearData.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 leading-relaxed">
              <p>{t('clearData.warning')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t('clearData.bulletSettings')}</li>
                <li>{t('clearData.bulletCache')}</li>
                <li>{t('clearData.bulletWorkspace')}</li>
                <li>{t('clearData.bulletOther')}</li>
              </ul>
              <p className="font-medium text-coral-600 dark:text-coral-300">
                {t('clearData.irreversible')}
              </p>
            </div>
          </AlertDialogDescription>
          {error && <div className="mt-4">{errorAlert()}</div>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              onClick={event => {
                // Keep the dialog open while clearing so progress and any
                // failure stay visible; success restarts the app.
                event.preventDefault();
                void handleClearData();
              }}>
              {isClearing && <Spinner />}
              {isClearing ? t('clearData.clearing') : t('clearData.title')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
};

export default LogoutAndClearActions;
