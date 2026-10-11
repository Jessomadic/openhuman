import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import PersonaPanel from './PersonaPanel';

const {
  mockNavigateBack,
  mockNavigateToSettings,
  readPersonaFileMock,
  writePersonaFileMock,
  resetPersonaFileMock,
} = vi.hoisted(() => ({
  mockNavigateBack: vi.fn(),
  mockNavigateToSettings: vi.fn(),
  readPersonaFileMock: vi.fn(),
  writePersonaFileMock: vi.fn(),
  resetPersonaFileMock: vi.fn(),
}));

vi.mock('../../../services/api/personaFilesApi', () => ({
  PERSONA_FILE_SOUL: 'SOUL.md',
  readPersonaFile: (...args: unknown[]) => readPersonaFileMock(...args),
  writePersonaFile: (...args: unknown[]) => writePersonaFileMock(...args),
  resetPersonaFile: (...args: unknown[]) => resetPersonaFileMock(...args),
}));

vi.mock('../hooks/useSettingsNavigation', () => ({
  useSettingsNavigation: () => ({
    navigateBack: mockNavigateBack,
    navigateToSettings: mockNavigateToSettings,
    breadcrumbs: [{ label: 'Settings' }],
  }),
}));

const soulFile = (overrides: Record<string, unknown> = {}) => ({
  filename: 'SOUL.md',
  contents: 'You are helpful.',
  is_default: true,
  ...overrides,
});

/** Wait for the SOUL section to finish loading (the mode toggle is always shown). */
const awaitLoaded = () =>
  waitFor(() => expect(screen.getByTestId('persona-soul-mode-guided')).toBeInTheDocument());

/** Switch to the Advanced (raw markdown) editor. */
const openAdvanced = () => fireEvent.click(screen.getByTestId('persona-soul-mode-advanced'));

describe('PersonaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readPersonaFileMock.mockResolvedValue(soulFile());
    writePersonaFileMock.mockImplementation((_name: string, contents: string) =>
      Promise.resolve(soulFile({ contents, is_default: false }))
    );
    resetPersonaFileMock.mockResolvedValue(
      soulFile({ contents: 'default soul', is_default: true })
    );
  });

  it('defaults to the guided builder and hides raw markdown', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    expect(screen.getByTestId('persona-guided-personality')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-soul-editor')).not.toBeInTheDocument();
    expect(readPersonaFileMock).toHaveBeenCalledWith('SOUL.md');
  });

  it('reveals the raw SOUL.md editor in Advanced mode', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    openAdvanced();
    expect(screen.getByTestId('persona-soul-editor')).toHaveValue('You are helpful.');
  });

  it('splices a guided field edit into SOUL.md and saves it over RPC', async () => {
    readPersonaFileMock.mockResolvedValue(
      soulFile({ contents: '## Personality\n\nOld.\n', is_default: false })
    );
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();

    await waitFor(() =>
      expect(screen.getByTestId('persona-guided-personality')).toHaveValue('Old.')
    );
    fireEvent.change(screen.getByTestId('persona-guided-personality'), {
      target: { value: 'Warm and direct.' },
    });
    fireEvent.click(screen.getByTestId('persona-save'));

    await waitFor(() => {
      expect(writePersonaFileMock).toHaveBeenCalledWith(
        'SOUL.md',
        '## Personality\n\nWarm and direct.\n'
      );
    });
  });

  it('applies a role template and saves the seeded persona over RPC', async () => {
    readPersonaFileMock.mockResolvedValue(
      soulFile({ contents: '## Personality\n\nOld.\n', is_default: false })
    );
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();

    fireEvent.click(screen.getByTestId('persona-template-doctor'));
    fireEvent.click(screen.getByTestId('persona-save'));

    await waitFor(() => {
      const lastCall = writePersonaFileMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('SOUL.md');
      expect(lastCall?.[1]).toContain('Careful and precise');
      expect(lastCall?.[1]).toContain('## Voice');
    });
  });

  it('persists the display name to the store on save', async () => {
    const { store } = renderWithProviders(<PersonaPanel />);
    await awaitLoaded();

    fireEvent.change(screen.getByTestId('persona-display-name-input'), {
      target: { value: 'Nova' },
    });
    fireEvent.change(screen.getByTestId('persona-description-input'), {
      target: { value: 'Calm and concise.' },
    });
    fireEvent.click(screen.getByTestId('persona-save'));

    expect(store.getState().persona.displayName).toBe('Nova');
    expect(store.getState().persona.description).toBe('Calm and concise.');
  });

  it('hides the save bar until a field changes, one bar for the whole page', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    // Identity and SOUL.md now share a single save bar/button, shown only
    // once something is dirty — no separate per-section save controls.
    expect(screen.queryByTestId('persona-save-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('persona-save')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('persona-display-name-input'), {
      target: { value: 'Nova' },
    });

    expect(screen.getByTestId('persona-save-bar')).toBeInTheDocument();
    expect(screen.getByTestId('persona-save')).not.toBeDisabled();
  });

  it('writes edited SOUL.md contents over RPC from the raw editor', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    openAdvanced();

    fireEvent.change(screen.getByTestId('persona-soul-editor'), {
      target: { value: 'You are calm and concise.' },
    });
    fireEvent.click(screen.getByTestId('persona-save'));

    await waitFor(() => {
      expect(writePersonaFileMock).toHaveBeenCalledWith('SOUL.md', 'You are calm and concise.');
    });
  });

  it('surfaces a save error when the write RPC fails', async () => {
    writePersonaFileMock.mockRejectedValue(new Error('disk full'));
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    openAdvanced();

    fireEvent.change(screen.getByTestId('persona-soul-editor'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByTestId('persona-save'));

    await waitFor(() => {
      expect(screen.getByTestId('persona-soul-error')).toHaveTextContent('disk full');
    });
  });

  it('surfaces a reset error when the reset RPC fails', async () => {
    readPersonaFileMock.mockResolvedValue(soulFile({ contents: 'custom', is_default: false }));
    resetPersonaFileMock.mockRejectedValue(new Error('reset boom'));
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();

    fireEvent.click(screen.getByTestId('persona-soul-reset'));

    await waitFor(() => {
      expect(screen.getByTestId('persona-soul-error')).toHaveTextContent('reset boom');
    });
  });

  it('resets SOUL.md to the bundled default', async () => {
    // Start from a non-default file so the Reset button is enabled.
    readPersonaFileMock.mockResolvedValue(soulFile({ contents: 'custom', is_default: false }));
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    openAdvanced();
    await waitFor(() => expect(screen.getByTestId('persona-soul-editor')).toHaveValue('custom'));

    fireEvent.click(screen.getByTestId('persona-soul-reset'));

    await waitFor(() => {
      expect(resetPersonaFileMock).toHaveBeenCalledWith('SOUL.md');
      expect(screen.getByTestId('persona-soul-editor')).toHaveValue('default soul');
    });
  });

  it('disables Reset while the file is already the bundled default', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    expect(screen.getByTestId('persona-soul-reset')).toBeDisabled();
    expect(screen.getByTestId('persona-soul-default-badge')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    readPersonaFileMock.mockRejectedValue(new Error('boom'));
    renderWithProviders(<PersonaPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('persona-soul-error')).toHaveTextContent('boom');
    });
  });

  // Personality and Face are now separate settings pages (not tabs of one
  // panel); the `#face` deep link redirect lives in the route table
  // (`PersonalityRoute` in settingsRouteElements.tsx), not in PersonaPanel.

  it('links guided users to Agent access for permissions', async () => {
    renderWithProviders(<PersonaPanel />);
    await awaitLoaded();
    fireEvent.click(screen.getByTestId('persona-guided-agent-access'));
    expect(mockNavigateToSettings).toHaveBeenCalledWith('agent-access');
  });
});
