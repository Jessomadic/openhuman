import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Search,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n/I18nContext';
import Button from './Button';
import Checkbox from './Checkbox';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from './DropdownMenu';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from './Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';
import TextField from './TextField';

/** One column: a header cell and a function from a row to its cell content. */
export interface DataTableColumn<T> {
  /** Stable id — also the React key for the header and generated cells. */
  id: string;
  header: ReactNode;
  /** Cell content for a row. Omit to render nothing (a spacer column). */
  cell?: (row: T) => ReactNode;
  /** Classes applied to both the `th` and the generated `td`. */
  className?: string;
  /** Header-only classes. */
  headClassName?: string;
  /** Cell-only classes. */
  cellClassName?: string;
  /** Right-aligns the header and the generated cell (numbers, actions). */
  align?: 'left' | 'right';
}

/** A multi-select facet rendered as one dropdown button in the toolbar. */
export interface DataTableFilter {
  id: string;
  /** Button label — the selected count is appended when a subset is active. */
  label: string;
  /** Accessible name for the button (the label is often just "Filter"). */
  ariaLabel?: string;
  options: { value: string; label?: ReactNode }[];
  /** Currently-checked values. Empty and "all" both read as unfiltered. */
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  testId?: string;
}

export interface DataTableSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
}

/**
 * Paging. Two modes, picked by whether `onPageChange` is passed:
 *
 * - **Client** (no `onPageChange`): the table slices `rows` itself and keeps
 *   page / page size in local state. Pass `pageSize` to change the default.
 * - **Server** (`onPageChange` set): `rows` is the current page only; the host
 *   loads pages and owns `page` / `pageSize`. Give `total` when it is known, or
 *   `hasNextPage` for cursor-style "is there more" loading.
 */
export interface DataTablePagination {
  /** 1-based current page (server mode). */
  page?: number;
  pageSize?: number;
  /** Choices for the rows-per-page selector. Default 10 / 25 / 50 / 100. */
  pageSizeOptions?: number[];
  /** Total row count across all pages (server mode, when known). */
  total?: number;
  /** Whether another page exists (server mode, when `total` is unknown). */
  hasNextPage?: boolean;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  testId?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  /** Stable React key per row. */
  rowKey: (row: T, index: number) => string;

  /**
   * Custom row rendering. Return a `<TableRow>` (or anything valid inside
   * `<tbody>`); the `columns` still drive the header, so the two stay aligned.
   * Omit it and rows are generated from each column's `cell`.
   */
  renderRow?: (row: T, index: number) => ReactNode;
  /** Makes generated rows clickable (ignored with `renderRow`). */
  onRowClick?: (row: T) => void;
  /** Extra classes / attributes per generated row. */
  rowClassName?: (row: T, index: number) => string | undefined;
  rowTestId?: string;

  /** Card heading. With neither title nor `actions`, the header is omitted. */
  title?: ReactNode;
  description?: ReactNode;
  /** Right side of the card header (primary actions such as "Add"). */
  actions?: ReactNode;

  /** Search box — the host owns filtering. */
  search?: DataTableSearch;
  /** Facet dropdowns rendered right of the search box. */
  filters?: DataTableFilter[];
  /** A full-width row above the search bar (tabs, segmented controls). */
  toolbarTop?: ReactNode;
  /** Left of the search box. */
  toolbarStart?: ReactNode;
  /** Right of the filters (refresh, export, overflow menus). */
  toolbarEnd?: ReactNode;

  pagination?: DataTablePagination | boolean;

  /** Draws skeleton rows in the body while true. */
  loading?: boolean;
  loadingRows?: number;
  loadingTestId?: string;
  loadingLabel?: string;
  /** Rendered above the rows when set. */
  error?: ReactNode;
  /** Rendered in the body when there are no rows and nothing is loading. */
  empty?: ReactNode;
  /** Rendered under the rows inside the scroll region (e.g. "Load more"). */
  footer?: ReactNode;

  /**
   * Fill the parent's height (default). The card is `flex-1 min-h-0` and only
   * its body scrolls, so the page itself never does — the parent must be a
   * height-bounded flex column (e.g. `SettingsPanel scrollable={false}`).
   * Pass `false` for a table that sits in a scrolling page among other cards;
   * it is then capped at `maxHeight` and scrolls internally past that.
   */
  fill?: boolean;
  /** Body height cap when `fill` is false. Default `28rem`. */
  maxHeight?: string;

  ariaLabel?: string;
  className?: string;
  testId?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

function DataTableFilterMenu({ filter }: { filter: DataTableFilter }) {
  const { t } = useT();
  const partial = filter.selected.size > 0 && filter.selected.size < filter.options.length;

  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={filter.testId}
          leadingIcon={<Filter className="h-3.5 w-3.5" aria-hidden />}
          aria-label={filter.ariaLabel ?? filter.label}
          className="shrink-0">
          {filter.label}
          {partial ? ` (${filter.selected.size})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {filter.options.map(option => {
          const active = filter.selected.has(option.value);
          return (
            <DropdownMenuItem
              key={option.value}
              // Keep the menu open: toggling several facets in a row is the
              // normal interaction.
              onSelect={event => {
                event.preventDefault();
                const next = new Set(filter.selected);
                if (active) next.delete(option.value);
                else next.add(option.value);
                filter.onChange(next);
              }}>
              <Checkbox
                checked={active}
                onCheckedChange={() => {}}
                aria-hidden
                className="pointer-events-none"
              />
              <span>{option.label ?? option.value}</span>
            </DropdownMenuItem>
          );
        })}
        {filter.options.length === 0 && (
          <DropdownMenuItem disabled>{t('common.noResults')}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}

interface PaginationBarProps {
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  /** Rows on this page. */
  pageRows: number;
  total?: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  testId?: string;
}

/** Footer: rows-per-page selector, "from–to of total", and page stepping. */
function DataTablePaginationBar({
  page,
  pageSize,
  pageSizeOptions,
  pageRows,
  total,
  hasNextPage,
  onPageChange,
  onPageSizeChange,
  testId,
}: PaginationBarProps) {
  const { t } = useT();
  const pageCount = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const from = pageRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + pageRows;
  const range =
    total != null
      ? t('dataTable.rangeOf')
          .replace('{from}', String(from))
          .replace('{to}', String(to))
          .replace('{total}', String(total))
      : t('dataTable.range').replace('{from}', String(from)).replace('{to}', String(to));

  const pager = (label: string, icon: ReactNode, target: number, disabled: boolean) => (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onPageChange(target)}
      className="h-8 w-8 px-0">
      {icon}
    </Button>
  );

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line px-4 py-2.5 text-xs text-content-muted"
      data-testid={testId}>
      <div className="flex items-center gap-2">
        <span>{t('dataTable.rowsPerPage')}</span>
        <SelectRoot
          value={String(pageSize)}
          onValueChange={value => onPageSizeChange(Number(value))}>
          <SelectTrigger
            inputSize="sm"
            className="h-8 w-18"
            aria-label={t('dataTable.rowsPerPage')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map(size => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      </div>
      <div className="flex items-center gap-4">
        <span className="tabular-nums">{range}</span>
        {pageCount != null && (
          <span className="tabular-nums">
            {t('dataTable.pageOf')
              .replace('{page}', String(page))
              .replace('{pages}', String(pageCount))}
          </span>
        )}
        <div className="flex items-center gap-1">
          {pageCount != null &&
            pager(
              t('dataTable.firstPage'),
              <ChevronsLeft className="h-4 w-4" aria-hidden />,
              1,
              page <= 1
            )}
          {pager(
            t('dataTable.previousPage'),
            <ChevronLeft className="h-4 w-4" aria-hidden />,
            page - 1,
            page <= 1
          )}
          {pager(
            t('dataTable.nextPage'),
            <ChevronRight className="h-4 w-4" aria-hidden />,
            page + 1,
            !hasNextPage
          )}
          {pageCount != null &&
            pager(
              t('dataTable.lastPage'),
              <ChevronsRight className="h-4 w-4" aria-hidden />,
              pageCount,
              page >= pageCount
            )}
        </div>
      </div>
    </div>
  );
}

/**
 * The app's standard table: a card with an optional title / description /
 * actions header, a toolbar (slot above, search in the middle with slots to
 * its left and right), one scrolling body with a pinned header row, and an
 * optional pagination footer.
 *
 * ## Layout
 *
 * By default the card fills its parent (`flex-1 min-h-0`) and **only the rows
 * scroll** — the header, toolbar and footer stay put, and the page itself
 * never scrolls. That needs a height-bounded flex-column parent; in Settings
 * that is `<SettingsPanel scrollable={false} bodyClassName="flex h-full
 * min-h-0 flex-col gap-4">`. A table among other cards on a scrolling page
 * passes `fill={false}` and scrolls internally past `maxHeight`.
 *
 * ## Why one scroll container
 *
 * The rows region is the only scroller and owns both axes, which is what makes
 * `sticky top-0` on the header work. `Table` is rendered with
 * `containerClassName="w-full"` so it does not add its own `overflow-x-auto`
 * wrapper — a nested scroller would capture the sticky header (see `Table`).
 *
 * ## Filtering and sorting are the host's job
 *
 * `search` and `filters` are controlled inputs; the table never filters rows.
 * Client-side paging is the one data operation it does itself, because it is
 * the same everywhere.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  renderRow,
  onRowClick,
  rowClassName,
  rowTestId,
  title,
  description,
  actions,
  search,
  filters,
  toolbarTop,
  toolbarStart,
  toolbarEnd,
  pagination,
  loading = false,
  loadingRows = 6,
  loadingTestId,
  loadingLabel,
  error,
  empty,
  footer,
  fill = true,
  maxHeight = '28rem',
  ariaLabel,
  className,
  testId,
}: DataTableProps<T>) {
  const { t } = useT();
  const searchId = useId();

  // ── Paging ────────────────────────────────────────────────────────────
  const paging: DataTablePagination | null =
    pagination === true ? {} : pagination ? pagination : null;
  const serverMode = paging?.onPageChange != null;
  const pageSizeOptions = paging?.pageSizeOptions ?? DEFAULT_PAGE_SIZES;
  const [localPage, setLocalPage] = useState(1);
  const [localSize, setLocalSize] = useState(paging?.pageSize ?? pageSizeOptions[1] ?? 25);

  const pageSize = serverMode ? (paging?.pageSize ?? localSize) : localSize;
  const total = serverMode ? paging?.total : rows.length;
  const pageCount = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  // Clamp at render: a shrinking result set (new search) must not strand the
  // view on an empty page past the end.
  const rawPage = serverMode ? (paging?.page ?? 1) : localPage;
  const page = pageCount != null ? Math.min(Math.max(1, rawPage), pageCount) : Math.max(1, rawPage);

  const visibleRows =
    paging && !serverMode ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  const hasNextPage = serverMode
    ? (paging?.hasNextPage ?? (pageCount != null && page < pageCount))
    : pageCount != null && page < pageCount;

  const changePage = (next: number) => {
    if (serverMode) paging?.onPageChange?.(next);
    else setLocalPage(next);
  };
  const changePageSize = (size: number) => {
    if (serverMode) {
      paging?.onPageSizeChange?.(size);
      paging?.onPageChange?.(1);
    } else {
      setLocalSize(size);
      setLocalPage(1);
    }
  };

  // ── Chrome ────────────────────────────────────────────────────────────
  const hasHeader = title != null || actions != null;
  const hasToolbar = Boolean(toolbarStart || search || filters?.length || toolbarEnd);
  const showTable = !loading && visibleRows.length > 0;
  // 16px gutters on the outer columns, for generated AND custom rows.
  const edgeCells = '[&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:pr-4';

  const head = (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {columns.map(column => (
          <TableHead
            key={column.id}
            // Opaque fill: rows scroll underneath the pinned header.
            className={cn(
              'sticky top-0 z-10 bg-surface-muted',
              column.align === 'right' && 'text-right',
              column.className,
              column.headClassName
            )}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  const body = (
    <TableBody>
      {visibleRows.map((row, index) =>
        renderRow ? (
          renderRow(row, index)
        ) : (
          <TableRow
            key={rowKey(row, index)}
            data-testid={rowTestId}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={
              onRowClick
                ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }
                : undefined
            }
            tabIndex={onRowClick ? 0 : undefined}
            className={cn(
              onRowClick &&
                'cursor-pointer focus-visible:bg-surface-hover focus-visible:outline-hidden',
              rowClassName?.(row, index)
            )}>
            {columns.map(column => (
              <TableCell
                key={column.id}
                className={cn(
                  column.align === 'right' && 'text-right',
                  column.className,
                  column.cellClassName
                )}>
                {column.cell?.(row)}
              </TableCell>
            ))}
          </TableRow>
        )
      )}
    </TableBody>
  );

  return (
    <section
      data-slot="data-table"
      data-testid={testId}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-line bg-surface',
        fill && 'min-h-0 flex-1',
        className
      )}>
      {hasHeader && (
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            {title != null && <h3 className="text-sm font-semibold text-content">{title}</h3>}
            {description != null && (
              <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{description}</p>
            )}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      {(toolbarTop != null || hasToolbar) && (
        <div className="shrink-0 space-y-3 px-4 py-3">
          {toolbarTop}
          {hasToolbar && (
            <div className="flex flex-wrap items-center gap-2">
              {toolbarStart}
              {search && (
                <div className="relative min-w-48 flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                  />
                  <TextField
                    id={searchId}
                    type="search"
                    inputSize="sm"
                    data-testid={search.testId}
                    value={search.value}
                    onChange={event => {
                      search.onChange(event.target.value);
                      if (!serverMode) setLocalPage(1);
                    }}
                    placeholder={search.placeholder ?? t('common.search')}
                    aria-label={search.ariaLabel ?? search.placeholder ?? t('common.search')}
                    className="pl-9"
                  />
                </div>
              )}
              {filters?.map(filter => (
                <DataTableFilterMenu key={filter.id} filter={filter} />
              ))}
              {toolbarEnd}
            </div>
          )}
        </div>
      )}

      {error != null && <div className="shrink-0 px-4 pb-3">{error}</div>}

      {/* The ONE scroll container (both axes) — see the component docs. */}
      <div
        className={cn('min-h-0 overflow-auto border-t border-line', fill && 'flex-1')}
        style={fill ? undefined : { maxHeight }}>
        {loading ? (
          // Skeleton rows keep the column grid, so the table does not collapse
          // and jolt back when the data lands.
          <div
            role="status"
            aria-busy="true"
            aria-label={loadingLabel ?? t('common.loading')}
            data-testid={loadingTestId}>
            <Table containerClassName="w-full" className={edgeCells}>
              {head}
              <TableBody>
                {Array.from({ length: loadingRows }).map((_, rowIndex) => (
                  <TableRow
                    key={rowIndex}
                    aria-hidden
                    data-testid={loadingTestId ? `${loadingTestId}-row` : undefined}
                    className="hover:bg-transparent">
                    {columns.map(column => (
                      <TableCell key={column.id} className={column.className}>
                        <span className="block h-3.5 w-full animate-pulse rounded bg-surface-subtle" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : showTable ? (
          <>
            <Table containerClassName="w-full" className={edgeCells} aria-label={ariaLabel}>
              {head}
              {body}
            </Table>
            {footer}
          </>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center p-6">
            {empty ?? <p className="text-sm text-content-muted">{t('common.noResults')}</p>}
          </div>
        )}
      </div>

      {paging && (showTable || (serverMode && page > 1)) && (
        <DataTablePaginationBar
          page={page}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          pageRows={visibleRows.length}
          total={total}
          hasNextPage={hasNextPage}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
          testId={paging.testId}
        />
      )}
    </section>
  );
}
