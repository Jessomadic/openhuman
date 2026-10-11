/**
 * Appearance → Layout: user control over corner rounding, border contrast and
 * which areas of the app draw borders. Independent of the colour theme, so a
 * preference survives switching themes.
 *
 * Applied by `ThemeProvider`:
 * - corners scale Tailwind's `--radius-*` tokens on `<html>` (pills and avatars
 *   use `rounded-full`, which is not a token, so they stay round);
 * - border contrast re-derives the `--line*` tokens from the active theme;
 * - border areas set `data-borders-<area>="off"` on `<html>`, which the rules in
 *   `styles/layout-overrides.css` key off.
 */
import { isChannelTriple } from './color';

export type CornerStyle = 'none' | 'subtle' | 'default' | 'round';
export type BorderContrast = 'subtle' | 'default' | 'strong';
export const BORDER_AREAS = ['cards', 'controls', 'dividers', 'frame'] as const;
export type BorderArea = (typeof BORDER_AREAS)[number];

export interface ThemeLayout {
  corners: CornerStyle;
  borderContrast: BorderContrast;
  borderAreas: Record<BorderArea, boolean>;
}

export const DEFAULT_LAYOUT: ThemeLayout = {
  corners: 'default',
  borderContrast: 'default',
  borderAreas: { cards: true, controls: true, dividers: true, frame: true },
};

/** Tailwind's radius scale as declared in `index.css` (`@theme`), in rem. */
const RADIUS_SCALE_REM: Record<string, number> = {
  xs: 0.25,
  sm: 0.375,
  md: 0.5,
  lg: 0.625,
  xl: 0.75,
  '2xl': 1,
  '3xl': 1.25,
  '4xl': 1.5,
  '5xl': 2,
};

const CORNER_FACTOR: Record<CornerStyle, number> = { none: 0, subtle: 0.5, default: 1, round: 1.6 };

/** The border tokens contrast adjusts. `line-chrome` is left to the theme. */
const CONTRAST_KEYS = ['line', 'line-strong', 'line-subtle'] as const;

/**
 * Normalise a possibly partial or stale persisted value (older state has no
 * `layout`; a future area may be missing from `borderAreas`).
 */
export function resolveLayout(value: Partial<ThemeLayout> | null | undefined): ThemeLayout {
  const corners =
    value?.corners && value.corners in CORNER_FACTOR ? value.corners : DEFAULT_LAYOUT.corners;
  const borderContrast =
    value?.borderContrast && ['subtle', 'default', 'strong'].includes(value.borderContrast)
      ? value.borderContrast
      : DEFAULT_LAYOUT.borderContrast;
  const borderAreas = { ...DEFAULT_LAYOUT.borderAreas };
  for (const area of BORDER_AREAS) {
    const v = value?.borderAreas?.[area];
    if (typeof v === 'boolean') borderAreas[area] = v;
  }
  return { corners, borderContrast, borderAreas };
}

function parse(channels: string): [number, number, number] {
  const [r, g, b] = channels.trim().split(/\s+/).map(Number);
  return [r, g, b];
}

/** Linear mix of two `"R G B"` triples; `t` = 0 → `a`, 1 → `b`. */
export function mixChannels(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(' ');
}

/** Apply corner rounding and border-area switches to `root`. */
export function applyLayoutAttributes(root: HTMLElement, layout: ThemeLayout): void {
  const factor = CORNER_FACTOR[layout.corners];
  for (const [size, rem] of Object.entries(RADIUS_SCALE_REM)) {
    if (factor === 1) root.style.removeProperty(`--radius-${size}`);
    else root.style.setProperty(`--radius-${size}`, `${rem * factor}rem`);
  }
  for (const area of BORDER_AREAS) {
    if (layout.borderAreas[area]) root.removeAttribute(`data-borders-${area}`);
    else root.setAttribute(`data-borders-${area}`, 'off');
  }
}

/**
 * Re-derive the border tokens for a contrast level. Must run after the theme's
 * own colours are applied: it reads each token's current value (the theme's
 * override, else the stylesheet default) and mixes it toward the text colour
 * (stronger) or the surface colour (subtler).
 *
 * `themeColors` is the active theme's override map, so a token the theme does
 * not set can be cleared back to the stylesheet before it is re-read.
 */
export function applyBorderContrast(
  root: HTMLElement,
  contrast: BorderContrast,
  themeColors: Record<string, string>
): void {
  // Reset to the theme's own values first, so levels never compound.
  for (const key of CONTRAST_KEYS) {
    if (themeColors[key]) root.style.setProperty(`--${key}`, themeColors[key]);
    else root.style.removeProperty(`--${key}`);
  }
  if (contrast === 'default') return;

  const computed = window.getComputedStyle(root);
  const read = (key: string) => computed.getPropertyValue(`--${key}`).trim();
  const target = read(contrast === 'strong' ? 'content' : 'surface');
  if (!isChannelTriple(target)) return;
  const amount = contrast === 'strong' ? 0.3 : 0.55;

  for (const key of CONTRAST_KEYS) {
    const base = read(key);
    if (isChannelTriple(base))
      root.style.setProperty(`--${key}`, mixChannels(base, target, amount));
  }
}
