import { describe, expect, it } from 'vitest';
import { updateTaskHistory, type TurnTask } from './taskCardHistory';
const task = (anchor: string, completed = false): TurnTask => ({anchor, goal: null, todos: [{content: 'Inspect UI', status: completed ? 'completed' : 'in_progress'}]});
describe('turn task attachment', () => {
  it('keeps completion attached to its original turn as new messages arrive', () => {
    const running = updateTaskHistory([], task('first'));
    const finished = updateTaskHistory(running, task('second', true));
    expect(finished[0]?.anchor).toBe('first');
    expect(updateTaskHistory(finished, task('second', true))).toBe(finished);
    const next = updateTaskHistory(finished, task('second'));
    expect(next.map(item => item.anchor)).toEqual(['first', 'second']);
    expect(next[0]?.todos[0]?.status).toBe('completed');
  });
});
