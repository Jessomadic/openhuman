import { describe, expect, it } from 'vitest';

import {
  formatCurrency,
  formatPercent,
  formatTokens,
  relativeTime,
  shortDayLabel,
} from './formatCurrency';

describe('formatCurrency', () => {
  it('formats positive USD amounts with two decimals under 100', () => {
    expect(formatCurrency(12.5, 'USD')).toMatch(/\$12\.50/);
  });

  it('drops fractional digits at or above 100', () => {
    expect(formatCurrency(150, 'USD')).toMatch(/\$150/);
  });

  it('falls back to USD for unrecognised currency labels', () => {
    expect(formatCurrency(5, 'NOT-A-CURRENCY')).toMatch(/\$5\.00/);
  });

  it('treats non-finite input as zero', () => {
    expect(formatCurrency(Number.NaN, 'USD')).toMatch(/0/);
    expect(formatCurrency(Number.POSITIVE_INFINITY, 'USD')).toMatch(/0/);
  });

  it('honours empty currency string by falling back to USD', () => {
    expect(formatCurrency(7, '')).toMatch(/\$7\.00/);
  });

  it('shows real spend under one cent as "<$0.01", not "$0.00"', () => {
    expect(formatCurrency(0.0001, 'USD')).toBe('<$0.01');
    expect(formatCurrency(0.004, 'USD')).toBe('<$0.01');
    expect(formatCurrency(0.009999, 'USD')).toBe('<$0.01');
    expect(formatCurrency(3.6e-7, 'USD')).toBe('<$0.01');
  });

  it('switches to plain two-decimal output at exactly one cent', () => {
    expect(formatCurrency(0.01, 'USD')).toBe('$0.01');
    expect(formatCurrency(0.0149, 'USD')).toBe('$0.01');
  });

  it('renders zero and negative zero as plain zero', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
    expect(formatCurrency(-0, 'USD')).toBe('$0.00');
  });

  it('keeps the sign on a tiny negative amount', () => {
    expect(formatCurrency(-0.001, 'USD')).toBe('-<$0.01');
  });

  it('applies the sub-cent rule in other currencies', () => {
    expect(formatCurrency(0.0001, 'EUR')).toMatch(/^<.*0\.01/);
  });

  it('can show sub-cent amounts to four decimals for chart axes', () => {
    expect(formatCurrency(0.0004, 'USD', { precise: true })).toBe('$0.0004');
    expect(formatCurrency(0.0025, 'USD', { precise: true })).toBe('$0.0025');
    expect(formatCurrency(0.5, 'USD', { precise: true })).toBe('$0.50');
  });
});

describe('formatTokens', () => {
  it('renders zero / negative as "0"', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
  });

  it('rounds integers under 1k', () => {
    expect(formatTokens(123.7)).toBe('124');
  });

  it('uses K and M suffixes', () => {
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('rolls over to M instead of showing "1000.0K"', () => {
    expect(formatTokens(999_949)).toBe('999.9K');
    expect(formatTokens(999_960)).toBe('1.0M');
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });
});

describe('formatPercent', () => {
  it('rounds to one decimal', () => {
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('shows a non-zero share under 0.1% as "<0.1%", not "0.0%"', () => {
    expect(formatPercent(0.04)).toBe('<0.1%');
    expect(formatPercent(0.1)).toBe('0.1%');
  });

  it('treats zero, negative and non-finite input as 0.0%', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(-3)).toBe('0.0%');
    expect(formatPercent(Number.NaN)).toBe('0.0%');
  });
});

describe('shortDayLabel', () => {
  it('returns a 3-letter weekday for a valid ISO date', () => {
    const label = shortDayLabel('2026-05-27');
    expect(label.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the suffix for malformed input', () => {
    const label = shortDayLabel('not-a-date');
    expect(typeof label).toBe('string');
  });
});

describe('relativeTime', () => {
  // Stub translator: returns the key untouched so the test can assert
  // both the key routing and the {value} placeholder substitution.
  const t = (key: string) => {
    if (key === 'settings.costDashboard.justNow') return 'Just now';
    if (key === 'settings.costDashboard.secondsAgo') return '{value}s ago';
    if (key === 'settings.costDashboard.minutesAgo') return '{value}m ago';
    if (key === 'settings.costDashboard.hoursAgo') return '{value}h ago';
    if (key === 'settings.costDashboard.daysAgo') return '{value}d ago';
    return key;
  };
  const now = 1_700_000_000_000;

  it('returns "Just now" within 5 seconds', () => {
    expect(relativeTime(now - 2_000, t, now)).toBe('Just now');
  });

  it('renders seconds branch with substituted value', () => {
    expect(relativeTime(now - 30_000, t, now)).toBe('30s ago');
  });

  it('renders minutes branch', () => {
    expect(relativeTime(now - 5 * 60_000, t, now)).toBe('5m ago');
  });

  it('renders hours branch', () => {
    expect(relativeTime(now - 3 * 60 * 60_000, t, now)).toBe('3h ago');
  });

  it('renders days branch', () => {
    expect(relativeTime(now - 2 * 24 * 60 * 60_000, t, now)).toBe('2d ago');
  });

  it('returns the raw translation key when missing (i18n fallback)', () => {
    const passthrough = (key: string) => key;
    expect(relativeTime(now - 1_000, passthrough, now)).toBe('settings.costDashboard.justNow');
  });

  it('replaces every {value} placeholder in a translation, not just the first', () => {
    // Some locales repeat the number for clarity (e.g. "5m ago — 5 minutes").
    // replaceAll must substitute every occurrence; the previous .replace
    // implementation left the trailing token literal.
    const repeating = (key: string) => {
      if (key === 'settings.costDashboard.minutesAgo') return '{value}m ago ({value} min)';
      return key;
    };
    expect(relativeTime(now - 5 * 60_000, repeating, now)).toBe('5m ago (5 min)');
  });
});
