import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * One chip style app-wide: shadcn's outline status badge — a faint border and
 * a faint fill, content-coloured text, and (for the semantic variants) a small
 * coloured dot carrying the meaning. The dot, not a tinted fill, is what sets
 * success / warning / danger apart, so a row of chips stays calm.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line/60 bg-content/5 px-2 py-0.5 text-xs font-medium leading-5 text-content',
  {
    variants: { variant: { neutral: '', primary: '', success: '', warning: '', danger: '' } },
    defaultVariants: { variant: 'neutral' },
  }
);

const DOT_CLASS: Record<string, string | null> = {
  neutral: null,
  primary: 'bg-primary-500',
  success: 'bg-sage-500',
  warning: 'bg-amber-500',
  danger: 'bg-coral-500',
};

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>, VariantProps<typeof badgeVariants> {
  children: ReactNode;
  /** Status dot; on by default for every variant except `neutral`. */
  dot?: boolean;
  className?: string;
  'data-testid'?: string;
  /** Arbitrary `data-*` passthrough (e.g. `data-status`) for callers that key tests/CSS off it. */
  [key: `data-${string}`]: unknown;
}

/**
 * Pill label. Any extra span attribute (`title`, `aria-*`, `onClick`, …) is
 * forwarded to the rendered element, so a hand-rolled pill carrying a tooltip
 * or an event handler can adopt this primitive without losing it. The
 * component-owned attributes are applied after `...rest` so the default render
 * is identical whether or not extra props are passed.
 */
const Badge = ({
  variant,
  dot,
  children,
  className,
  'data-testid': testId,
  ...rest
}: BadgeProps) => {
  const resolved = variant ?? 'neutral';
  const dotClass = DOT_CLASS[resolved];
  const showDot = dot ?? dotClass != null;
  return (
    <span
      {...rest}
      data-slot="badge"
      data-variant={resolved}
      data-testid={testId}
      className={cn(badgeVariants({ variant }), className)}>
      {showDot && (
        <span
          data-slot="badge-dot"
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass ?? 'bg-content-faint')}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
};

export default Badge;
