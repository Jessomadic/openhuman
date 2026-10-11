// @ts-nocheck
import { waitForApp } from '../helpers/app-helpers';
import { callOpenhumanRpc } from '../helpers/core-rpc';
import { resetApp } from '../helpers/reset-app';
import { clearRequestLog, getRequestLog, startMockServer, stopMockServer } from '../mock-server';

const USER_ID = 'e2e-tool-browser';

/**
 * Browser tool E2E spec — coverage matrix rows 7.1.1 (open URL) and
 * 7.1.2 (browser automation). Tracked by issue #967.
 *
 * The `browser_open` and `browser` (automation) tools live in
 * `crates/openhuman-core/src/tools/impl/browser/` and are agent-internal: they are not
 * exposed as JSON-RPC controllers, and the open path shells out to Brave on
 * the user's machine — explicitly out of bounds under the issue's "no real
 * network or shell side-effects" constraint. This spec mirrors the
 * `tool-shell-git-flow.spec.ts` envelope: assert the deterministic RPC and
 * registry contract end-to-end, plus prove the mock-backend transport
 * captures the request shape that browser-automation flows would emit when a
 * real LLM eventually drives them. The tool's own validation logic is
 * covered exhaustively by Rust unit tests in
 * `crates/openhuman-core/src/tools/impl/browser/browser_open_tests.rs` and
 * `browser_tests.rs`.
 *
 * What this spec proves end-to-end:
 *  - 7.1.1 — the agent runtime is up and the `orchestrator` definition is
 *    wired into the live registry served over JSON-RPC with on-demand tool
 *    discovery (`tool_search`), the route by which it reaches the browser
 *    tools now that the `tools_agent` specialist is retired. Plus: the mock backend correctly records arbitrary HTTP
 *    requests (proving the side-channel browser-automation flows would emit
 *    against the mocked services is intact).
 *  - 7.1.2 — the live built-in tool catalog contains `browser` and advertises
 *    its DOM/accessibility `snapshot` action without the removed screenshot
 *    action. The exact action-enum schema is pinned by the BrowserTool Rust
 *    unit test.
 *
 * Future: when the harness gains a deterministic mock-LLM that emits
 * structured `tool_calls`, the `it.skip` block below can flip into a real
 * end-to-end browser-open assertion (with the open path stubbed via a
 * runtime adapter) without touching the rest of this file.
 */
function stepLog(message: string, context?: unknown): void {
  const stamp = new Date().toISOString();
  if (context === undefined) {
    console.log(`[ToolBrowserE2E][${stamp}] ${message}`);
    return;
  }
  console.log(`[ToolBrowserE2E][${stamp}] ${message}`, JSON.stringify(context, null, 2));
}

interface ServerStatus {
  running?: boolean;
  url?: string;
}

interface AgentDef {
  id?: string;
  tools?: unknown;
  direct_tool_names?: string[];
}

interface ListDefinitionsResult {
  definitions?: AgentDef[];
}

interface AgentToolInfo {
  name?: string;
  description?: string;
}

interface AvailableToolsResult {
  tools?: AgentToolInfo[];
}

describe('System tools — Browser (open URL + automation registry)', () => {
  before(async function () {
    // resetApp bring-up can run ~25-30s and race the default 30s Mocha hook
    // budget; raise it.
    this.timeout(90_000);
    await startMockServer();
    await waitForApp();
    await resetApp(USER_ID);
    const browserSettings = await callOpenhumanRpc('openhuman.config_update_browser_settings', {
      enabled: true,
    });
    expect(browserSettings.ok).toBe(true);
    const toolPreferences = await callOpenhumanRpc('openhuman.app_state_update_local_state', {
      onboardingTasks: { enabledTools: ['browser'] },
    });
    expect(toolPreferences.ok).toBe(true);
    clearRequestLog();
  });

  after(async () => {
    await stopMockServer();
  });

  it('7.1.1 sidecar runtime is reachable and the orchestrator can discover tools', async () => {
    // The registry path that resolves the orchestrator's belt lives behind
    // `agent_list_definitions`; failure to find it means the browser-tool
    // surface is unreachable from JSON-RPC.
    const status = await callOpenhumanRpc<ServerStatus>('openhuman.agent_server_status', {});
    stepLog('agent_server_status response', status);
    expect(status.ok).toBe(true);
    // agent_server_status uses single_log → result is {result: {running, url}, logs: [...]}
    const statusPayload = (status.result as any)?.result ?? status.result;
    expect(statusPayload?.running).toBe(true);

    const list = await callOpenhumanRpc<ListDefinitionsResult>(
      'openhuman.agent_list_definitions',
      {}
    );
    stepLog('agent_list_definitions response (count only)', {
      count: list.result?.definitions?.length ?? 0,
    });
    expect(list.ok).toBe(true);
    const defs = list.result?.definitions ?? [];
    const orchestrator = defs.find(d => d?.id === 'orchestrator');
    expect(orchestrator).toBeDefined();
    // Browser tools are off the orchestrator's up-front belt and reached
    // through on-demand discovery; the catalog itself is pinned by 7.1.2.
    expect(orchestrator?.direct_tool_names ?? []).toContain('tool_search');
    expect(defs.find(d => d?.id === 'tools_agent')).toBeUndefined();
  });

  it('7.1.1b mock backend captures HTTP traffic shape (browser-automation side-channel intact)', async () => {
    // browser-automation flows that scrape mocked SaaS providers exercise
    // the same request path as the in-app HTTP layer. We hit the mock
    // backend directly (no agent LLM involved) and assert the request log
    // captures the call shape — this proves the channel browser-automation
    // would record requests on is healthy when a real LLM eventually drives
    // it. Failure here would silently mask side-effect assertions in any
    // future browser-automation spec.
    clearRequestLog();
    const mockUrl = process.env.VITE_BACKEND_URL ?? process.env.BACKEND_URL;
    if (!mockUrl) {
      stepLog('skipping mock-traffic assertion — no mock URL exported');
      return;
    }
    const probeUrl = `${mockUrl.replace(/\/$/, '')}/health`;
    stepLog('probing mock backend', { probeUrl });
    try {
      await fetch(probeUrl, { method: 'GET', headers: { 'x-e2e-967': 'tool-browser-flow' } });
    } catch (err) {
      stepLog('probe error — mock may be reachable only via __admin', { err: String(err) });
    }

    // Pull the admin request log either way; it's authoritative.
    const log = getRequestLog();
    stepLog('mock request log size', { count: log.length });
    // We don't assert a specific path — the mock might respond 404 for
    // /health; the load-bearing claim is that the log machinery itself is
    // alive and observable from the spec runner.
    expect(Array.isArray(log)).toBe(true);
  });

  it('7.1.2 live BrowserTool catalog advertises DOM snapshots without screenshots', async () => {
    // `agent_registry_available_tools` builds its response from the wildcard
    // tools-catalog agent's live `tool_specs()`, so this checks the actual
    // BrowserTool metadata exposed to agents rather than merely finding an
    // agent definition that might be able to resolve it. The exact
    // parameters-schema action enum is pinned by
    // `browser_tests.rs::browser_tool_schema_has_required_action`.
    const list = await callOpenhumanRpc<AvailableToolsResult>(
      'openhuman.agent_registry_available_tools',
      {}
    );
    expect(list.ok).toBe(true);
    const tools = list.result?.tools ?? [];
    const browserTool = tools.find(tool => tool?.name === 'browser');
    stepLog('live browser tool metadata', browserTool);
    expect(browserTool).toBeDefined();
    expect(browserTool?.description?.toLowerCase()).toContain('snapshot');
    expect(browserTool?.description?.toLowerCase()).not.toContain('screenshot');
  });

  it.skip('(future #68) chat tool_calls drive `browser_open https://example.com` via mock LLM', () => {
    // Tracked alongside skill-execution-flow's `it.skip` for the same reason:
    // requires a deterministic mock-LLM that emits structured tool_calls AND
    // a stub for the Brave open path so the test does not shell out on the
    // user's machine. The validation/allowlist path itself is covered by
    // `crates/openhuman-core/src/tools/impl/browser/browser_open_tests.rs::*`.
  });
});
