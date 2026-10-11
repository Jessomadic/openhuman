/**
 * NodePalette — the editable canvas's insert palette. Asserts every bundled
 * entry renders (grouped under its section), clicking one calls `onAdd` with
 * that entry, and dragging one sets the `application/tinyflows-node`
 * dataTransfer payload the canvas's `onDrop` resolves. `useT()` falls back to
 * the bundled English map with no provider mounted (same as the sibling
 * flows tests).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PALETTE_ENTRIES_BY_GROUP } from '../../../lib/flows/nodeKindMeta';
import NodePalette, { PALETTE_DND_MIME } from './NodePalette';

const ALL_ENTRIES = Object.values(PALETTE_ENTRIES_BY_GROUP).flat();

describe('NodePalette', () => {
  it('renders every bundled palette entry', () => {
    render(<NodePalette onAdd={vi.fn()} />);
    expect(screen.getByTestId('flow-node-palette')).toBeInTheDocument();
    for (const entry of ALL_ENTRIES) {
      expect(screen.getByTestId(`flow-palette-item-${entry.key}`)).toBeInTheDocument();
    }
  });

  it('calls onAdd with the clicked entry', () => {
    const onAdd = vi.fn();
    render(<NodePalette onAdd={onAdd} />);
    const first = ALL_ENTRIES[0];
    fireEvent.click(screen.getByTestId(`flow-palette-item-${first.key}`));
    expect(onAdd).toHaveBeenCalledWith(first);
  });

  it('sets the tinyflows-node dataTransfer payload on drag start', () => {
    render(<NodePalette onAdd={vi.fn()} />);
    const first = ALL_ENTRIES[0];
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId(`flow-palette-item-${first.key}`), {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(PALETTE_DND_MIME, first.key);
  });

  describe('panel variant', () => {
    it('shows the panel hint and every entry still works, still with the overlay layout absent', () => {
      const onAdd = vi.fn();
      render(<NodePalette onAdd={onAdd} variant="panel" />);

      const palette = screen.getByTestId('flow-node-palette');
      expect(palette).toBeInTheDocument();
      // The panel-only hint copy only renders for `variant="panel"`.
      expect(
        screen.getByText('Click a step to add it to the canvas, or drag it where you want it.')
      ).toBeInTheDocument();
      // The overlay's floating position/sizing classes are absent in panel mode.
      expect(palette.className).not.toContain('absolute');
      expect(palette.className).toContain('flex h-full min-h-0 flex-col');

      const first = ALL_ENTRIES[0];
      fireEvent.click(screen.getByTestId(`flow-palette-item-${first.key}`));
      expect(onAdd).toHaveBeenCalledWith(first);
    });

    it('omits the panel hint in the default overlay variant', () => {
      render(<NodePalette onAdd={vi.fn()} />);
      expect(
        screen.queryByText('Click a step to add it to the canvas, or drag it where you want it.')
      ).not.toBeInTheDocument();
    });
  });
});
