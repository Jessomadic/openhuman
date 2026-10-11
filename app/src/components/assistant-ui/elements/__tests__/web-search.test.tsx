/**
 * The web-search element while a search is in flight.
 *
 * Hits arrive all at once with the settled result, so nothing may reserve
 * space for them while searching: the vendored upstream `min-h-[5.75rem]`
 * floor left a ~92px hole under every running search, and parallel searches
 * stacked those holes down the activity group. An in-flight call whose
 * arguments have not streamed yet must not draw an empty query capsule either.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WebSearch } from '../web-search';

const base = { cycle: 0, statusLabel: 'Found 1 result' } as const;

describe('WebSearch', () => {
  it('reserves no empty results space while searching', () => {
    const { container } = render(
      <WebSearch {...base} query="instinct ai" results={[]} visibleResults={0} searching />
    );

    expect(container.querySelector('[data-slot="web-search-results"]')).toBeNull();
    expect(container.innerHTML).not.toContain('min-h-');
    expect(container.querySelector('[data-slot="web-search-status"]')?.textContent).toBe(
      'Searching'
    );
  });

  it('omits the query pill until there is a query', () => {
    const { container } = render(
      <WebSearch {...base} query="  " results={[]} visibleResults={0} searching />
    );

    expect(container.querySelector('[data-slot="web-search-query"]')).toBeNull();
  });

  it('lists the hits once settled', () => {
    const { container } = render(
      <WebSearch
        {...base}
        query="instinct ai"
        results={[{ title: 'Instinct', domain: 'skift.com', url: 'https://skift.com/a' }]}
        visibleResults={1}
        searching={false}
      />
    );

    expect(container.querySelectorAll('[data-slot="web-search-result"]')).toHaveLength(1);
    expect(container.querySelector('[data-slot="web-search-query"]')?.textContent).toBe(
      'instinct ai'
    );
  });
});
