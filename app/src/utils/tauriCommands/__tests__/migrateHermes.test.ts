import { describe, expect, it, vi } from 'vitest';

import { callCoreRpc } from '../../../services/coreRpcClient';
import { openhumanMigrateHermes } from '../core';

vi.mock('../../../services/coreRpcClient', () => ({
  callCoreRpc: vi.fn(),
  clearCoreRpcTokenCache: vi.fn(),
}));

describe('openhumanMigrateHermes', () => {
  it('calls core RPC without requiring the Tauri shell', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: {}, logs: [] } as never);
    await openhumanMigrateHermes();
    expect(callCoreRpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: expect.stringContaining('hermes') })
    );
  });
});
