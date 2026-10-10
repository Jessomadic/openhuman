/**
 * The thread's live steps pinned above the composer using assistant-ui's
 * AgentPlan, in a disclosure that remembers the user's choice.
 *
 * Open by default while a step is in progress and collapsed otherwise, until
 * the user opens or closes it by hand: that choice is remembered per thread in
 * `userScopedStorage` and wins from then on.
 */
import debugFactory from 'debug';
import { ChevronRightIcon, ListChecksIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AgentPlan } from '../../../components/assistant-ui/elements/agent-plan';
import { type TodoItem, todoProgress } from '../../../components/assistant-ui/elements/todo-list';
import { cn } from '../../../components/assistant-ui/lib/utils';
import { Button } from '../../../components/assistant-ui/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/assistant-ui/ui/collapsible';
import { useT } from '../../../lib/i18n/I18nContext';
import { userScopedStorage } from '../../../store/userScopedStorage';

const debug = debugFactory('conversations:todos');

/** `userScopedStorage` key holding `{ [threadId]: open }`. */
export const TODO_CARD_OPEN_KEY = 'chat.todoCardOpen';
/** How many threads' choices are kept; the oldest are dropped first. */
const MAX_REMEMBERED = 50;

type OpenMap = Record<string, boolean>;

async function readOpenMap(): Promise<OpenMap> {
  try {
    const raw = await userScopedStorage.getItem(TODO_CARD_OPEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as OpenMap) : {};
  } catch {
    return {};
  }
}

async function rememberOpen(threadId: string, open: boolean): Promise<void> {
  const map = await readOpenMap();
  delete map[threadId];
  map[threadId] = open;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) {
    delete map[stale];
  }
  await userScopedStorage.setItem(TODO_CARD_OPEN_KEY, JSON.stringify(map));
}

/** The card's open state: the user's remembered choice, else open while a step runs. */
export function useTodoCardOpen(
  threadId: string,
  anyActive: boolean
): [boolean, (open: boolean) => void] {
  const [remembered, setRemembered] = useState<{ threadId: string; open: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readOpenMap().then(map => {
      if (cancelled) return;
      const open = map[threadId];
      setRemembered(typeof open === 'boolean' ? { threadId, open } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const setOpen = useCallback(
    (open: boolean) => {
      setRemembered({ threadId, open });
      debug('todo card %s thread=%s', open ? 'opened' : 'closed', threadId);
      void rememberOpen(threadId, open);
    },
    [threadId]
  );

  const choice = remembered?.threadId === threadId ? remembered.open : undefined;
  return [choice ?? anyActive, setOpen];
}

export function PinnedTodoCard({
  threadId,
  items,
  className,
}: {
  threadId: string;
  items: readonly TodoItem[];
  className?: string;
}) {
  const { t } = useT();
  const progress = todoProgress(items);
  const [open, setOpen] = useTodoCardOpen(threadId, progress.anyActive);
  const countLabel = t('chat.todos.ofTotal')
    .replace('{done}', String(progress.done))
    .replace('{total}', String(progress.total));
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div
        data-testid="todo-checklist"
        data-open={open ? 'true' : 'false'}
        data-todo-completed={progress.done}
        data-todo-total={progress.total}
        className={cn('bg-background flex w-full flex-col gap-1 rounded-lg px-2 py-1', className)}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('conversations.runMode.plan')}
            className="h-auto w-full justify-start gap-2 px-0 py-1 text-xs">
            <ListChecksIcon aria-hidden className="text-muted-foreground size-3.5" />
            <span className="flex-1 text-start">{t('conversations.runMode.plan')}</span>
            <span className="text-muted-foreground font-mono text-[11px]">
              {progress.allDone ? t('chat.todos.completed') : countLabel}
            </span>
            <ChevronRightIcon
              aria-hidden
              className={cn('size-3 transition-transform', open && 'rotate-90')}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount asChild>
          <div hidden={!open} className="max-h-[min(160px,24dvh)] overflow-y-auto pb-1">
            <AgentPlan
              steps={items.map(item =>
                item.reason && item.status === 'failed'
                  ? `${item.text} — ${item.reason}`
                  : item.text
              )}
              statuses={items.map(item => item.status)}
              activeIndex={progress.done}
              compact
              showHeader={false}
              stepTestId="todo-item"
              className="max-w-none"
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default PinnedTodoCard;
