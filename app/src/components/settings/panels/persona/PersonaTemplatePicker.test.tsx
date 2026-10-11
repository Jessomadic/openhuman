import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PersonaTemplatePicker from './PersonaTemplatePicker';

// Pass-through translator so assertions can target the i18n keys directly.
vi.mock('../../../../lib/i18n/I18nContext', () => ({ useT: () => ({ t: (key: string) => key }) }));

describe('<PersonaTemplatePicker />', () => {
  it('renders one radio per persona template', () => {
    render(<PersonaTemplatePicker value="" onChange={vi.fn()} />);
    const radios = screen
      .getAllByRole('radio')
      .filter(b => b.getAttribute('data-testid')?.startsWith('persona-template-'));
    expect(radios.length).toBeGreaterThan(0);
    radios.forEach(radio => {
      expect(radio).toHaveAttribute('aria-checked');
    });
  });

  it('applies the clicked template to the current value', () => {
    const onChange = vi.fn();
    render(<PersonaTemplatePicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('persona-template-doctor'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.any(String));
  });

  it('disables every template radio when disabled', () => {
    render(<PersonaTemplatePicker value="" onChange={vi.fn()} disabled />);
    const radios = screen
      .getAllByRole('radio')
      .filter(b => b.getAttribute('data-testid')?.startsWith('persona-template-'));
    radios.forEach(radio => expect(radio).toBeDisabled());
  });
});
