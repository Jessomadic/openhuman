import { configureStore } from '@reduxjs/toolkit';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';

import chatRuntimeReducer from '../../store/chatRuntimeSlice';
import threadReducer from '../../store/threadSlice';
import { useOpenHumanExternalStore } from '../useOpenHumanExternalStore';

vi.mock('../../services/api/threadApi', () => ({
  threadApi: { getDerivedTranscript: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) },
}));

describe('assistant-ui thread identity', () => {
  it('projects the real thread id so native thread switching can reset the viewport', () => {
    const store = configureStore({
      reducer: { thread: threadReducer, chatRuntime: chatRuntimeReducer },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) => useOpenHumanExternalStore(threadId),
      { wrapper, initialProps: { threadId: 'first' as string | null } }
    );
    expect(result.current.adapters).toMatchObject({ threadList: { threadId: 'first' } });
    rerender({ threadId: 'second' });
    expect(result.current.adapters).toMatchObject({ threadList: { threadId: 'second' } });
    rerender({ threadId: null });
    expect(result.current.adapters).toMatchObject({ threadList: { threadId: undefined } });
  });
});
