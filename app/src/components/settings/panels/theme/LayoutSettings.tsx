import { useMemo } from 'react';

import { useT } from '../../../../lib/i18n/I18nContext';
import {
  BORDER_AREAS,
  type BorderArea,
  type BorderContrast,
  type CornerStyle,
  resolveLayout,
} from '../../../../lib/theme/layout';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { resetThemeLayout, setThemeLayout } from '../../../../store/themeSlice';
import { Button, Card, Field, Switch, ToggleGroupItem, ToggleGroupRoot } from '../../../ui';

const CORNERS: CornerStyle[] = ['none', 'subtle', 'default', 'round'];
const CONTRASTS: BorderContrast[] = ['subtle', 'default', 'strong'];

const segmentedClass =
  'overflow-hidden rounded-lg border border-line gap-0 *:rounded-none *:border-0';
const segmentClass =
  'h-auto px-2.5 py-1 text-xs font-medium data-[state=on]:bg-primary-500 data-[state=on]:text-content-inverted';

/**
 * Appearance → Layout. Corner rounding, border contrast and which areas draw
 * borders. Changes apply live through `ThemeProvider` (see `lib/theme/layout`).
 */
const LayoutSettings = () => {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const rawLayout = useAppSelector(state => state.theme?.layout);
  const layout = useMemo(() => resolveLayout(rawLayout), [rawLayout]);

  const areaLabel: Record<BorderArea, { label: string; description: string }> = {
    cards: {
      label: t('settings.layout.area.cards'),
      description: t('settings.layout.area.cardsDesc'),
    },
    controls: {
      label: t('settings.layout.area.controls'),
      description: t('settings.layout.area.controlsDesc'),
    },
    dividers: {
      label: t('settings.layout.area.dividers'),
      description: t('settings.layout.area.dividersDesc'),
    },
    frame: {
      label: t('settings.layout.area.frame'),
      description: t('settings.layout.area.frameDesc'),
    },
  };

  return (
    <>
      <Card title={t('settings.layout.shapeHeading')} data-testid="layout-shape">
        <Field
          label={t('settings.layout.corners')}
          description={t('settings.layout.cornersDesc')}
          control={
            <ToggleGroupRoot
              type="single"
              variant="secondary"
              size="xs"
              value={layout.corners}
              onValueChange={next => {
                if (next) dispatch(setThemeLayout({ corners: next as CornerStyle }));
              }}
              aria-label={t('settings.layout.corners')}
              className={segmentedClass}>
              {CORNERS.map(c => (
                <ToggleGroupItem key={c} value={c} className={segmentClass}>
                  {t(`settings.layout.corners.${c}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroupRoot>
          }
        />
        <Field
          label={t('settings.layout.contrast')}
          description={t('settings.layout.contrastDesc')}
          control={
            <ToggleGroupRoot
              type="single"
              variant="secondary"
              size="xs"
              value={layout.borderContrast}
              onValueChange={next => {
                if (next) dispatch(setThemeLayout({ borderContrast: next as BorderContrast }));
              }}
              aria-label={t('settings.layout.contrast')}
              className={segmentedClass}>
              {CONTRASTS.map(c => (
                <ToggleGroupItem key={c} value={c} className={segmentClass}>
                  {t(`settings.layout.contrast.${c}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroupRoot>
          }
        />
      </Card>

      <Card
        title={t('settings.layout.areasHeading')}
        description={t('settings.layout.areasDesc')}
        data-testid="layout-areas">
        {BORDER_AREAS.map(area => (
          <Field
            key={area}
            htmlFor={`layout-area-${area}`}
            label={areaLabel[area].label}
            description={areaLabel[area].description}
            control={
              <Switch
                id={`layout-area-${area}`}
                checked={layout.borderAreas[area]}
                onCheckedChange={next =>
                  dispatch(setThemeLayout({ borderAreas: { [area]: next } }))
                }
                aria-label={areaLabel[area].label}
                data-testid={`layout-area-${area}`}
              />
            }
          />
        ))}
      </Card>

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => dispatch(resetThemeLayout())}>
          {t('settings.layout.reset')}
        </Button>
      </div>
    </>
  );
};

export default LayoutSettings;
