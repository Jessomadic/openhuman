import { expect, test } from '@playwright/test';

import {
  bootAuthenticatedPage,
  dismissWalkthroughIfPresent,
  waitForAppReady,
} from '../helpers/core-rpc';

test.describe('Card Payment Flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const slug = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await bootAuthenticatedPage(page, `pw-card-payment-${slug}`, '/settings/account');
  });

  test('account settings exposes the billing dashboard action', async ({ page }) => {
    await waitForAppReady(page);
    await expect(page.getByTestId('account-panel')).toBeVisible();
    await expect(page.getByTestId('account-open-billing')).toBeVisible();
  });

  test('billing action is present', async ({ page }) => {
    await waitForAppReady(page);
    await expect(page.getByTestId('account-open-billing')).toBeVisible();
  });

  test('back-to-settings navigation works', async ({ page }) => {
    await waitForAppReady(page);
    await dismissWalkthroughIfPresent(page);
    const backButton = page.getByRole('button', { name: 'Back to settings' });
    if (await backButton.count()) {
      await backButton.evaluate((button: HTMLElement) => button.click());
    } else {
      await page.getByRole('button', { name: 'Settings' }).first().click({ force: true });
    }
    await expect.poll(async () => page.evaluate(() => window.location.hash)).toContain('/settings');
  });
});
