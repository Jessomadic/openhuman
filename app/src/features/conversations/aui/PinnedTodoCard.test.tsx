import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '../../../components/assistant-ui/elements/todo-list';
import { PinnedTodoCard, TODO_CARD_OPEN_KEY } from './PinnedTodoCard';

vi.mock('../../../lib/i18n/I18nContext', () => ({ useT: () => ({ t: (key: string) => key }) }));

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../../../store/userScopedStorage', () => ({
  userScopedStorage: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
  },
}));

const active: TodoItem[] = [
  { id: '1', text: 'Step one', status: 'done' },
  { id: '2', text: 'Step two', status: 'active' },
];
const idle: TodoItem[] = [
  { id: '1', text: 'Step one', status: 'done' },
  { id: '2', text: 'Step two', status: 'pending' },
];

function toggle() {
  return screen.getByRole('button', { name: 'conversations.runMode.plan' });
}

describe('PinnedTodoCard', () => {
  beforeEach(() => store.clear());

  it('renders the live progress using the assistant-ui agent plan', () => {
    const { container } = render(<PinnedTodoCard threadId="t1" items={active} />);
    expect(container.querySelector('[data-slot="agent-plan"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="todo-progress-card"]')).toBeNull();
  });

  it('keeps pending and failed steps from appearing to run when progress is not sequential', () => {
    const { container } = render(
      <PinnedTodoCard
        threadId="t1"
        items={[
          { id: 'pending', text: 'Waiting step', status: 'pending' },
          { id: 'done', text: 'Finished step', status: 'done' },
          { id: 'failed', text: 'Failed step', status: 'failed', reason: 'Retry needed' },
        ]}
      />
    );
    fireEvent.click(toggle());
    expect(screen.getByText('Failed step — Retry needed')).toBeVisible();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(
      screen.getAllByTestId('todo-item').map(item => item.getAttribute('data-status'))
    ).toEqual(['pending', 'done', 'failed']);
  });

  it('opens while a step is active and stays collapsed otherwise', async () => {
    const { rerender } = render(<PinnedTodoCard threadId="t1" items={active} />);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'));
    rerender(<PinnedTodoCard threadId="t1" items={idle} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers a manual choice per thread', async () => {
    const { unmount } = render(<PinnedTodoCard threadId="t1" items={active} />);
    await act(async () => {});
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() =>
      expect(JSON.parse(store.get(TODO_CARD_OPEN_KEY) ?? '{}')).toEqual({ t1: false })
    );
    unmount();

    // The remembered choice wins over the active-step default on remount.
    render(<PinnedTodoCard threadId="t1" items={active} />);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'false'));
  });

  it("does not carry one thread's choice to another", async () => {
    store.set(TODO_CARD_OPEN_KEY, JSON.stringify({ t1: false }));
    render(<PinnedTodoCard threadId="t2" items={active} />);
    await act(async () => {});
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });
});
