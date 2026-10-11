import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('PrivacyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips the analytics toggle when clicked (#1698)', async () => {
    renderWithProviders(<PrivacyPanel />);

    const toggle = await screen.findByTestId('privacy-analytics-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setAnalyticsEnabledMock).toHaveBeenCalledWith(true);
    });
  });

  it('renders the Privacy Mode selector and the analytics disclaimer', async () => {
    renderWithProviders(<PrivacyPanel />);

    // Privacy Mode selector (#4435) — the data-egress posture control.
    expect(await screen.findByTestId('privacy-mode-options')).toBeInTheDocument();

    // Analytics section: toggle + explanatory copy of what it collects.
    expect(screen.getByText('Product Analytics')).toBeInTheDocument();
    expect(screen.getByText('Share Product Analytics and Diagnostics')).toBeInTheDocument();
    expect(screen.getByText(/You can change this setting at any time/)).toBeInTheDocument();
  });
});
