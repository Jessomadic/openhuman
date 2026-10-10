import { expect, test } from '@playwright/test';

import { selectedThreadId, startNewThread } from '../helpers/chat-drive';
import {
  bootAuthenticatedPage,
  dismissWalkthroughIfPresent,
  waitForAppReady,
} from '../helpers/core-rpc';

test('a stale thread-list response preserves a thread selected while it was in flight', async ({
  page,
}) => {
  await bootAuthenticatedPage(page, 'pw-thread-selection-race', '/chat');
  await waitForAppReady(page);
  await dismissWalkthroughIfPresent(page);

  const selectedDuringLoad = await startNewThread(page);
  const remainingThread = await startNewThread(page);
  expect(remainingThread).not.toBe(selectedDuringLoad);

  let captureRequest: (() => void) | undefined;
  const requestCaptured = new Promise<void>(resolve => {
    captureRequest = resolve;
  });
  let releaseResponse: (() => void) | undefined;
  const responseReleased = new Promise<void>(resolve => {
    releaseResponse = resolve;
  });
  let holdNextThreadList = false;

  await page.route('**/rpc', async (route, request) => {
    const body = JSON.parse(request.postData() || '{}') as { id: number; method: string };
    if (!holdNextThreadList || body.method !== 'openhuman.threads_list') {
      await route.continue();
      return;
    }

    holdNextThreadList = false;
    const response = await route.fetch();
    const payload = (await response.json()) as {
      result: { data: { count: number; threads: Array<{ id: string }> } };
    };
    if (!payload.result?.data?.threads) {
      throw new Error(`unexpected threads_list response: ${JSON.stringify(payload)}`);
    }
    const threadList = payload.result.data;
    payload.result.data = {
      ...threadList,
      threads: threadList.threads.filter(thread => thread.id !== selectedDuringLoad),
    };
    payload.result.data.count = payload.result.data.threads.length;
    captureRequest?.();
    await responseReleased;
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });

  await page.goto('/#/settings/account');
  await waitForAppReady(page);
  holdNextThreadList = true;
  await page.goto('/#/chat');
  await expect(page.getByTestId('chat-message-input')).toBeVisible();
  await requestCaptured;

  await page.getByTestId(`thread-row-${selectedDuringLoad}`).click({ force: true });
  await expect.poll(() => selectedThreadId(page)).toBe(selectedDuringLoad);

  releaseResponse?.();
  await expect
    .poll(() =>
      page.evaluate((threadId: string) => {
        const store = (
          window as typeof window & {
            __OPENHUMAN_STORE__?: {
              getState?: () => { thread?: { threads?: Array<{ id: string }> } };
            };
          }
        ).__OPENHUMAN_STORE__;
        return store?.getState?.().thread?.threads?.some(thread => thread.id === threadId) ?? false;
      }, selectedDuringLoad)
    )
    .toBe(false);
  expect(await selectedThreadId(page)).toBe(selectedDuringLoad);
});
