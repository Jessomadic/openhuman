import { type ReactNode } from 'react';

/**
 * The square identity tile every row in the MCP servers and Skills tables
 * leads with (an icon, a logo, or an initial). Shared so the three tables keep
 * one row grammar.
 */
const RowIcon = ({ children }: { children: ReactNode }) => (
  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted">
    {children}
  </span>
);

export default RowIcon;
