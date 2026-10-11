/**
 * SuggestionCard — one Flow Scout discovery card. `useT()` falls back to the
 * bundled English map with no `I18nProvider` mounted (same pattern as the
 * sibling flows tests), so assertions target the real English copy.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { FlowSuggestion } from '../../services/api/flowsApi';
import SuggestionCard, { suggestionTrigger, triggerLabelKey } from './SuggestionCard';

function suggestion(overrides: Partial<FlowSuggestion> = {}): FlowSuggestion {
  return {
    id: 'sug_1',
    title: 'Auto-file receipts',
    one_liner: 'Add each Gmail receipt to your sheet.',
    rationale: 'You forward receipts weekly.',
    trigger_hint: 'app_event',
    steps_outline: ['Watch Gmail', 'Extract amount', 'Append row', 'Notify me'],
    suggested_connections: ['composio:gmail:c1'],
    suggested_slugs: [],
    build_prompt: 'Build a workflow that files receipts.',
    confidence: 0.8,
    status: 'new',
    created_at: '2026-07-05T00:00:00Z',
    source_run_id: null,
    ...overrides,
  };
}

describe('suggestionTrigger / triggerLabelKey', () => {
  it('normalizes a recognized hint and returns its label key', () => {
    expect(suggestionTrigger('schedule')).toBe('schedule');
    expect(triggerLabelKey('schedule')).toBe('flows.suggest.trigger.schedule');
  });

  it('falls back to "other" (no label key) for an unrecognized/missing hint', () => {
    expect(suggestionTrigger('made-up')).toBe('other');
    expect(suggestionTrigger(null)).toBe('other');
    expect(suggestionTrigger(undefined)).toBe('other');
    expect(triggerLabelKey('other')).toBeNull();
  });
});

describe('SuggestionCard', () => {
  it('renders the trigger badge, title, and pitch', () => {
    render(
      <SuggestionCard
        suggestion={suggestion()}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByTestId('flow-suggestion-card')).toBeInTheDocument();
    expect(screen.getByText('Auto-file receipts')).toBeInTheDocument();
    expect(screen.getByText('Add each Gmail receipt to your sheet.')).toBeInTheDocument();
    // trigger_hint: 'app_event' → "On event" chip.
    expect(screen.getByText('On event')).toBeInTheDocument();
  });

  it('omits the trigger chip for an "other"/unrecognized trigger hint', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({ trigger_hint: 'mystery' })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.queryByText('On event')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('On demand')).not.toBeInTheDocument();
  });

  it.each([
    [0.9, 'Strong match'],
    [0.6, 'Good match'],
    [0.2, 'Worth a look'],
  ])('buckets confidence %s into "%s"', (confidence, label) => {
    render(
      <SuggestionCard
        suggestion={suggestion({ confidence })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('treats a missing confidence as 0 ("Worth a look")', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({ confidence: undefined as unknown as number })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
  });

  it('lists up to 4 steps and shows a "+N more steps" note beyond that', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({ steps_outline: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Four')).toBeInTheDocument();
    expect(screen.queryByText('Five')).not.toBeInTheDocument();
    expect(screen.getByText('+2 more steps')).toBeInTheDocument();
  });

  it('shows no steps section and no "more steps" note when steps_outline is empty', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({ steps_outline: [] })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.queryByText('How it works')).not.toBeInTheDocument();
    expect(screen.queryByText(/more steps/)).not.toBeInTheDocument();
  });

  it('renders one app chip per unique connected app', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({
          suggested_connections: ['composio:gmail:c1', 'composio:gmail:c2', 'composio:slack:c3'],
        })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    // Two gmail connections collapse into one "Gmail" chip.
    expect(screen.getAllByText('Gmail')).toHaveLength(1);
    expect(screen.getByText('Slack')).toBeInTheDocument();
  });

  it('the "why this?" rationale is collapsed by default and opens on toggle', async () => {
    const user = userEvent.setup();
    render(
      <SuggestionCard
        suggestion={suggestion()}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByText('You forward receipts weekly.')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Why this?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('You forward receipts weekly.')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('You forward receipts weekly.')).not.toBeInTheDocument();
  });

  it('omits the "why this?" toggle entirely when there is no rationale', () => {
    render(
      <SuggestionCard
        suggestion={suggestion({ rationale: '' })}
        opening={false}
        buildInProgress={false}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Why this?' })).not.toBeInTheDocument();
  });

  it('fires onBuild and onDismiss from their respective buttons', async () => {
    const user = userEvent.setup();
    const onBuild = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SuggestionCard
        suggestion={suggestion()}
        opening={false}
        buildInProgress={false}
        onBuild={onBuild}
        onDismiss={onDismiss}
      />
    );

    await user.click(screen.getByTestId('flow-suggestion-build'));
    expect(onBuild).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('flow-suggestion-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows an "Opening…" label on the build button while this card is opening', () => {
    render(
      <SuggestionCard
        suggestion={suggestion()}
        opening={true}
        buildInProgress={true}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const button = screen.getByTestId('flow-suggestion-build');
    expect(button).toHaveTextContent('Opening…');
    expect(button).toBeDisabled();
  });

  it('disables the build button while another card is opening, without showing "Opening…"', () => {
    render(
      <SuggestionCard
        suggestion={suggestion()}
        opening={false}
        buildInProgress={true}
        onBuild={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const button = screen.getByTestId('flow-suggestion-build');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Build this');
  });
});
