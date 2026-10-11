/**
 * Tests for the Settings → Account landing panel.
 *
 * Verifies that the signed-in summary header renders the user's display name
 * and a "signed in" label when a current user is present, and that the name
 * is omitted (while the signed-in label still renders) when no name is set.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../test/test-utils';
import AccountPanel from '../AccountPanel';

const mockUseCoreState = vi.fn();

vi.mock('../../../../providers/CoreStateProvider', () => ({
  useCoreState: () => mockUseCoreState(),
}));

vi.mock('../../../../hooks/useUsageState', () => ({
  useUsageState: () => ({ currentPlan: null }),
}));

// Isolate the panel from the destructive logout/clear actions (which pull in
// session + clear-data plumbing we don't exercise here).
vi.mock('../../LogoutAndClearActions', () => ({
  default: () => <div data-testid="logout-and-clear-actions" />,
}));

describe('AccountPanel', () => {
  it('renders the signed-in summary with name and signed-in label', () => {
    mockUseCoreState.mockReturnValue({
      snapshot: { currentUser: { firstName: 'Test', lastName: 'Human', username: 'testhuman' } },
    });

    renderWithProviders(<AccountPanel />);

    expect(screen.getByText('Test Human')).toBeInTheDocument();
    expect(screen.getByText('Signed in to OpenHuman')).toBeInTheDocument();
    expect(screen.getByTestId('logout-and-clear-actions')).toBeInTheDocument();
  });

  it('renders just the signed-in label when only a username is present (no display name)', () => {
    mockUseCoreState.mockReturnValue({ snapshot: { currentUser: { username: 'solohuman' } } });

    renderWithProviders(<AccountPanel />);

    // No display name, so no name text renders, but the signed-in label and
    // profile card still do.
    expect(screen.getByTestId('account-profile')).toBeInTheDocument();
    expect(screen.getByText('Signed in to OpenHuman')).toBeInTheDocument();
    expect(screen.queryByText('Test Human')).not.toBeInTheDocument();
  });

  it('omits the summary block when there is no current user', () => {
    mockUseCoreState.mockReturnValue({ snapshot: { currentUser: null } });

    renderWithProviders(<AccountPanel />);

    // The summary is gone but the logout/clear actions section still renders.
    expect(screen.getByTestId('logout-and-clear-actions')).toBeInTheDocument();
    expect(screen.queryByText('@solohuman')).not.toBeInTheDocument();
  });
});
