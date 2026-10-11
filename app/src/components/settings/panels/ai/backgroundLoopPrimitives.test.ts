import { describe, expect, it } from 'vitest';

import { formatUsd } from './backgroundLoopPrimitives';

describe('formatUsd', () => {
  it('keeps four to six decimals for small real charges', () => {
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(1.7831)).toBe('$1.7831');
  });

  it('never renders a non-zero charge as zero', () => {
    expect(formatUsd(3.6e-7)).toBe('<$0.000001');
    expect(formatUsd(6e-8)).toBe('<$0.000001');
  });

  it('renders zero and non-finite input as zero', () => {
    expect(formatUsd(0)).toBe('$0.0000');
    expect(formatUsd(Number.NaN)).toBe('$0.0000');
  });
});
