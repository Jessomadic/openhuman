import debugFactory from 'debug';
import { MessageSquare, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUser } from '../../../hooks/useUser';
import { useT } from '../../../lib/i18n/I18nContext';
import { feedbackApi } from '../../../services/api/feedbackApi';
import { messageForApiError } from '../../../services/apiError';
import type {
  FeedbackItem,
  FeedbackSort,
  FeedbackStatus,
  FeedbackType,
} from '../../../types/feedback';
import FeedbackFilterSelect from '../../feedback/FeedbackFilterSelect';
import FeedbackItemRow from '../../feedback/FeedbackItemRow';
import FeedbackSubmitForm from '../../feedback/FeedbackSubmitForm';
import {
  Button,
  Card,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  ToggleGroupItem,
  ToggleGroupRoot,
} from '../../ui';
import SettingsPanel from '../layout/SettingsPanel';

const log = debugFactory('feedback:panel');

const PAGE_SIZE = 20;

const SORTS: FeedbackSort[] = ['hot', 'top', 'new'];

const SORT_LABEL_KEYS: Record<FeedbackSort, string> = {
  hot: 'feedback.sort.hot',
  top: 'feedback.sort.top',
  new: 'feedback.sort.new',
};

/**
 * Whether an item belongs in the currently-filtered list. Used both to decide if
 * a freshly-accepted submission should appear (and bump the total) and to detect
 * when a status change pushes a row out of the active filter (e.g. a Feature must
 * not show while the board is filtered to Bugs, an Open item once marked Closed).
 */
export function acceptedItemMatchesFilters(
  item: FeedbackItem,
  typeFilter: FeedbackType | 'all',
  statusFilter: FeedbackStatus | 'all'
): boolean {
  return (
    (typeFilter === 'all' || item.type === typeFilter) &&
    (statusFilter === 'all' || item.status === statusFilter)
  );
}

const FeedbackPanel = () => {
  const { t } = useT();
  const { user } = useUser();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sort, setSort] = useState<FeedbackSort>('hot');
  const [typeFilter, setTypeFilter] = useState<FeedbackType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all');
  const [composeOpen, setComposeOpen] = useState(false);

  const loadRequestIdRef = useRef(0);
  const pageRef = useRef(1);

  const load = useCallback(
    async (page: number, append: boolean) => {
      const requestId = ++loadRequestIdRef.current;
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await feedbackApi.listFeedback({
          sort,
          type: typeFilter === 'all' ? undefined : typeFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          page,
          limit: PAGE_SIZE,
        });
        if (requestId !== loadRequestIdRef.current) return;
        pageRef.current = result.page;
        setTotal(result.total);
        setItems(prev => (append ? [...prev, ...result.items] : result.items));
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) return;
        log('load failed page=%d error=%O', page, error);
        setLoadError(messageForApiError(error, t('feedback.loadError')));
      } finally {
        if (requestId === loadRequestIdRef.current) setIsLoading(false);
      }
    },
    [sort, typeFilter, statusFilter, t]
  );

  // Reload from page 1 whenever the sort/filters change.
  useEffect(() => {
    void load(1, false);
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [load]);

  // Re-anchor the board to the server from page 1. Called after a mutation that can
  // change which rows belong in the current query — a new submission, or a status
  // change that moves a row out of the active filter. Reloading (instead of patching
  // local state) keeps the visible list, the total, and "Load more" paging consistent
  // with the filtered/sorted query rather than letting optimistic edits drift from it.
  const reload = useCallback(() => {
    void load(1, false);
  }, [load]);

  const handleItemChange = (updated: FeedbackItem) => {
    // Votes, comments, and in-filter status edits don't change membership — patch the
    // row in place. Once a status change pushes it out of the active filter, reload so
    // it leaves the list and the total/paging realign with the underlying query.
    if (acceptedItemMatchesFilters(updated, typeFilter, statusFilter)) {
      setItems(prev => prev.map(item => (item.id === updated.id ? updated : item)));
    } else {
      reload();
    }
  };

  // A comment post only bumps the count, but it resolves asynchronously, so merge the
  // delta against the latest row by id — a full reconstructed item from the comment
  // panel could carry stale fields and clobber a concurrent vote or status change.
  const handleCommentAdded = useCallback((id: string) => {
    setItems(prev =>
      prev.map(item => (item.id === id ? { ...item, commentCount: item.commentCount + 1 } : item))
    );
  }, []);

  const handleAccepted = (result: { feedback: FeedbackItem | null }) => {
    const accepted = result.feedback;
    // Reload only when the new item belongs in the current view. Reloading rather than
    // prepending keeps the filtered total and pagination aligned with the server
    // ordering the next "Load more" pages through; a non-matching item changes neither
    // the filtered list nor its total, so there's nothing to refetch.
    if (accepted && acceptedItemMatchesFilters(accepted, typeFilter, statusFilter)) {
      reload();
    }
    // The post is on the board now; close the composer so the user sees it.
    setComposeOpen(false);
  };

  const hasMore = items.length < total;

  return (
    // `SettingsPanel`, the template every routed settings page uses — NOT
    // `SettingsTabbedPage` directly, and not a hand-rolled wrapper.
    //
    // Both mistakes were made moving this page in. As a standalone route it was
    // `<div className="h-full p-4">` around `SettingsTabbedPage`; the wrapper
    // was dropped because `wrapSettingsPage` already scrolls, and dropping it
    // took the `p-4` with it. That gutter is load-bearing: `SettingsTabbedPage`
    // draws its header divider with `-mx-4` to bleed it to the page edge, so
    // without a 4-unit host padding the divider bleeds *past* the page and the
    // body sits flush against the edge. Its own docs say the host must supply
    // it.
    //
    // `SettingsPanel` supplies that gutter and the rest of the conventions —
    // the route-derived title, the back button that hides itself in the
    // two-pane shell, and the sibling sub-nav — so this panel now matches every
    // other one instead of approximating them. The title comes from the
    // `feedback` registry entry rather than being passed here, which is what
    // keeps the sidebar row and the page heading from drifting apart.
    <SettingsPanel
      description={t('feedback.header.desc')}
      testId="feedback-page"
      action={
        <Button
          size="sm"
          leadingIcon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          analyticsId="feedback-compose"
          onClick={() => setComposeOpen(true)}
          data-testid="feedback-compose">
          {t('feedback.submit.heading')}
        </Button>
      }>
      {/* Posting is a secondary action next to reading the board, so the form
          lives in a dialog behind the header button instead of a full-width
          card that pushed the board below the fold. */}
      <DialogRoot open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogTitle className="font-title text-base font-semibold text-content">
            {t('feedback.submit.heading')}
          </DialogTitle>
          <DialogDescription className="mt-0.5 mb-4 text-xs text-content-muted">
            {t('feedback.submit.subheading')}
          </DialogDescription>
          <FeedbackSubmitForm bare onAccepted={handleAccepted} />
        </DialogContent>
      </DialogRoot>

      <section className="space-y-3">
        {/* Toolbar: type chips and status filter on the left, sort on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroupRoot
              type="single"
              variant="secondary"
              size="xs"
              value={typeFilter}
              onValueChange={next => {
                if (next) setTypeFilter(next as FeedbackType | 'all');
              }}
              aria-label={t('feedback.filter.allTypes')}
              className="overflow-hidden rounded-lg border border-line gap-0 *:rounded-none *:border-0">
              {(
                [
                  ['all', t('feedback.filter.allTypes')],
                  ['feature', t('feedback.type.feature')],
                  ['bug', t('feedback.type.bug')],
                ] as const
              ).map(([value, label]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="h-auto px-2.5 py-1 text-xs font-medium data-[state=on]:bg-primary-500 data-[state=on]:text-content-inverted">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroupRoot>
            <FeedbackFilterSelect
              ariaLabel={t('feedback.filter.allStatuses')}
              value={statusFilter}
              onChange={v => setStatusFilter(v as FeedbackStatus | 'all')}
              options={[
                { value: 'all', label: t('feedback.filter.allStatuses') },
                { value: 'open', label: t('feedback.status.open') },
                { value: 'planned', label: t('feedback.status.planned') },
                { value: 'completed', label: t('feedback.status.completed') },
              ]}
            />
          </div>

          {/* A sort control, not a tab set: `aria-pressed` toggles are the
              right semantics here, and `ChipTabs as="tab"` would emit a
              `role="tablist"` with no tabpanel behind it. */}
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {SORTS.map(option => (
              <Button
                key={option}
                type="button"
                variant="tertiary"
                size="xs"
                analyticsId="feedback-sort"
                onClick={() => setSort(option)}
                aria-pressed={sort === option}
                className={`h-auto rounded-none px-2.5 py-1 text-xs ${
                  sort === option ? 'bg-primary-500 text-content-inverted hover:bg-primary-500' : ''
                }`}>
                {t(SORT_LABEL_KEYS[option])}
              </Button>
            ))}
          </div>
        </div>

        {loadError && (
          <p className="rounded-xl bg-coral-500/10 px-4 py-3 text-center text-xs text-coral-600 dark:text-coral-400">
            {loadError}
          </p>
        )}

        <Card
          title={t('feedback.board')}
          headerRight={
            total > 0 ? (
              <span className="text-xs tabular-nums text-content-muted">{total}</span>
            ) : undefined
          }
          className="pb-1"
          data-testid="feedback-board">
          {isLoading && items.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-4">
                <div className="h-12 w-10 animate-pulse rounded-lg bg-surface-subtle" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 animate-pulse rounded bg-surface-subtle" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-surface-subtle" />
                </div>
              </div>
            ))
          ) : items.length > 0 ? (
            items.map(item => (
              <FeedbackItemRow
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onChange={handleItemChange}
                onCommentAdded={handleCommentAdded}
              />
            ))
          ) : loadError ? (
            <div className="px-4 py-8" />
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle">
                <MessageSquare className="h-5 w-5 text-content-faint" aria-hidden />
              </span>
              <p className="text-sm text-content-muted">{t('feedback.empty')}</p>
              <Button variant="secondary" size="sm" onClick={() => setComposeOpen(true)}>
                {t('feedback.submit.heading')}
              </Button>
            </div>
          )}
        </Card>

        {hasMore && (
          <div className="flex justify-center pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(pageRef.current + 1, true)}
              disabled={isLoading}>
              {isLoading ? '...' : t('feedback.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </SettingsPanel>
  );
};

export default FeedbackPanel;
