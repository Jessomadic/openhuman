import { isTauri } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, type Mock, test, vi } from 'vitest';

import { callCoreRpc } from '../../services/coreRpcClient';
import type { ServiceState } from '../tauriCommands';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('../../services/coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

describe('Web → frontend JSON-RPC → Core bridge', () => {
  const mockIsTauri = isTauri as Mock;
  const mockCallCoreRpc = callCoreRpc as Mock;
  let openhumanServiceStatus: typeof import('../tauriCommands').openhumanServiceStatus;
  let openhumanAgentServerStatus: typeof import('../tauriCommands').openhumanAgentServerStatus;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    const actual = await vi.importActual<typeof import('../tauriCommands')>('../tauriCommands');
    openhumanServiceStatus = actual.openhumanServiceStatus;
    openhumanAgentServerStatus = actual.openhumanAgentServerStatus;
  });

  test('routes service status via JSON-RPC client and returns core payload', async () => {
    const expectedState: ServiceState = 'Running';
    const rpcResponse = { result: { state: expectedState }, logs: ['service status fetched'] };

    mockCallCoreRpc.mockResolvedValueOnce(rpcResponse);

    const response = await openhumanServiceStatus();

    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.service_status' });
    expect(response).toEqual(rpcResponse);
    expect(response.result.state).toBe(expectedState);
  });

  test('routes agent server status via JSON-RPC client', async () => {
    const rpcResponse = {
      result: { running: true, url: 'http://127.0.0.1:8421/rpc' },
      logs: ['agent server status checked'],
    };

    mockCallCoreRpc.mockResolvedValueOnce(rpcResponse);

    const response = await openhumanAgentServerStatus();

    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.agent_server_status' });
    expect(response.result.running).toBe(true);
    expect(response.result.url).toContain('127.0.0.1');
  });

  test('routes service status via JSON-RPC in web-only mode without Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(false);
    const rpcResponse = { result: { state: 'Running' as ServiceState }, logs: [] };
    mockCallCoreRpc.mockResolvedValueOnce(rpcResponse);

    await expect(openhumanServiceStatus()).resolves.toEqual(rpcResponse);
    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.service_status' });
  });

  test('surfaces the RPC error without the Tauri CLI fallback in web-only mode', async () => {
    mockIsTauri.mockReturnValue(false);
    mockCallCoreRpc.mockRejectedValueOnce(new Error('core unreachable'));

    await expect(openhumanServiceStatus()).rejects.toThrow('core unreachable');
  });
});
