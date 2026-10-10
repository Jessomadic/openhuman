'use client';

/**
 * The agent's step-by-step plan for the current thread, with a progress bar
 * and a checkmark/spinner per step.
 *
 * Vendored from the assistant-ui `elements-agent-plan` registry item
 * (https://r.assistant-ui.com/styles/base-nova/elements-agent-plan.json).
 * Changes from upstream:
 * - `cn` import path (`@/components/assistant-ui/lib/utils`).
 * - The header text `"Plan"` is a prop (`title`) with that English default,
 *   so the caller (`PlanReviewPart` in
 *   `features/conversations/aui/PlanReviewPart.tsx`) supplies the translated
 *   string via `useT()`.
 */
import { cn } from '@/components/assistant-ui/lib/utils';
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { pct, progressOf } from '../utils/range';
import { mono } from './surfaces';

export function AgentPlan({
  steps,
  activeIndex,
  title = 'Plan',
  className,
  statuses,
  compact = false,
  showHeader = true,
  countLabel,
  stepTestId,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'steps' | 'activeIndex' | 'title'> & {
  steps: readonly string[];
  activeIndex: number;
  title?: string;
  /** Exact harness states when progress is not strictly sequential. */
  statuses?: readonly ('pending' | 'active' | 'done' | 'failed')[];
  compact?: boolean;
  showHeader?: boolean;
  countLabel?: string;
  stepTestId?: string;
}) {
  const total = steps.length;
  const completed = statuses ? statuses.filter(status => status === 'done').length : progressOf(activeIndex, total);
  const allDone = completed >= total;
  const progress = pct(completed, total);

  return (
    <div
      data-slot="agent-plan"
      className={cn('flex w-full max-w-sm flex-col', compact ? 'gap-1.5' : 'gap-3', className)}
      {...props}>
      {showHeader && <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className={cn(mono, 'text-foreground/35 tabular-nums')}>
          {countLabel ?? `${completed} of ${total}`}
        </span>
      </div>}
      <div className="bg-foreground/[0.06] h-[3px] w-full overflow-hidden rounded-full">
        <span
          className="bg-foreground/80 block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className={cn('flex flex-col', compact ? 'gap-1' : 'gap-2.5')}>
        {steps.map((step, i) => {
          const status = statuses?.[i] ?? (allDone || i < completed ? 'done' : i === completed ? 'active' : 'pending');
          const done = status === 'done';
          const active = status === 'active';
          const failed = status === 'failed';
          return (
            <li key={`${i}:${step}`} data-testid={stepTestId} data-status={status} className={cn('flex items-start gap-2.5', compact ? 'text-xs leading-4' : 'text-[13.5px]')}>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {done ? (
                  <CheckIcon className="text-foreground/35 size-3.5" />
                ) : failed ? (
                  <XIcon aria-hidden className="text-destructive size-3.5" />
                ) : active ? (
                  <Loader2Icon className="text-foreground/90 size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <span aria-hidden className="bg-foreground/15 size-1.5 rounded-full" />
                )}
              </span>
              <span
                className={cn(
                  done && 'text-foreground/40',
                  active && 'text-foreground/90',
                  failed && 'text-destructive',
                  !done && !active && !failed && 'text-foreground/35'
                )}>
                {step}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
