import debug from 'debug';
import { Bot, Download, Eye, Feather, type LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { cn } from '../../../lib/cn';
import { useT } from '../../../lib/i18n/I18nContext';
import {
  type MigrationReport,
  openhumanMigrateHermes,
  openhumanMigrateOpenclaw,
} from '../../../utils/tauriCommands/core';
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
  AlertTitle,
  Badge,
  Button,
  Card,
  Field,
  RadioGroupItem,
  RadioGroupRoot,
  TextField,
} from '../../ui';
import { Spinner } from '../../ui/icons';
import SettingsPanel from '../layout/SettingsPanel';

const log = debug('migration-panel');

type Vendor = 'openclaw' | 'hermes';

const VENDORS: { value: Vendor; labelKey: string; descKey: string; icon: LucideIcon }[] = [
  {
    value: 'openclaw',
    labelKey: 'migration.vendor.openclaw',
    descKey: 'migration.vendor.openclawDesc',
    icon: Bot,
  },
  {
    value: 'hermes',
    labelKey: 'migration.vendor.hermes',
    descKey: 'migration.vendor.hermesDesc',
    icon: Feather,
  },
];

/**
 * Settings → Import. Two steps on one page: pick a source and preview what it
 * would bring over, then import. Import stays locked until a Preview of the
 * exact same vendor + path has succeeded, and asks for confirmation first.
 */
const MigrationPanel = () => {
  const { t } = useT();

  const [vendor, setVendor] = useState<Vendor>('openclaw');
  const [sourcePath, setSourcePath] = useState<string>('');
  const [previewReport, setPreviewReport] = useState<MigrationReport | null>(null);
  // Snapshot of `{ vendor, source }` that produced `previewReport`. Apply
  // must match these exactly — otherwise the user could preview path A,
  // edit the field to path B, and apply against B without ever seeing
  // the diff. CodeRabbit flagged this on PR #2087.
  const [previewInput, setPreviewInput] = useState<{
    vendor: Vendor;
    source: string | undefined;
  } | null>(null);
  const [appliedReport, setAppliedReport] = useState<MigrationReport | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedSource = sourcePath.trim() || undefined;

  const runMigrationRpc = useCallback(
    (dryRun: boolean) => {
      const source = normalizedSource;
      if (vendor === 'hermes') {
        return openhumanMigrateHermes(source, dryRun);
      }
      return openhumanMigrateOpenclaw(source, dryRun);
    },
    [vendor, normalizedSource]
  );

  // Apply is only enabled after a successful Preview *of the same input*.
  // Without that gate the user can mutate their workspace without ever
  // seeing what would change for the currently-typed path — exactly the
  // surprise issue #1440 calls out about the existing RPC's `dry_run=true`
  // default, and the regression CodeRabbit flagged on PR #2087.
  const canApply =
    previewReport != null &&
    previewInput != null &&
    previewInput.vendor === vendor &&
    previewInput.source === normalizedSource &&
    !isApplying &&
    !isPreviewing;

  const runPreview = useCallback(async () => {
    setError(null);
    setIsPreviewing(true);
    setAppliedReport(null);
    try {
      log('[migration] preview start vendor=%s source=%s', vendor, normalizedSource ?? '<default>');
      const response = await runMigrationRpc(true);
      // `runMigrationRpc` returns `CommandResponse<MigrationReport>`
      // — `.result` is the actual report.
      setPreviewReport(response.result);
      setPreviewInput({ vendor, source: normalizedSource });
      log(
        '[migration] preview ok stats=%o warnings=%d',
        response.result.stats,
        response.result.warnings.length
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('[migration] preview failed: %s', message);
      setError(message);
      setPreviewReport(null);
      setPreviewInput(null);
    } finally {
      setIsPreviewing(false);
    }
  }, [runMigrationRpc, vendor, normalizedSource]);

  const runApply = useCallback(async () => {
    if (!canApply || previewReport == null) return;
    setError(null);
    setIsApplying(true);
    try {
      log('[migration] apply start vendor=%s source=%s', vendor, normalizedSource ?? '<default>');
      const response = await runMigrationRpc(false);
      setAppliedReport(response.result);
      // Clear preview so the operator can't accidentally re-apply the same
      // dry-run a second time without re-previewing the new on-disk state.
      setPreviewReport(null);
      setPreviewInput(null);
      log('[migration] apply ok stats=%o', response.result.stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('[migration] apply failed: %s', message);
      setError(message);
    } finally {
      setIsApplying(false);
      setConfirmOpen(false);
    }
  }, [runMigrationRpc, previewReport, canApply, vendor, normalizedSource]);

  const reportToRender = appliedReport ?? previewReport;
  const plannedCount = previewReport
    ? previewReport.stats.from_sqlite +
      previewReport.stats.from_markdown -
      previewReport.stats.skipped_unchanged
    : 0;

  return (
    <SettingsPanel description={t('pages.settings.account.migrationDesc')}>
      {/* ── Source: which assistant, where it lives, and the two actions ── */}
      <Card
        title={t('migration.sourceHeading')}
        description={t('migration.sourceHeadingDesc')}
        data-testid="migration-form">
        <div className="p-4">
          <RadioGroupRoot
            value={vendor}
            onValueChange={next => setVendor(next as Vendor)}
            aria-label={t('migration.vendorLabel')}
            className="grid gap-2 sm:grid-cols-2"
            data-testid="migration-vendor-select">
            {VENDORS.map(({ value, labelKey, descKey, icon: Icon }) => {
              const selected = vendor === value;
              const inputId = `migration-vendor-${value}`;
              return (
                <label
                  key={value}
                  htmlFor={inputId}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                    selected
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover'
                  )}>
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      selected
                        ? 'bg-primary-500 text-content-inverted'
                        : 'bg-surface-muted text-content-secondary'
                    )}>
                    <Icon className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-content">{t(labelKey)}</span>
                    <span className="mt-0.5 block text-xs text-content-muted">{t(descKey)}</span>
                  </span>
                  <RadioGroupItem
                    id={inputId}
                    value={value}
                    data-testid={`migration-vendor-option-${value}`}
                    className="shrink-0"
                  />
                </label>
              );
            })}
          </RadioGroupRoot>
        </div>

        <Field
          stacked
          htmlFor="migration-source"
          label={t('migration.sourceLabel')}
          description={t('migration.sourceHint')}
          control={
            <TextField
              id="migration-source"
              mono
              data-testid="migration-source-input"
              value={sourcePath}
              onChange={e => setSourcePath(e.target.value)}
              placeholder={
                vendor === 'hermes'
                  ? t('migration.sourcePlaceholderHermes')
                  : t('migration.sourcePlaceholder')
              }
              className="w-full"
            />
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="max-w-[60ch] text-xs text-content-muted">
            {t('migration.applyDisclaimer')}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leadingIcon={isPreviewing ? <Spinner /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              data-testid="migration-preview-button"
              onClick={() => void runPreview()}
              disabled={isPreviewing || isApplying}>
              {isPreviewing ? t('migration.previewRunning') : t('migration.previewAction')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              leadingIcon={<Download className="h-3.5 w-3.5" aria-hidden />}
              data-testid="migration-apply-button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canApply}>
              {t('migration.applyAction')}
            </Button>
          </div>
        </div>
      </Card>

      {error != null && (
        <Alert variant="destructive" density="compact" data-testid="migration-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Report: what a preview found, or what an import copied ─────── */}
      {reportToRender != null && (
        <Card
          title={
            appliedReport != null
              ? t('migration.reportTitleApplied')
              : t('migration.reportTitlePreview')
          }
          description={
            appliedReport != null
              ? t('migration.report.appliedHint')
              : t('migration.report.previewHint')
          }
          headerRight={
            <Badge variant={appliedReport != null ? 'success' : 'neutral'}>
              {appliedReport != null ? t('migration.badgeImported') : t('migration.badgePreview')}
            </Badge>
          }
          data-testid={
            appliedReport != null ? 'migration-report-applied' : 'migration-report-preview'
          }>
          <dl className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
            {[
              { key: 'migration.report.fromSqlite', value: reportToRender.stats.from_sqlite },
              { key: 'migration.report.fromMarkdown', value: reportToRender.stats.from_markdown },
              {
                key: 'migration.report.imported',
                value: reportToRender.stats.imported,
                testId: 'migration-report-imported',
              },
              {
                key: 'migration.report.skippedUnchanged',
                value: reportToRender.stats.skipped_unchanged,
              },
              {
                key: 'migration.report.renamedConflicts',
                value: reportToRender.stats.renamed_conflicts,
              },
            ].map(stat => (
              // Label first in the DOM (dt before dd), number first on screen.
              <div
                key={stat.key}
                className="flex flex-col-reverse gap-0.5 rounded-lg bg-surface-muted px-3 py-2.5">
                <dt className="text-[11px] leading-tight text-content-muted">{t(stat.key)}</dt>
                <dd
                  className="text-lg font-semibold tabular-nums text-content"
                  data-testid={stat.testId}>
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <Field
            label={t('migration.report.source')}
            control={
              <span
                className="max-w-[60%] break-all text-right font-mono text-xs text-content"
                data-testid="migration-report-source">
                {reportToRender.source_workspace}
              </span>
            }
          />
          <Field
            label={t('migration.report.target')}
            control={
              <span
                className="max-w-[60%] break-all text-right font-mono text-xs text-content"
                data-testid="migration-report-target">
                {reportToRender.target_workspace}
              </span>
            }
          />
          {reportToRender.warnings.length > 0 && (
            <div className="p-4">
              <Alert variant="warning" density="compact">
                <div className="space-y-1">
                  <AlertTitle>{t('migration.report.warnings')}</AlertTitle>
                  <ul
                    data-testid="migration-report-warnings"
                    className="list-inside list-disc space-y-0.5">
                    {reportToRender.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </Alert>
            </div>
          )}
        </Card>
      )}

      <AlertDialogRoot
        open={confirmOpen}
        onOpenChange={open => {
          if (!isApplying) setConfirmOpen(open);
        }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogTitle>{t('migration.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {previewReport &&
              t(
                plannedCount === 1
                  ? 'migration.confirmImport.singular'
                  : 'migration.confirmImport.plural'
              )
                .replace('{count}', String(plannedCount))
                .replace('{source}', previewReport.source_workspace)
                .replace('{target}', previewReport.target_workspace)}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplying}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isApplying}
              data-testid="migration-confirm-button"
              onClick={event => {
                // Keep the dialog open until the import settles.
                event.preventDefault();
                void runApply();
              }}>
              {isApplying && <Spinner />}
              {isApplying ? t('migration.applyRunning') : t('migration.applyAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </SettingsPanel>
  );
};

export default MigrationPanel;
