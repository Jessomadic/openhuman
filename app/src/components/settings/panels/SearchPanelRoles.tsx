/*
 * The Routing tab of the web search settings: which provider serves each
 * role, laid out like the LLM page's routing table (task on the left, the
 * provider it runs on on the right).
 *
 * The ordered fallback list used to sit open under every role, with move,
 * remove and add buttons for each entry, so the answer to "who does search?"
 * was buried in controls for changing it. The table states the answer; the
 * list opens in a dialog from that row when the user wants to change it.
 */
import { ChevronDownIcon, ChevronRight, ChevronUpIcon, PlusIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';

import type {
  SearchProviderInfo,
  SearchRole,
  SearchSettings,
  SearchSettingsUpdate,
} from '../../../utils/tauriCommands/config';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { ModalShell } from '../../ui/ModalShell';
import Switch from '../../ui/Switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import {
  roleDescription,
  roleTitle,
  SEARCH_ROLES,
  SearchProviderSwatch,
  type Translate,
  withProvider,
} from './searchPanelShared';

export { SEARCH_ROLES } from './searchPanelShared';

/** Move `order[index]` by `delta` places, returning a new array. */
export function moveProvider(order: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

interface RoleProps {
  role: SearchRole;
  settings: SearchSettings;
  saving: boolean;
  persist: (update: SearchSettingsUpdate) => Promise<boolean>;
  t: Translate;
}

/** The configured order for a role, limited to providers that can serve it. */
function roleOrder(
  role: SearchRole,
  settings: SearchSettings,
  byId: Map<string, SearchProviderInfo>
) {
  return (settings.roles[role] ?? []).filter(id => byId.get(id)?.roles.includes(role));
}

/**
 * The fallback-order editor for one role: the ordered provider list the user
 * can reorder, trim and reset, plus "add" buttons for providers that can
 * serve the role but are not in the list.
 */
const RoleOrderEditor = ({ role, settings, saving, persist, t }: RoleProps) => {
  const byId = new Map<string, SearchProviderInfo>(settings.providers.map(p => [p.id, p]));
  const order = roleOrder(role, settings, byId);
  const effective = settings.effective_roles[role] ?? [];
  const servingId = effective[0];
  const addable = settings.providers.filter(p => p.roles.includes(role) && !order.includes(p.id));
  const testId = `search-role-${role}`;

  const saveOrder = (next: string[]) => void persist({ roles: { [role]: next } });

  return (
    <div className="flex flex-col gap-3">
      <ol className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line-subtle bg-surface-subtle">
        {order.map((id, index) => {
          const provider = byId.get(id);
          if (!provider) return null;
          const usable = effective.includes(id);
          return (
            <li
              key={id}
              data-testid={`${testId}-provider-${id}`}
              data-serving={servingId === id ? 'true' : undefined}
              className="flex items-center gap-2.5 px-3 py-2">
              <span className="w-4 text-xs tabular-nums text-content-muted">{index + 1}</span>
              <SearchProviderSwatch id={provider.id} label={provider.label} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-content">{provider.label}</span>
              {servingId === id && (
                <Badge variant="success">{t('settings.search.roleServing')}</Badge>
              )}
              {!usable && <Badge variant="neutral">{t('settings.search.roleUnavailable')}</Badge>}
              <Button
                type="button"
                variant="tertiary"
                size="xs"
                iconOnly
                aria-label={withProvider(t('settings.search.roleMoveUp'), provider.label)}
                disabled={saving || index === 0}
                onClick={() => saveOrder(moveProvider(order, index, -1))}>
                <ChevronUpIcon className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="tertiary"
                size="xs"
                iconOnly
                aria-label={withProvider(t('settings.search.roleMoveDown'), provider.label)}
                disabled={saving || index === order.length - 1}
                onClick={() => saveOrder(moveProvider(order, index, 1))}>
                <ChevronDownIcon className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="tertiary"
                tone="danger"
                size="xs"
                iconOnly
                aria-label={withProvider(t('settings.search.roleRemove'), provider.label)}
                disabled={saving || order.length <= 1}
                onClick={() => saveOrder(order.filter(other => other !== id))}>
                <XIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ol>

      {addable.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {addable.map(provider => (
            <Button
              key={provider.id}
              type="button"
              variant="secondary"
              size="xs"
              data-testid={`${testId}-add-${provider.id}`}
              disabled={saving}
              leadingIcon={<PlusIcon className="size-3" aria-hidden="true" />}
              onClick={() => saveOrder([...order, provider.id])}>
              {withProvider(t('settings.search.roleAdd'), provider.label)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

/** One role's table row: what the role is, and the provider serving it now. */
const RoleRow = ({ role, settings, onEdit, t }: RoleProps & { onEdit: () => void }) => {
  const byId = new Map<string, SearchProviderInfo>(settings.providers.map(p => [p.id, p]));
  const effective = settings.effective_roles[role] ?? [];
  const serving = effective[0] ? byId.get(effective[0]) : undefined;
  const fallbacks = effective
    .slice(1)
    .map(id => byId.get(id)?.label)
    .filter(Boolean)
    .join(', ');
  const testId = `search-role-${role}`;

  return (
    <TableRow data-testid={testId}>
      <TableCell className="py-3 pl-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-content">{roleTitle(role, t)}</span>
          <span className="text-xs text-content-muted">{roleDescription(role, t)}</span>
        </div>
      </TableCell>
      <TableCell className="py-3 pr-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onEdit}
          data-testid={`${testId}-edit`}
          aria-label={`${roleTitle(role, t)}: ${serving?.label ?? t('settings.search.roleNoProviderShort')}`}
          className="h-auto w-64 justify-start gap-2.5 px-2.5 py-1.5 text-left">
          {serving && <SearchProviderSwatch id={serving.id} label={serving.label} />}
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              data-testid={`${testId}-serving`}
              className={
                serving
                  ? 'truncate text-xs font-medium text-content'
                  : 'truncate text-xs font-medium text-amber-700 dark:text-amber-300'
              }>
              {serving ? serving.label : t('settings.search.roleNoProviderShort')}
            </span>
            <span className="truncate text-[11px] font-normal text-content-muted">
              {fallbacks
                ? t('settings.search.roleFallbacks').replace('{providers}', fallbacks)
                : t('settings.search.roleNoFallback')}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
};

interface Props {
  settings: SearchSettings;
  saving: boolean;
  persist: (update: SearchSettingsUpdate) => Promise<boolean>;
  t: Translate;
}

/** The Routing tab: the roles table, its order dialog, and the advanced toggle. */
const SearchPanelRoles = ({ settings, saving, persist, t }: Props) => {
  const [editing, setEditing] = useState<SearchRole | null>(null);
  const presentationId = useId();
  const dialogTitleId = useId();

  return (
    <div className="flex w-full flex-col gap-4">
      <Card
        data-testid="search-roles"
        title={t('settings.search.rolesTitle')}
        description={t('settings.search.rolesDesc')}
        className="w-full">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">{t('settings.ai.routing.columnTask')}</TableHead>
              <TableHead className="w-px whitespace-nowrap pr-4">
                {t('settings.ai.routing.columnRoute')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SEARCH_ROLES.map(role => (
              <RoleRow
                key={role}
                role={role}
                settings={settings}
                saving={saving}
                persist={persist}
                onEdit={() => setEditing(role)}
                t={t}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card data-testid="search-advanced" title={t('settings.search.advancedTitle')}>
        <div className="flex items-center gap-3 p-4">
          <label htmlFor={presentationId} className="min-w-0 flex-1">
            <span className="block text-sm text-content">
              {t('settings.search.exposeProviderTools')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-content-muted">
              {t('settings.search.exposeProviderToolsDesc')}
            </span>
          </label>
          <Switch
            id={presentationId}
            data-testid="search-presentation-toggle"
            aria-label={t('settings.search.exposeProviderTools')}
            checked={settings.presentation === 'all_tools'}
            disabled={saving}
            onCheckedChange={next => void persist({ presentation: next ? 'all_tools' : 'roles' })}
          />
        </div>
      </Card>

      {editing && (
        <ModalShell
          title={roleTitle(editing, t)}
          titleId={dialogTitleId}
          subtitle={t('settings.search.roleDialogDesc')}
          onClose={() => setEditing(null)}
          maxWidthClassName="max-w-md"
          testId={`search-role-${editing}-dialog`}
          footer={
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                data-testid={`search-role-${editing}-reset`}
                disabled={saving}
                onClick={() => void persist({ roles: { [editing]: [] } })}>
                {t('settings.search.roleReset')}
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={() => setEditing(null)}>
                {t('common.close')}
              </Button>
            </div>
          }>
          <RoleOrderEditor
            role={editing}
            settings={settings}
            saving={saving}
            persist={persist}
            t={t}
          />
        </ModalShell>
      )}
    </div>
  );
};

export default SearchPanelRoles;
