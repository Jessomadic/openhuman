import type { Thread } from '../../../types/thread';

export const GENERAL_TAB_VALUE = 'general';
export const TASKS_TAB_VALUE = 'tasks';
const LEGACY_TASK_LABELS = ['agent-task', 'worker'];
/** Labels that identify meeting transcript threads (now folded into Tasks). */
const MEETINGS_LABELS = ['meetings', 'Meetings'];

function hasAnyLabel(thread: Thread, labels: readonly string[]): boolean {
  return Boolean(thread.labels?.some(label => labels.includes(label)));
}

function isTaskThread(thread: Thread): boolean {
  return Boolean(
    thread.parentThreadId ||
    hasAnyLabel(thread, [TASKS_TAB_VALUE, ...LEGACY_TASK_LABELS, ...MEETINGS_LABELS])
  );
}

/**
 * Pure, side-effect-free thread filter shared between
 * `Conversations.tsx` (which renders the sidebar list) and the test
 * suite.
 *
 * Rules:
 *   - Tasks includes `tasks`-labelled threads, legacy worker/sub-agent threads,
 *     and meeting transcript threads.
 *   - General is the fallback bucket for everything else.
 */
export function isThreadVisibleInTab(thread: Thread, selectedLabel: string): boolean {
  const isTask = isTaskThread(thread);
  if (selectedLabel === TASKS_TAB_VALUE) return isTask;
  if (selectedLabel === GENERAL_TAB_VALUE) return !isTask;
  return Boolean(thread.labels?.includes(selectedLabel));
}
