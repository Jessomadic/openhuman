import { type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import Input from './Input';

export interface NumberFieldProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  /** Optional unit suffix shown beside the field (e.g. "seconds"). */
  unit?: string;
  /** Optional bounds — when both are set, a "{min}–{max}" range hint renders. */
  min?: number;
  max?: number;
  /** Step granularity; default 1. Pass a fraction for decimal fields. */
  step?: number;
  /** Shown while the field is empty (e.g. "∞" when empty means no limit). */
  placeholder?: string;
  /** Replaces the "{min}–{max}" hint, e.g. when `max` is a sentinel. */
  rangeLabel?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label': string;
  'data-testid'?: string;
}

/** A numeric input that commits on blur or Enter, with optional unit + range hint. */
const NumberField = ({
  id,
  value,
  onChange,
  onCommit,
  unit,
  min,
  max,
  step = 1,
  placeholder,
  rangeLabel,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: NumberFieldProps) => {
  const hasRange = rangeLabel != null || (min !== undefined && max !== undefined);

  return (
    <div
      data-slot="number-field"
      className={cn('flex items-center gap-2', disabled && 'opacity-50')}
      data-testid={testId}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        inputSize="sm"
        className="w-24"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          }
        }}
      />
      {(Boolean(unit) || hasRange) && (
        <div className="flex flex-col leading-tight">
          {unit && (
            <span className="text-xs font-medium text-content-secondary dark:text-content-muted">
              {unit}
            </span>
          )}
          {hasRange && (
            <span className="inline-flex items-center text-[11px] text-content-faint">
              {rangeLabel ?? (
                <>
                  {min}&#x2013;{max}
                </>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default NumberField;
