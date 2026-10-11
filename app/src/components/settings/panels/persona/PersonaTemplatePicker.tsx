import { Check } from 'lucide-react';

import { cn } from '../../../../lib/cn';
import { useT } from '../../../../lib/i18n/I18nContext';
import { applyTemplate, matchTemplate, PERSONA_TEMPLATES } from './personaTemplates';

interface PersonaTemplatePickerProps {
  /** Current raw SOUL.md text a template is spliced into. */
  value: string;
  /** Emit the updated SOUL.md text after a template is applied. */
  onChange: (nextSoul: string) => void;
  disabled?: boolean;
}

/**
 * Role starting-points for the guided persona builder (issue #4253, PR2).
 *
 * Applying a template fills the Personality and Communication-style fields for a
 * common role (doctor, researcher, executive, teacher, student, family) and
 * leaves the rest of SOUL.md — including the user-specific "About you" — intact.
 * Nothing is persisted until the user saves, so this is a safe starting point.
 */
const PersonaTemplatePicker = ({
  value,
  onChange,
  disabled = false,
}: PersonaTemplatePickerProps) => {
  const { t } = useT();

  const active = matchTemplate(value);

  const tileClass = (selected: boolean) =>
    cn(
      'relative flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 pr-8 text-left transition-colors',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500/25',
      'disabled:cursor-not-allowed disabled:opacity-50',
      selected
        ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-500/10'
        : 'border-line hover:border-line-strong hover:bg-surface-hover'
    );

  const check = (
    <Check className="absolute right-2.5 top-2.5 h-4 w-4 text-primary-500" aria-hidden />
  );

  // A radio group: exactly one role describes the current character — a
  // template it still matches, or Custom once the user has edited away.
  return (
    <div
      role="radiogroup"
      aria-label={t('settings.persona.templates.heading')}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {PERSONA_TEMPLATES.map(template => {
        const selected = active?.id === template.id;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            data-testid={`persona-template-${template.id}`}
            onClick={() => onChange(applyTemplate(value, template))}
            className={tileClass(selected)}>
            {selected && check}
            <span className="text-sm font-medium text-content">{t(template.labelKey)}</span>
            <span className="text-xs text-content-muted leading-snug">
              {t(template.descriptionKey)}
            </span>
          </button>
        );
      })}
      {/* Custom is a state, not an action: it lights up when the fields no
          longer match any template, and applies nothing when clicked. */}
      <button
        type="button"
        role="radio"
        aria-checked={active === null}
        disabled={disabled}
        data-testid="persona-template-custom"
        onClick={() => undefined}
        className={cn(tileClass(active === null), 'cursor-default')}>
        {active === null && check}
        <span className="text-sm font-medium text-content">
          {t('settings.persona.templates.custom.label')}
        </span>
        <span className="text-xs text-content-muted leading-snug">
          {t('settings.persona.templates.custom.desc')}
        </span>
      </button>
    </div>
  );
};

export default PersonaTemplatePicker;
