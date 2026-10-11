/**
 * PrivacyPanel — analytics toggle failure path.
 *
 * This file used to cover the "what leaves my computer" capability catalog
 * (per-capability data-kind badges, leaves-device/destinations copy, and the
 * catalog's loading/empty/error states). That whole feature — and the
 * `listCapabilities` RPC call, the `privacy.dataKind.*` / `privacy.leavesDevice`
 * / `privacy.staysLocal` / `privacy.sentTo` / `privacy.whatLeavesComputer` copy,
 * and the `privacy-capability-list` / `privacy-row-*` / `privacy-load-error`
 * markup it rendered — was removed from `PrivacyPanel.tsx` in the redesign
 * (see the diff dropping the `AnnotatedCapability` state, `kindLabel`, and the
 * "What leaves my computer" `SettingsSection`). None of those i18n keys or
 * testids exist any more, so every test that exercised them was deleted
 * outright rather than rewritten — there is no current behavior to assert.
 *
 * What remains: the analytics toggle's failure path (`PrivacyPanel.tsx`'s
 * `handleToggleAnalytics` swallows a rejected `setAnalyticsEnabled` and keeps
 * the panel mounted), which is real, still-current behavior worth its own
 * regression test.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../test/test-utils';
import PrivacyPanel from '../PrivacyPanel';

const setAnalyticsEnabledMock = vi.fn();
vi.mock('../../../../providers/CoreStateProvider', () => ({
  useCoreState: () => ({
    snapshot: { analyticsEnabled: false },
    setAnalyticsEnabled: (v: boolean) => setAnalyticsEnabledMock(v),
  }),
}));

vi.mock('../../hooks/useSettingsNavigation', () => ({
  useSettingsNavigation: () => ({ navigateBack: vi.fn(), breadcrumbs: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('PrivacyPanel — analytics toggle', () => {
  it('does not crash, and keeps the panel usable, when persisting fails', async () => {
    setAnalyticsEnabledMock.mockRejectedValueOnce(new Error('config write failed'));
    renderWithProviders(<PrivacyPanel />);

    const toggle = await screen.findByTestId('privacy-analytics-toggle');
    fireEvent.click(toggle);

    await waitFor(() => expect(setAnalyticsEnabledMock).toHaveBeenCalledWith(true));
    // The panel swallows the failure by design (`PrivacyPanel.tsx`'s
    // `handleToggleAnalytics` catch block); what must hold is that it stays
    // rendered rather than tearing down.
    expect(screen.getByTestId('privacy-analytics-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('settings-privacy-panel')).toBeInTheDocument();
  });
});
