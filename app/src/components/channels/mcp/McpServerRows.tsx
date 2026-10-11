/**
 * Servers — the user's declared MCP servers, as the standard `DataTable`
 * (search, transport filter, paging; only the rows scroll).
 *
 * The first tab of the MCP page. A row is an identity on the left (icon, name,
 * how it runs), then type, status, tool count, and its controls as icons on the right:
 * connect or disconnect, enable or disable, remove. Labelled buttons pushed a
 * row four controls deep onto two lines, and the second line was always the
 * one carrying the command — the row's own information lost to its chrome.
 * Every icon keeps its sentence in a tooltip and in its accessible name; see
 * `McpIconButton`.
 *
 * The name opens the server's detail (credential form, tool list, playground).
 * Nothing here adds a server: that is the mcp.json tab's job, and the empty
 * state says so.
 */
import {
  ChevronRight,
  Pencil,
  Plug,
  Plus,
  Power,
  PowerOff,
  Server,
  Trash2,
  Unplug,
  Wrench,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../../../lib/i18n/I18nContext';
import { mcpClientsApi } from '../../../services/api/mcpClientsApi';
import { Alert, AlertDescription } from '../../ui';
import Badge, { type BadgeVariant } from '../../ui/Badge';
import Button from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import DataTable, { type DataTableColumn } from '../../ui/DataTable';
import { TableCell, TableRow } from '../../ui/Table';
import ConnectAuthModal from './ConnectAuthModal';
import McpIconButton from './McpIconButton';
import McpServerForm from './McpServerForm';
import McpToolPlayground from './McpToolPlayground';
import RowIcon from './RowIcon';
import type { ConnStatus, InstalledServer, McpTool, ServerStatus } from './types';

interface McpServerRowsProps {
  servers: InstalledServer[];
  statuses: ConnStatus[];
  /** Open a server's detail view. */
  onOpen: (serverId: string) => void;
  /** Re-read rows and statuses after a control changed something. */
  onChanged: () => Promise<void>;
  /** Jump to the mcp.json tab, from the empty state. */
  onAddInJson: () => void;
}

/** How a row is dialled, as one line: the hosted endpoint or the local command. */
const dialOf = (server: InstalledServer): string => {
  if (server.transport?.kind === 'http_remote') return server.transport.url;
  return [server.command, ...server.args].filter(Boolean).join(' ');
};

/** Status chip per connection state; `null` for a plain disconnected row. */
const STATUS_TONE: Record<ServerStatus, { variant: BadgeVariant; labelKey: string } | null> = {
  connected: { variant: 'success', labelKey: 'channels.status.connected' },
  connecting: { variant: 'primary', labelKey: 'channels.status.connecting' },
  unauthorized: { variant: 'warning', labelKey: 'mcp.status.unauthorized' },
  error: { variant: 'danger', labelKey: 'channels.status.error' },
  disconnected: null,
  disabled: null,
};

type ToolsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; tools: McpTool[] };

/**
 * The tools one connected server advertises, listed under its row, each with
 * a Try button that opens the execution playground. Read on demand — the row
 * carries a tool *count* from the status poll; the names and schemas are
 * fetched when the user asks for them.
 */
const McpRowTools = ({
  server,
  onTry,
}: {
  server: InstalledServer;
  onTry: (tool: McpTool) => void;
}) => {
  const { t } = useT();
  const [state, setState] = useState<ToolsState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    mcpClientsApi
      .listTools(server.server_id)
      .then(tools => {
        if (live) setState({ kind: 'ready', tools });
      })
      .catch((err: unknown) => {
        if (live) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : t('mcp.rows.toolsFailed'),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [server.server_id, t]);

  if (state.kind === 'loading') {
    return (
      <p className="text-xs text-content-muted" data-testid="mcp-row-tools-loading">
        {t('mcp.rows.toolsLoading')}
      </p>
    );
  }
  if (state.kind === 'error') {
    return <p className="text-xs text-coral-600 dark:text-coral-300">{state.message}</p>;
  }
  if (state.tools.length === 0) {
    return <p className="text-xs text-content-muted">{t('mcp.toolList.noTools')}</p>;
  }
  return (
    <ul className="space-y-1 rounded-md bg-surface-muted p-2" data-testid="mcp-row-tools">
      {state.tools.map(tool => (
        <li key={tool.name} className="flex items-start justify-between gap-2 text-xs">
          <span className="min-w-0">
            <span className="font-mono font-medium text-content">{tool.name}</span>
            {tool.description ? (
              <span className="text-content-muted"> — {tool.description}</span>
            ) : null}
          </span>
          <Button
            variant="tertiary"
            size="xs"
            onClick={() => onTry(tool)}
            aria-label={t('mcp.toolList.tryToolAria').replace('{name}', tool.name)}
            className="h-auto shrink-0 p-0 font-medium text-primary-600 hover:underline dark:text-primary-400">
            {t('mcp.toolList.tryTool')}
          </Button>
        </li>
      ))}
    </ul>
  );
};

const McpServerRows = ({
  servers,
  statuses,
  onOpen,
  onChanged,
  onAddInJson,
}: McpServerRowsProps) => {
  const { t } = useT();
  // The id of the row currently mutating. Every handler serialises on it, so
  // while one is in flight the controls on ALL rows disable, not just the busy
  // one: a guard that is invisible on the other rows accepts clicks and
  // silently does nothing. The active control still shows its own spinner.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectFor, setConnectFor] = useState<InstalledServer | null>(null);
  const [removeFor, setRemoveFor] = useState<InstalledServer | null>(null);
  // `null` closed, `undefined` adding, a server editing.
  const [form, setForm] = useState<InstalledServer | null | undefined>(null);
  // The rows whose tool lists are open, and the tool staged in the playground.
  const [toolsOpen, setToolsOpen] = useState<Set<string>>(() => new Set());
  const [playground, setPlayground] = useState<{ server: InstalledServer; tool: McpTool } | null>(
    null
  );
  const toggleTools = (serverId: string) =>
    setToolsOpen(prev => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });

  // The form wrote the document; the rows re-read it. A server saved with
  // browser sign-in is then opened straight into the connect dialog, which
  // runs the sign-in — the form cannot, because it needs the server's id.
  const handleFormSaved = useCallback(
    async (name: string, { signIn }: { signIn: boolean }) => {
      setForm(null);
      await onChanged();
      if (!signIn) return;
      const fresh = await mcpClientsApi.installedList();
      const saved = fresh.find(s => s.qualified_name === name);
      if (saved) setConnectFor(saved);
    },
    [onChanged]
  );

  const run = useCallback(
    async (serverId: string, task: () => Promise<void>) => {
      if (busy) return;
      setBusy(serverId);
      setError(null);
      try {
        await task();
        await onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('mcp.rows.opFailed'));
      } finally {
        setBusy(null);
      }
    },
    [busy, onChanged, t]
  );

  const statusMap = new Map(statuses.map(s => [s.server_id, s]));
  const [query, setQuery] = useState('');
  const [transports, setTransports] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return servers.filter(server => {
      const kind = server.transport?.kind === 'http_remote' ? 'hosted' : 'local';
      if (transports.size > 0 && !transports.has(kind)) return false;
      if (!needle) return true;
      return (
        server.display_name.toLowerCase().includes(needle) ||
        server.qualified_name.toLowerCase().includes(needle) ||
        dialOf(server).toLowerCase().includes(needle)
      );
    });
  }, [servers, query, transports]);

  const columns: DataTableColumn<InstalledServer>[] = [
    { id: 'name', header: t('common.name'), className: 'w-full max-w-0' },
    { id: 'type', header: t('mcp.tab.transportFilter.label'), className: 'w-px whitespace-nowrap' },
    { id: 'status', header: t('dataTable.column.status'), className: 'w-px whitespace-nowrap' },
    {
      id: 'tools',
      header: t('dataTable.column.tools'),
      align: 'right',
      className: 'w-px whitespace-nowrap tabular-nums',
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('dataTable.column.actions')}</span>,
      align: 'right',
      className: 'w-px whitespace-nowrap',
    },
  ];

  const renderServerRow = (server: InstalledServer) => {
    const conn = statusMap.get(server.server_id);
    const status: ServerStatus = conn?.status ?? 'disconnected';
    const tone = STATUS_TONE[status];
    const hosted = server.transport?.kind === 'http_remote';
    const connected = status === 'connected';
    const rowBusy = busy === server.server_id;
    const toolsShown = connected && toolsOpen.has(server.server_id);
    const lastError = conn?.last_error && status !== 'connected' ? conn.last_error : null;
    return (
      <Fragment key={server.server_id}>
        <TableRow data-testid="mcp-installed-row">
          <TableCell className="w-full max-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <RowIcon>
                {server.icon_url ? (
                  <img src={server.icon_url} alt="" className="size-full object-cover" />
                ) : (
                  <Server className="size-4 text-content-muted" aria-hidden="true" />
                )}
              </RowIcon>
              <div className="min-w-0">
                {/* The name opens the server's detail view; the chevron says
                    so — hover styling alone would not. */}
                <button
                  type="button"
                  data-testid="mcp-server-open"
                  aria-label={t('mcp.rows.open').replace('{name}', server.display_name)}
                  onClick={() => onOpen(server.server_id)}
                  className="inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded-sm text-sm font-medium text-content transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <span className="truncate">{server.display_name}</span>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-content-muted"
                    aria-hidden="true"
                  />
                </button>
                <p className="truncate font-mono text-xs text-content-muted" title={dialOf(server)}>
                  {dialOf(server)}
                </p>
              </div>
            </div>
          </TableCell>
          <TableCell className="w-px whitespace-nowrap">
            <Badge variant="neutral">
              {t(hosted ? 'mcp.tab.transport.hosted' : 'mcp.tab.transport.local')}
            </Badge>
          </TableCell>
          <TableCell className="w-px whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              {tone ? (
                <Badge variant={tone.variant} data-testid="mcp-row-status">
                  {t(tone.labelKey)}
                </Badge>
              ) : (
                <Badge variant="neutral">{t('channels.status.disconnected')}</Badge>
              )}
              {!server.enabled && (
                <Badge variant="neutral" dot={false} data-testid="mcp-disabled-badge">
                  {t('mcp.status.disabled')}
                </Badge>
              )}
            </span>
          </TableCell>
          <TableCell className="w-px whitespace-nowrap text-right tabular-nums text-content-muted">
            {connected && conn ? conn.tool_count : '—'}
          </TableCell>
          <TableCell className="w-px whitespace-nowrap text-right">
            <span className="inline-flex items-center gap-0.5">
              {server.enabled && (
                <McpIconButton
                  label={t(connected ? 'mcp.rows.disconnect' : 'mcp.rows.connect').replace(
                    '{name}',
                    server.display_name
                  )}
                  icon={connected ? Unplug : Plug}
                  tone={connected ? 'default' : 'primary'}
                  testId="mcp-lifecycle"
                  busy={rowBusy}
                  disabled={busy !== null}
                  onClick={() => {
                    if (connected) {
                      void run(server.server_id, async () => {
                        await mcpClientsApi.disconnect(server.server_id);
                      });
                    } else {
                      setConnectFor(server);
                    }
                  }}
                />
              )}
              {connected && (
                <McpIconButton
                  label={t(toolsShown ? 'mcp.rows.hideTools' : 'mcp.rows.showTools').replace(
                    '{name}',
                    server.display_name
                  )}
                  icon={Wrench}
                  testId="mcp-tools"
                  disabled={busy !== null}
                  onClick={() => toggleTools(server.server_id)}
                />
              )}
              <McpIconButton
                label={t(server.enabled ? 'mcp.rows.disable' : 'mcp.rows.enable').replace(
                  '{name}',
                  server.display_name
                )}
                icon={server.enabled ? Power : PowerOff}
                testId="mcp-toggle"
                busy={rowBusy}
                disabled={busy !== null}
                onClick={() =>
                  void run(server.server_id, async () => {
                    await mcpClientsApi.setEnabled(server.server_id, !server.enabled);
                  })
                }
              />
              <McpIconButton
                label={t('mcp.rows.edit').replace('{name}', server.display_name)}
                icon={Pencil}
                testId="mcp-edit"
                disabled={busy !== null}
                onClick={() => setForm(server)}
              />
              <McpIconButton
                label={t('mcp.rows.remove').replace('{name}', server.display_name)}
                icon={Trash2}
                tone="destructive"
                testId="mcp-remove"
                disabled={busy !== null}
                onClick={() => setRemoveFor(server)}
              />
            </span>
          </TableCell>
        </TableRow>
        {/* Detail row: the last connection error and/or the expanded tool
            list, spanning the whole table under its server. */}
        {(lastError || toolsShown) && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="space-y-2 pt-0">
              {lastError && <p className="pl-11 text-xs text-content-muted">{lastError}</p>}
              {toolsShown && (
                <div className="pl-11">
                  <McpRowTools server={server} onTry={tool => setPlayground({ server, tool })} />
                </div>
              )}
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="mcp-servers-section">
      <DataTable<InstalledServer>
        title={t('mcp.rows.title')}
        description={t('mcp.rows.intro')}
        actions={
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => setForm(undefined)}
            data-testid="mcp-add-server">
            {t('mcp.rows.add')}
          </Button>
        }
        columns={columns}
        rows={visible}
        rowKey={server => server.server_id}
        renderRow={server => renderServerRow(server)}
        search={
          servers.length > 0
            ? {
                value: query,
                onChange: setQuery,
                placeholder: t('mcp.rows.searchPlaceholder'),
                testId: 'mcp-servers-search',
              }
            : undefined
        }
        filters={
          servers.length > 0
            ? [
                {
                  id: 'transport',
                  label: t('mcp.tab.transportFilter.label'),
                  ariaLabel: t('mcp.tab.transportFilter.aria'),
                  options: [
                    { value: 'hosted', label: t('mcp.tab.transport.hosted') },
                    { value: 'local', label: t('mcp.tab.transport.local') },
                  ],
                  selected: transports,
                  onChange: setTransports,
                  testId: 'mcp-transport-filter',
                },
              ]
            : undefined
        }
        pagination={{ pageSize: 25 }}
        error={
          error ? (
            <Alert variant="destructive" density="compact">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : undefined
        }
        empty={
          servers.length === 0 ? (
            <div className="space-y-2 text-center" data-testid="mcp-installed-empty">
              <p className="text-sm text-content-muted">{t('mcp.installed.empty')}</p>
              <p className="flex items-center justify-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setForm(undefined)}>
                  {t('mcp.rows.add')}
                </Button>
                <Button variant="tertiary" size="sm" onClick={onAddInJson}>
                  {t('mcp.installed.emptyAddInJson')}
                </Button>
              </p>
            </div>
          ) : undefined
        }
        ariaLabel={t('mcp.rows.title')}
      />

      {playground && (
        <McpToolPlayground
          serverId={playground.server.server_id}
          tool={playground.tool}
          onClose={() => setPlayground(null)}
        />
      )}

      {form !== null && (
        <McpServerForm
          existing={form ?? undefined}
          onClose={() => setForm(null)}
          onSaved={(name, opts) => void handleFormSaved(name, opts)}
        />
      )}

      {connectFor && (
        <ConnectAuthModal
          server={connectFor}
          onClose={() => setConnectFor(null)}
          onConnected={() => {
            setConnectFor(null);
            void onChanged();
          }}
        />
      )}

      {removeFor && (
        <ConfirmDialog
          title={t('mcp.rows.removeTitle').replace('{name}', removeFor.display_name)}
          body={t('mcp.rows.removeBody')}
          confirmLabel={t('common.remove')}
          destructive
          busy={busy === removeFor.server_id}
          testId="mcp-remove-dialog"
          onCancel={() => setRemoveFor(null)}
          onConfirm={() => {
            const target = removeFor;
            void run(target.server_id, async () => {
              await mcpClientsApi.uninstall(target.server_id);
            }).then(() => setRemoveFor(null));
          }}
        />
      )}
    </section>
  );
};

export default McpServerRows;
