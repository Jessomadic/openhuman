import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '../../../components/assistant-ui/elements/todo-list';
import { PinnedTodoCard } from './PinnedTodoCard';

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
    expect(screen.getByText('Failed step — Retry needed')).toBeVisible();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(
      screen.getAllByTestId('todo-item').map(item => item.getAttribute('data-status'))
    ).toEqual(['pending', 'done', 'failed']);
  });

  it('uses the upstream plan header and spacing without a custom disclosure', () => {
    const { container } = render(<PinnedTodoCard threadId="t1" items={active} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-slot="agent-plan"]')).toHaveClass('gap-3');
    expect(screen.getByText('Step one')).toBeVisible();
    expect(screen.getByText('Step two')).toBeVisible();
  });
});
