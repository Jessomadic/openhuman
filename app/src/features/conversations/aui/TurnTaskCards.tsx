import { useAuiState } from '@assistant-ui/react';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { TaskCard } from '../../../components/assistant-ui/elements/task-card';
import { TodoItems } from '../../../components/assistant-ui/elements/todo-list';
import { useDisclosure } from '../../../components/assistant-ui/lib/useDisclosure';
import { useT } from '../../../lib/i18n/I18nContext';
import { useAuiThreadId } from '../../../providers/AssistantUiRuntimeProvider';
import { userScopedStorage } from '../../../store/userScopedStorage';
import { toAuiTodoItems } from './TodoListPart';
import { useThreadTodos } from './useThreadTodos';
import { useThreadGoal } from './useThreadGoal';
import { taskFinished, updateTaskHistory, type TurnTask } from './taskCardHistory';

const Tasks = createContext<TurnTask[]>([]);

/** Presentation snapshots belong to turns, rather than the moving composer. */
export function TurnTaskProvider({ children }: PropsWithChildren) {
  const threadId = useAuiThreadId();
  const todos = useThreadTodos(threadId);
  const goal = useThreadGoal(threadId);
  const anchor = useAuiState(s => s.thread.messages.filter(message => message.role === 'user').at(-1)?.id ?? s.thread.messages[0]?.id ?? '');
  const [saved, setSaved] = useState<{ threadId: string | null; ready: boolean; cards: TurnTask[] }>({threadId: null, ready: false, cards: []});
  useEffect(() => {
    let cancelled = false;
    setSaved({threadId, ready: false, cards: []});
    if (!threadId) return;
    void userScopedStorage.getItem(`chat-task-cards:${threadId}`).then(value => {
      if (cancelled) return;
      let cards: TurnTask[] = [];
      try { const parsed: unknown = JSON.parse(value ?? '[]'); if (Array.isArray(parsed)) cards = parsed.filter(item => typeof item?.anchor === 'string' && Array.isArray(item?.todos)); } catch { /* Older or unavailable presentation cache. */ }
      setSaved({threadId, ready: true, cards});
    });
    return () => { cancelled = true; };
  }, [threadId]);
  useEffect(() => {
    if (!saved.ready || saved.threadId !== threadId || !threadId) return;
    const cards = updateTaskHistory(saved.cards, {anchor, todos: todos ?? [], goal});
    if (cards === saved.cards) return;
    setSaved({...saved, cards});
    void userScopedStorage.setItem(`chat-task-cards:${threadId}`, JSON.stringify(cards));
  }, [anchor, todos, goal, saved, threadId]);
  return <Tasks.Provider value={saved.threadId === threadId ? saved.cards : []}>{children}</Tasks.Provider>;
}

function TurnTaskCard({ task }: { task: TurnTask }) {
  const { t } = useT();
  const threadId = useAuiThreadId();
  const done = taskFinished(task);
  const [open, setOpen] = useDisclosure(`task:${threadId}:${task.anchor}`, !done);
  const state = done ? 'done' : task.goal && task.goal.status !== 'active' ? 'waiting' : 'working';
  return <TaskCard data-testid="todo-checklist" label={task.goal?.objective ?? t('conversations.runMode.plan')} state={state} open={open} onOpenChange={setOpen} className="max-w-none">
    <TodoItems items={toAuiTodoItems(task.todos)} compact />
  </TaskCard>;
}

/** Mount only on the first assistant response to the anchored user message. */
export function TurnTaskCards() {
  const cards = useContext(Tasks);
  const anchor = useAuiState(s => {
    const index = s.thread.messages.findIndex(message => message.id === s.message.id);
    let user = '';
    for (let i = 0; i < index; i++) {
      const message = s.thread.messages[i];
      if (message?.role === 'user') user = message.id;
      else if (message?.role === 'assistant') user = '';
    }
    return user || (index === 0 ? s.message.id : '');
  });
  return <>{cards.filter(task => task.anchor === anchor).map(task => <TurnTaskCard key={task.anchor} task={task} />)}</>;
}
