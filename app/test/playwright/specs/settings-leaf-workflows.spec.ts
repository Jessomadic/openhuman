import { expect, type Page, test } from '@playwright/test';

import {
  bootAuthenticatedPage,
  dismissWalkthroughIfPresent,
  waitForAppReady,
} from '../helpers/core-rpc';

async function openSettings(page: Page, userId: string, hash: string): Promise<void> {
  await bootAuthenticatedPage(page, userId, hash);
  await waitForAppReady(page);
  await dismissWalkthroughIfPresent(page);
}

async function themeState(
  page: Page
): Promise<{ mode?: string; tabBarLabels?: string; agentMessageViewMode?: string }> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __OPENHUMAN_STORE__?: {
          getState?: () => {
            theme?: { mode?: string; tabBarLabels?: string; agentMessageViewMode?: string };
          };
        };
      }
    ).__OPENHUMAN_STORE__;
    return store?.getState?.().theme ?? {};
  });
}

async function persistedThemeState(
  page: Page
): Promise<{ mode?: string; tabBarLabels?: string; agentMessageViewMode?: string }> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('persist:theme');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return {
        mode: parsed.mode ? JSON.parse(parsed.mode) : undefined,
        tabBarLabels: parsed.tabBarLabels ? JSON.parse(parsed.tabBarLabels) : undefined,
        agentMessageViewMode: parsed.agentMessageViewMode
          ? JSON.parse(parsed.agentMessageViewMode)
          : undefined,
      };
    } catch {
      return {};
    }
  });
}

function unwrap<T>(value: T | { result: T }): T {
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result: T }).result;
  }
  return value as T;
}

test.describe('Settings leaf workflows', () => {
  test('appearance theme persists in app state', async ({ page }) => {
    await openSettings(page, 'pw-settings-appearance', '/settings/theme');

    const dark = page.getByLabel('Theme variant').getByText('Dark', { exact: true });
    await expect(dark).toBeVisible();
    await dark.click();
    await expect.poll(() => themeState(page)).toMatchObject({ mode: 'dark' });
    await expect.poll(() => persistedThemeState(page)).toMatchObject({ mode: 'dark' });

    await page.reload();
    await waitForAppReady(page);
    await expect.poll(() => themeState(page)).toMatchObject({ mode: 'dark' });
  });

  test('retired task sources route lands on Connections', async ({ page }) => {
    await openSettings(page, 'pw-settings-task-sources', '/settings/task-sources');

    await expect
      .poll(async () => page.evaluate(() => window.location.hash))
      .toContain('/connections');
    await expect(page.getByRole('button', { name: 'Connections' }).first()).toBeVisible();
  });
});
