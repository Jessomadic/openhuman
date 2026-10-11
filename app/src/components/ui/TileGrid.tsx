import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';

type TileGridColumns = 2 | 3 | 4;

const COLUMNS: Record<TileGridColumns, string> = {
  2: 'md:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
};

export interface TileGridProps {
  children: ReactNode;
  /** Widest column count; narrower viewports step down to one column. */
  columns?: TileGridColumns;
  /** Pad the grid with `p-4` — for a grid sitting inside a `Card` body. */
  padded?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Responsive grid for pages whose children are narrow: tiles, small cards,
 * toggles. Stacking those full-width wastes the horizontal space a settings
 * page has, so they flow into two to four columns instead.
 */
export const TileGrid = ({
  children,
  columns = 3,
  padded = false,
  className,
  'data-testid': testId,
}: TileGridProps) => (
  <div
    data-slot="tile-grid"
    data-testid={testId}
    className={cn('grid items-stretch gap-3', COLUMNS[columns], padded && 'p-4', className)}>
    {children}
  </div>
);

export interface TileProps {
  title: ReactNode;
  description?: ReactNode;
  /** Leading square icon (a lucide icon element or an image). */
  icon?: ReactNode;
  /** Fill the icon square with the primary colour. */
  iconActive?: boolean;
  /** Trailing control (switch, radio, button). */
  control?: ReactNode;
  /** Extra content below the description (chips, notes). */
  children?: ReactNode;
  /** Highlight the tile as the current choice. */
  selected?: boolean;
  /** Dim the tile (unavailable / coming soon). */
  muted?: boolean;
  /** Associates the title with a form control for click-to-toggle. */
  htmlFor?: string;
  className?: string;
  'data-testid'?: string;
}

/** A bordered option tile: icon, title, description and a trailing control. */
export const Tile = ({
  title,
  description,
  icon,
  iconActive = false,
  control,
  children,
  selected = false,
  muted = false,
  htmlFor,
  className,
  'data-testid': testId,
}: TileProps) => {
  const Title = htmlFor ? 'label' : 'span';
  return (
    <div
      data-slot="tile"
      data-testid={testId}
      data-selected={selected || undefined}
      className={cn(
        'flex h-full items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
        selected
          ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10'
          : 'border-line bg-surface',
        muted && 'opacity-60',
        className
      )}>
      {icon && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4.5 [&_svg]:w-4.5',
            iconActive
              ? 'bg-primary-500 text-content-inverted'
              : 'bg-surface-muted text-content-secondary'
          )}
          aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Title
          htmlFor={htmlFor}
          className={cn('block text-sm font-semibold text-content', htmlFor && 'cursor-pointer')}>
          {title}
        </Title>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center self-center">{control}</div>}
    </div>
  );
};
