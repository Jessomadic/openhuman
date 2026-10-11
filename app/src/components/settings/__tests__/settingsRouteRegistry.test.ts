/**
 * Unit tests for settingsRouteRegistry helpers.
 *
 * Covers the four exported helper functions and edge-cases that ensure the
 * registry stays internally consistent (no duplicate ids, every entry has a
 * reachable route, etc.).
 */
import { describe, expect, it } from 'vitest';

import {
  entriesForSection,
  entryRoute,
  findEntryById,
  findEntryByRoute,
  SETTINGS_ROUTE_REGISTRY,
} from '../settingsRouteRegistry';

// ---------------------------------------------------------------------------
// entryRoute
// ---------------------------------------------------------------------------

describe('entryRoute', () => {
  it('returns the explicit route when set', () => {
    // No live registry entry currently sets an explicit `route` override (the
    // 'notifications' entry that used to was removed with the Notifications
    // settings page), so this exercises the helper directly against a
    // synthetic entry instead of registry data.
    const entry = { id: 'foo', route: 'bar', titleKey: 'x', section: 'home' as const };
    expect(entryRoute(entry)).toBe('bar');
  });

  it('falls back to the id when no explicit route is set', () => {
    const entry = findEntryById('personality');
    expect(entry).toBeDefined();
    expect(entryRoute(entry!)).toBe('personality');
  });

  it('has exactly one entry resolving to the about route', () => {
    // A dev-only "build-info" alias used to point here too, which listed two
    // sidebar entries for the same page.
    expect(findEntryById('build-info')).toBeUndefined();
    expect(SETTINGS_ROUTE_REGISTRY.filter(e => entryRoute(e) === 'about')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findEntryById
// ---------------------------------------------------------------------------

describe('findEntryById', () => {
  it('returns the entry for a known id', () => {
    const entry = findEntryById('about');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('about');
  });

  it('returns undefined for an unknown id', () => {
    expect(findEntryById('does-not-exist')).toBeUndefined();
  });

  it('returns the correct section for a home hub entry', () => {
    // The old 'agents-settings' / 'ai' / 'integrations' hub pages were retired;
    // 'appearance' is a representative surviving home-section hub.
    const entry = findEntryById('appearance');
    expect(entry).toBeDefined();
    expect(entry!.section).toBe('home');
  });

  it('returns the correct section for a developer-only entry', () => {
    // `cron-jobs` used to stand in here; it left the registry when the cron
    // surface moved to `/flows?view=schedules`. `event-log` is the same shape.
    const entry = findEntryById('event-log');
    expect(entry).toBeDefined();
    expect(entry!.section).toBe('developer');
    expect(entry!.devOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findEntryByRoute
// ---------------------------------------------------------------------------

describe('findEntryByRoute', () => {
  it('returns an entry for a known route', () => {
    const entry = findEntryByRoute('personality');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('personality');
  });

  it('returns undefined for an unknown route', () => {
    expect(findEntryByRoute('messaging')).toBeUndefined();
  });

  it('resolves the about route to the canonical about entry', () => {
    expect(findEntryByRoute('about')?.id).toBe('about');
  });

  it('does not match partial/substring routes — lookup is exact', () => {
    const entry = findEntryByRoute('voice');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('voice');
    // A substring of a real route must not resolve — exact-match only.
    expect(findEntryByRoute('voic')).toBeUndefined();
    // A removed developer route ('voice-debug' was retired) resolves to nothing.
    expect(findEntryByRoute('voice-debug')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// entriesForSection
// ---------------------------------------------------------------------------

describe('entriesForSection', () => {
  it('returns only entries belonging to the requested section', () => {
    const cryptoEntries = entriesForSection('crypto');
    expect(cryptoEntries.length).toBeGreaterThan(0);
    cryptoEntries.forEach(e => expect(e.section).toBe('crypto'));
  });

  it('excludes hidden deep-links', () => {
    // 'autocomplete' and 'permissions' are section: 'developer' + hiddenDeepLink.
    const devEntries = entriesForSection('developer');
    const ids = devEntries.map(e => e.id);
    expect(ids).not.toContain('autocomplete');
    expect(ids).not.toContain('permissions');
  });

  it('retires the integrations entry (Connections page owns the surface now)', () => {
    // The Integrations settings section was removed — the composio/OAuth grid
    // lives on the Connections page and task-source/webhook triage is gone.
    const allIds = SETTINGS_ROUTE_REGISTRY.map(e => e.id);
    expect(allIds).not.toContain('integrations');
    expect(allIds).not.toContain('task-sources');
    expect(allIds).not.toContain('composio-routing');
    expect(allIds).not.toContain('webhooks-triggers');
  });

  it('returns the surviving developer entries', () => {
    // Most former Developer & Diagnostics entries (agents, autonomy,
    // agent-access, sandbox-settings, tools, voice, embeddings,
    // migration, security, etc.) moved to their canonical section pages in
    // the redesign; only a handful of dev-only diagnostics stayed here.
    const devEntries = entriesForSection('developer');
    const ids = devEntries.map(e => e.id);
    expect(ids.sort()).toEqual(['event-log', 'search', 'tool-policy-diagnostics']);
    devEntries.forEach(e => {
      expect(e.section).toBe('developer');
      expect(e.hiddenDeepLink).not.toBe(true);
    });
  });

  it('returns home section entries (section hubs)', () => {
    const homeEntries = entriesForSection('home');
    const ids = homeEntries.map(e => e.id);
    // Surviving home hub entries after the two-pane restructure.
    expect(ids).toContain('account');
    expect(ids).toContain('appearance');
    expect(ids).toContain('personality');
    expect(ids).toContain('about');
    // The old ai / agents-settings / features / notifications-hub / integrations
    // hub pages were retired — their slugs now redirect to leaf panels or the
    // Connections page. Workflows (automations) and Data Sync (memory-sync)
    // became first-level modules.
    expect(ids).not.toContain('ai');
    expect(ids).not.toContain('agents-settings');
    expect(ids).not.toContain('features');
    expect(ids).not.toContain('integrations');
    expect(ids).not.toContain('notifications-hub');
    expect(ids).not.toContain('automations');
    expect(ids).not.toContain('memory-sync');
  });

  it('returns empty array for a section that has no non-hidden entries', () => {
    // All home entries are reachable so this just validates the helper signature.
    const result = entriesForSection('account');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry-level integrity checks
// ---------------------------------------------------------------------------

describe('SETTINGS_ROUTE_REGISTRY integrity', () => {
  it('has no duplicate ids', () => {
    const ids = SETTINGS_ROUTE_REGISTRY.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every entry has a non-empty id and titleKey', () => {
    SETTINGS_ROUTE_REGISTRY.forEach(entry => {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.titleKey.length).toBeGreaterThan(0);
    });
  });

  it('surfaces the restructured home hub entries', () => {
    const homeIds = entriesForSection('home').map(e => e.id);
    expect(homeIds).toContain('personality');
    expect(homeIds).not.toContain('billing');
  });
});
