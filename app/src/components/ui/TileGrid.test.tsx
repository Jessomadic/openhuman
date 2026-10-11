import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tile, TileGrid } from './TileGrid';

describe('TileGrid', () => {
  it('renders children with the default 3-column recipe, unpadded', () => {
    render(
      <TileGrid data-testid="grid">
        <div>child</div>
      </TileGrid>
    );
    const grid = screen.getByTestId('grid');
    expect(grid).toHaveAttribute('data-slot', 'tile-grid');
    expect(grid).toHaveClass('grid', 'sm:grid-cols-2', 'xl:grid-cols-3');
    expect(grid).not.toHaveClass('p-4');
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('switches column classes for columns=2 and columns=4', () => {
    const { rerender } = render(
      <TileGrid data-testid="grid" columns={2}>
        <div />
      </TileGrid>
    );
    expect(screen.getByTestId('grid')).toHaveClass('md:grid-cols-2');
    expect(screen.getByTestId('grid')).not.toHaveClass('xl:grid-cols-3');

    rerender(
      <TileGrid data-testid="grid" columns={4}>
        <div />
      </TileGrid>
    );
    expect(screen.getByTestId('grid')).toHaveClass(
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      '2xl:grid-cols-4'
    );
  });

  it('adds p-4 padding when padded is true', () => {
    render(
      <TileGrid data-testid="grid" padded>
        <div />
      </TileGrid>
    );
    expect(screen.getByTestId('grid')).toHaveClass('p-4');
  });

  it('merges an extra className', () => {
    render(
      <TileGrid data-testid="grid" className="custom-grid-class">
        <div />
      </TileGrid>
    );
    expect(screen.getByTestId('grid')).toHaveClass('custom-grid-class');
  });
});

describe('Tile', () => {
  it('renders title, description, icon, and control', () => {
    render(
      <Tile
        data-testid="tile"
        title="Voice mode"
        description="Talk instead of type"
        icon={<span data-testid="tile-icon">*</span>}
        control={<button data-testid="tile-control">toggle</button>}
      />
    );
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveAttribute('data-slot', 'tile');
    expect(screen.getByText('Voice mode').tagName).toBe('SPAN');
    expect(screen.getByText('Talk instead of type')).toBeInTheDocument();
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument();
    expect(screen.getByTestId('tile-control')).toBeInTheDocument();
  });

  it('renders the title as a <label> wired to htmlFor when provided', () => {
    render(<Tile data-testid="tile" title="Enable X" htmlFor="enable-x" />);
    const title = screen.getByText('Enable X');
    expect(title.tagName).toBe('LABEL');
    expect(title).toHaveAttribute('for', 'enable-x');
  });

  it('marks selected via data-selected and applies the selected styling', () => {
    render(<Tile data-testid="tile" title="Chosen" selected />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveAttribute('data-selected', 'true');
    expect(tile).toHaveClass('border-primary-500');
  });

  it('omits data-selected when not selected', () => {
    render(<Tile data-testid="tile" title="Not chosen" />);
    expect(screen.getByTestId('tile')).not.toHaveAttribute('data-selected');
  });

  it('dims the tile via opacity-60 when muted', () => {
    render(<Tile data-testid="tile" title="Coming soon" muted />);
    expect(screen.getByTestId('tile')).toHaveClass('opacity-60');
  });

  it('renders extra children content below the description', () => {
    render(
      <Tile data-testid="tile" title="With extra" description="desc">
        <span data-testid="extra">extra content</span>
      </Tile>
    );
    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });

  it('supports click-to-toggle by clicking the label when htmlFor targets a control', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Tile
        data-testid="tile"
        title="Notifications"
        htmlFor="notif-toggle"
        control={
          <input id="notif-toggle" type="checkbox" aria-label="Notifications" onChange={onChange} />
        }
      />
    );
    await user.click(screen.getByText('Notifications'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
