/**
 * Task-sources commands.
 *
 * Thin wrappers around the core `openhuman.task_sources_*` JSON-RPC
 * surface. These operations return bare values (the core ops attach no
 * log envelope), so `callCoreRpc<T>` resolves directly to the typed
 * payload.
 */
import { callCoreRpc } from '../../services/coreRpcClient';

export type TaskSourceProvider = 'github' | 'notion' | 'linear' | 'clickup';

export type TaskSourceTarget = 'agent_todo_proactive' | 'todo_only';

/** A selectable container a task source can target (e.g. a Notion database).
 *  Mirrors the Rust `TaskContainer` (`{ id, title }`). */
export interface TaskContainer {
  id: string;
  title: string;
}

/** Per-provider filter, discriminated by `provider`. Mirrors the Rust
 *  `FilterSpec` (serde snake_case, tagged by `provider`). */
export type TaskSourceFilter =
  | {
      provider: 'github';
      repo?: string;
      labels?: string[];
      assignee_is_me?: boolean;
      state?: string;
      extra?: Record<string, unknown>;
    }
  | {
      provider: 'notion';
      database_id?: string;
      assigned_to_me?: boolean;
      status?: string;
      extra?: Record<string, unknown>;
    }
  | {
      provider: 'linear';
      team_id?: string;
      assignee_is_me?: boolean;
      state?: string;
      extra?: Record<string, unknown>;
    }
  | {
      provider: 'clickup';
      team_id?: string;
      list_id?: string;
      assignee_is_me?: boolean;
      extra?: Record<string, unknown>;
    };

export interface TaskSource {
  id: string;
  provider: TaskSourceProvider;
  connectionId?: string;
  name?: string;
  enabled: boolean;
  filter: TaskSourceFilter;
  intervalSecs: number;
  target: TaskSourceTarget;
  maxTasksPerFetch: number;
  createdAt: string;
  lastFetchAt?: string;
  lastStatus?: string;
}

export interface NormalizedTask {
  externalId: string;
  sourceId: string;
  provider: string;
  title: string;
  body?: string;
  url?: string;
  status?: string;
  assignee?: string;
  due?: string;
  labels: string[];
  priority?: string;
  updatedAt?: string;
}

export interface FetchOutcome {
  sourceId: string;
  provider: string;
  fetched: number;
  routed: number;
  skippedDupe: number;
  pruned: number;
  error?: string;
}

export interface TaskSourcesStatus {
  enabled: boolean;
  defaultIntervalSecs: number;
  sourceCount: number;
  enabledSourceCount: number;
}

export interface TaskSourcePatch {
  name?: string;
  enabled?: boolean;
  filter?: TaskSourceFilter;
  intervalSecs?: number;
  target?: TaskSourceTarget;
  maxTasksPerFetch?: number;
  connectionId?: string;
}

export interface TaskSourceAddParams {
  provider: TaskSourceProvider;
  filter: TaskSourceFilter;
  name?: string;
  connection_id?: string;
  interval_secs?: number;
  target?: TaskSourceTarget;
  max_tasks_per_fetch?: number;
}

export async function openhumanTaskSourcesList(): Promise<TaskSource[]> {
  return await callCoreRpc<TaskSource[]>({ method: 'openhuman.task_sources_list' });
}

export async function openhumanTaskSourcesGet(id: string): Promise<TaskSource> {
  return await callCoreRpc<TaskSource>({ method: 'openhuman.task_sources_get', params: { id } });
}

export async function openhumanTaskSourcesAdd(params: TaskSourceAddParams): Promise<TaskSource> {
  return await callCoreRpc<TaskSource>({
    method: 'openhuman.task_sources_add',
    params: params as unknown as Record<string, unknown>,
  });
}

export async function openhumanTaskSourcesUpdate(
  id: string,
  patch: TaskSourcePatch
): Promise<TaskSource> {
  return await callCoreRpc<TaskSource>({
    method: 'openhuman.task_sources_update',
    params: { id, patch },
  });
}

export async function openhumanTaskSourcesRemove(
  id: string
): Promise<{ id: string; removed: boolean; pruned?: number }> {
  return await callCoreRpc<{ id: string; removed: boolean; pruned?: number }>({
    method: 'openhuman.task_sources_remove',
    params: { id },
  });
}

export async function openhumanTaskSourcesFetch(id: string): Promise<FetchOutcome> {
  return await callCoreRpc<FetchOutcome>({
    method: 'openhuman.task_sources_fetch',
    params: { id },
  });
}

export async function openhumanTaskSourcesSync(): Promise<FetchOutcome[]> {
  return await callCoreRpc<FetchOutcome[]>({ method: 'openhuman.task_sources_sync' });
}

export async function openhumanTaskSourcesListTasks(
  id: string,
  limit = 50
): Promise<NormalizedTask[]> {
  return await callCoreRpc<NormalizedTask[]>({
    method: 'openhuman.task_sources_list_tasks',
    params: { id, limit },
  });
}

export async function openhumanTaskSourcesPreviewFilter(
  provider: TaskSourceProvider,
  filter: TaskSourceFilter,
  connectionId?: string,
  max?: number
): Promise<NormalizedTask[]> {
  return await callCoreRpc<NormalizedTask[]>({
    method: 'openhuman.task_sources_preview_filter',
    params: { provider, filter, connection_id: connectionId, max },
  });
}

/** List the selectable containers (e.g. Notion databases) a provider exposes
 *  for the given connection, so the create form can offer a picker instead of
 *  a raw-id text field. */
export async function openhumanTaskSourcesListDatabases(
  provider: TaskSourceProvider,
  connectionId?: string
): Promise<TaskContainer[]> {
  return await callCoreRpc<TaskContainer[]>({
    method: 'openhuman.task_sources_list_databases',
    params: { provider, connection_id: connectionId },
  });
}

export async function openhumanTaskSourcesStatus(): Promise<TaskSourcesStatus> {
  return await callCoreRpc<TaskSourcesStatus>({ method: 'openhuman.task_sources_status' });
}
