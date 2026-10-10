import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskCard } from './task-card';

vi.mock('@/lib/i18n/I18nContext', () => ({ useT: () => ({ t: (key: string) => key }) }));
describe('task card conversation placement', () => {
  it('sticks active work to the bottom and releases completed work', () => {
    const { container, rerender } = render(<TaskCard label="Inspect UI" state="working" />);
    expect(container.firstChild).toHaveClass('sticky', 'bottom-0');
    rerender(<TaskCard label="Inspect UI" state="done" />);
    expect(container.firstChild).not.toHaveClass('sticky');
  });
});
