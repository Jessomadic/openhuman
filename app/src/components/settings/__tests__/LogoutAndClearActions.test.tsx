import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import LogoutAndClearActions from '../LogoutAndClearActions';

const { mockClearSession, mockClearAllAppData } = vi.hoisted(() => ({
  mockClearSession: vi.fn(),
  mockClearAllAppData: vi.fn(),
}));

vi.mock('../../../providers/CoreStateProvider', () => ({
  useCoreState: () => ({
    clearSession: mockClearSession,
    snapshot: { auth: { userId: null }, currentUser: null },
  }),
}));

vi.mock('../../../utils/clearAllAppData', () => ({
  clearAllAppData: (...args: unknown[]) => mockClearAllAppData(...args),
}));

function renderActions() {
  return renderWithProviders(<LogoutAndClearActions />, {
    preloadedState: { locale: { current: 'en' } },
  });
}

describe('LogoutAndClearActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearSession.mockReset().mockResolvedValue(undefined);
    mockClearAllAppData.mockReset().mockResolvedValue(undefined);
  });

  it('renders log out and clear-data as rows in one Session card, with clearing data visually marked destructive', () => {
    renderActions();
    // The two used to be adjacent rows with the same amber, weight and icon.
    // They now share a single Session card, but clearing data keeps its own
    // destructive-zone wrapper and coral/danger button treatment so it still
    // doesn't read as a peer of the routine, reversible log-out action.
    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-logout')).toHaveTextContent('Log out');
    expect(screen.getByText('Clear app data')).toBeInTheDocument();
    const destructiveZone = screen.getByTestId('account-destructive-zone');
    expect(destructiveZone).toBeInTheDocument();
    const clearButton = screen.getByTestId('settings-nav-logout-and-clear');
    expect(destructiveZone).toContainElement(clearButton);
    expect(clearButton).toHaveTextContent('Clear data');
    expect(clearButton).toHaveAttribute('data-tone', 'danger');
  });

  it('passes the current snapshot user id + clearSession to clearAllAppData', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout-and-clear'));
    const confirmButtons = screen.getAllByRole('button', { name: /Clear App Data/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(mockClearAllAppData).toHaveBeenCalledTimes(1);
    const args = mockClearAllAppData.mock.calls[0][0];
    expect(args).toMatchObject({ userId: null });
    expect(typeof args.clearSession).toBe('function');
  });

  it('surfaces the core error message when clearAllAppData fails (Windows file-lock guidance)', async () => {
    const user = userEvent.setup();
    mockClearAllAppData.mockRejectedValueOnce(
      new Error(
        'Failed to remove C:\\Users\\me\\.openhuman because it is locked by another OpenHuman window or process. Close all OpenHuman windows and try again.'
      )
    );
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout-and-clear'));
    const confirmButtons = screen.getAllByRole('button', { name: /Clear App Data/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(
      await screen.findByText(/locked by another OpenHuman window or process/)
    ).toBeInTheDocument();
  });

  it('falls back to the translated message when the error has no message', async () => {
    const user = userEvent.setup();
    mockClearAllAppData.mockRejectedValueOnce(new Error(''));
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout-and-clear'));
    const confirmButtons = screen.getAllByRole('button', { name: /Clear App Data/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByText(/Failed to clear data and logout/)).toBeInTheDocument();
  });

  it('surfaces logout failures inline next to the Log out row', async () => {
    const user = userEvent.setup();
    mockClearSession.mockRejectedValueOnce(new Error('backend unreachable'));
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout'));

    const alert = await screen.findByTestId('logout-error');
    expect(alert).toHaveTextContent('Failed to log out. Please try again.');
    expect(alert).toBeVisible();
  });

  it('closes the confirm dialog on Cancel without clearing anything', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout-and-clear'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockClearAllAppData).not.toHaveBeenCalled();
  });

  it('keeps the confirm dialog open and shows the error when clearing fails', async () => {
    const user = userEvent.setup();
    mockClearAllAppData.mockRejectedValueOnce(new Error('disk busy'));
    renderActions();

    await user.click(screen.getByTestId('settings-nav-logout-and-clear'));
    await user.click(screen.getByRole('button', { name: 'Clear app data' }));

    expect(await screen.findByText('disk busy')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
