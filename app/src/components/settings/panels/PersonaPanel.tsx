import debug from 'debug';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '../../../lib/i18n/I18nContext';
import {
  PERSONA_FILE_SOUL,
  readPersonaFile,
  resetPersonaFile,
  writePersonaFile,
} from '../../../services/api/personaFilesApi';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import {
  MAX_PERSONA_DESCRIPTION_LEN,
  MAX_PERSONA_DISPLAY_NAME_LEN,
  selectPersonaDescription,
  selectPersonaDisplayName,
  setPersonaDescription,
  setPersonaDisplayName,
} from '../../../store/personaSlice';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Field,
  TextArea,
  TextField,
  ToggleGroupItem,
  ToggleGroupRoot,
} from '../../ui';
import SettingsPanel from '../layout/SettingsPanel';
import PersonaGuidedFields from './persona/PersonaGuidedFields';
import PersonaTemplatePicker from './persona/PersonaTemplatePicker';

const SEGMENT_CLASS =
  'h-auto px-2.5 py-1 text-xs font-medium data-[state=on]:bg-primary-500 data-[state=on]:text-content-inverted';

type SoulMode = 'guided' | 'advanced';

const log = debug('persona:panel');

interface PersonaPanelProps {
  /** When true the panel is hosted inside another settings page (the
   *  Personality & Face tabs) — skip the standalone SettingsHeader chrome. */
  embedded?: boolean;
}

const PersonaPanel = ({ embedded = false }: PersonaPanelProps) => {
  const { t } = useT();
  const dispatch = useAppDispatch();

  const storedDisplayName = useAppSelector(selectPersonaDisplayName);
  const storedDescription = useAppSelector(selectPersonaDescription);

  const [nameDraft, setNameDraft] = useState(storedDisplayName);
  const [descriptionDraft, setDescriptionDraft] = useState(storedDescription);

  // Re-sync drafts when the store is reset externally (e.g. resetUserScopedState
  // during an identity flip) so Save can't write stale values into a clean store.
  useEffect(() => {
    setNameDraft(storedDisplayName);
  }, [storedDisplayName]);
  useEffect(() => {
    setDescriptionDraft(storedDescription);
  }, [storedDescription]);

  // SOUL.md editor state. The file is loaded over RPC on mount; `isDefault`
  // tracks whether the current on-disk copy is the bundled prompt so the UI can
  // disable Reset when there is nothing to restore.
  const [soulDraft, setSoulDraft] = useState('');
  const [soulSaved, setSoulSaved] = useState('');
  const [soulIsDefault, setSoulIsDefault] = useState(true);
  const [soulLoading, setSoulLoading] = useState(true);
  const [soulError, setSoulError] = useState<string | null>(null);
  const [soulBusy, setSoulBusy] = useState(false);
  // Guided (structured fields) is the default so users never touch raw markdown;
  // Advanced exposes the full SOUL.md text editor for power users.
  const [soulMode, setSoulMode] = useState<SoulMode>('guided');

  useEffect(() => {
    let cancelled = false;
    log('[ui-flow] soul.load:start file=%s', PERSONA_FILE_SOUL);
    readPersonaFile(PERSONA_FILE_SOUL)
      .then(file => {
        if (cancelled) return;
        setSoulDraft(file.contents);
        setSoulSaved(file.contents);
        setSoulIsDefault(file.is_default);
        setSoulError(null);
        log('[ui-flow] soul.load:ok is_default=%s', file.is_default);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        log('[ui-flow] soul.load:error %s', err instanceof Error ? err.message : err);
        setSoulError(err instanceof Error ? err.message : 'Could not load SOUL.md');
      })
      .finally(() => {
        if (!cancelled) setSoulLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Load once on mount — `t` is intentionally excluded so a locale change
    // does not re-fetch and overwrite unsaved edits.
  }, []);

  const nameDirty = nameDraft.trim() !== storedDisplayName;
  const descriptionDirty = descriptionDraft.trim() !== storedDescription;
  const identityDirty = nameDirty || descriptionDirty;

  const onSaveIdentity = () => {
    if (nameDirty) dispatch(setPersonaDisplayName(nameDraft));
    if (descriptionDirty) dispatch(setPersonaDescription(descriptionDraft));
  };

  const soulDirty = soulDraft !== soulSaved;

  const onSaveSoul = async () => {
    setSoulBusy(true);
    setSoulError(null);
    log('[ui-flow] soul.save:start bytes=%d', soulDraft.length);
    try {
      const file = await writePersonaFile(PERSONA_FILE_SOUL, soulDraft);
      setSoulDraft(file.contents);
      setSoulSaved(file.contents);
      setSoulIsDefault(file.is_default);
      log('[ui-flow] soul.save:ok');
    } catch (err) {
      log('[ui-flow] soul.save:error %s', err instanceof Error ? err.message : err);
      setSoulError(err instanceof Error ? err.message : t('settings.persona.soul.saveError'));
    } finally {
      setSoulBusy(false);
    }
  };

  const onResetSoul = async () => {
    setSoulBusy(true);
    setSoulError(null);
    log('[ui-flow] soul.reset:start');
    try {
      const file = await resetPersonaFile(PERSONA_FILE_SOUL);
      setSoulDraft(file.contents);
      setSoulSaved(file.contents);
      setSoulIsDefault(file.is_default);
      log('[ui-flow] soul.reset:ok');
    } catch (err) {
      log('[ui-flow] soul.reset:error %s', err instanceof Error ? err.message : err);
      setSoulError(err instanceof Error ? err.message : t('settings.persona.soul.resetError'));
    } finally {
      setSoulBusy(false);
    }
  };

  const dirty = identityDirty || soulDirty;

  // One save for the whole page. Identity lives in the store and the character
  // in SOUL.md on disk, but to the user it is one form; two Save buttons in two
  // cards made it easy to save half an edit.
  const onSaveAll = async () => {
    if (identityDirty) onSaveIdentity();
    if (soulDirty) await onSaveSoul();
  };

  const onDiscard = () => {
    setNameDraft(storedDisplayName);
    setDescriptionDraft(storedDescription);
    setSoulDraft(soulSaved);
    setSoulError(null);
  };

  const body = (
    <>
      {/* ── 1. Identity: how the assistant is shown in the app ──────────── */}
      <Card
        title={t('settings.persona.identityHeading')}
        description={t('settings.persona.identityDesc')}>
        <Field
          htmlFor="persona-display-name"
          label={t('settings.persona.displayNameLabel')}
          control={
            <TextField
              id="persona-display-name"
              aria-label={t('settings.persona.displayNameLabel')}
              data-testid="persona-display-name-input"
              value={nameDraft}
              maxLength={MAX_PERSONA_DISPLAY_NAME_LEN}
              placeholder={t('settings.persona.displayNamePlaceholder')}
              onChange={e => setNameDraft(e.target.value)}
              className="w-72"
            />
          }
        />
        <Field
          htmlFor="persona-description"
          label={t('settings.persona.descriptionLabel')}
          control={
            <TextField
              id="persona-description"
              aria-label={t('settings.persona.descriptionLabel')}
              data-testid="persona-description-input"
              value={descriptionDraft}
              maxLength={MAX_PERSONA_DESCRIPTION_LEN}
              placeholder={t('settings.persona.descriptionPlaceholder')}
              onChange={e => setDescriptionDraft(e.target.value)}
              className="w-72"
            />
          }
        />
      </Card>

      {soulLoading ? (
        <Card padded>
          <p className="text-sm text-content-muted">{t('common.loading')}</p>
        </Card>
      ) : (
        <>
          {/* ── 2. Role: pick a template, or Custom once edited ───────────── */}
          {soulMode === 'guided' && (
            <Card
              title={t('settings.persona.templates.heading')}
              description={t('settings.persona.templates.desc')}>
              <div className="p-4">
                <PersonaTemplatePicker
                  value={soulDraft}
                  onChange={setSoulDraft}
                  disabled={soulBusy}
                />
              </div>
            </Card>
          )}

          {/* ── 3. Character: the SOUL.md sections, as plain fields ──────── */}
          <Card
            title={t('settings.persona.characterHeading')}
            description={
              soulMode === 'guided'
                ? t('settings.persona.builder.intro')
                : t('settings.persona.characterDesc')
            }
            headerRight={
              <ToggleGroupRoot
                type="single"
                value={soulMode}
                onValueChange={next => {
                  if (next) setSoulMode(next as SoulMode);
                }}
                aria-label={t('settings.persona.builder.modeLabel')}
                variant="secondary"
                size="xs"
                className="overflow-hidden rounded-lg border border-line gap-0 *:rounded-none *:border-0">
                <ToggleGroupItem
                  value="guided"
                  data-testid="persona-soul-mode-guided"
                  className={SEGMENT_CLASS}>
                  {t('settings.persona.builder.modeGuided')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="advanced"
                  data-testid="persona-soul-mode-advanced"
                  className={SEGMENT_CLASS}>
                  {t('settings.persona.builder.modeAdvanced')}
                </ToggleGroupItem>
              </ToggleGroupRoot>
            }>
            <div className="p-4">
              {soulMode === 'guided' ? (
                <PersonaGuidedFields
                  value={soulDraft}
                  onChange={setSoulDraft}
                  disabled={soulBusy}
                />
              ) : (
                <TextArea
                  aria-label={t('settings.persona.soul.editorLabel')}
                  data-testid="persona-soul-editor"
                  value={soulDraft}
                  rows={14}
                  spellCheck={false}
                  className="font-mono text-xs leading-relaxed"
                  onChange={e => setSoulDraft(e.target.value)}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-[11px] text-content-muted">
                {soulIsDefault ? (
                  <span data-testid="persona-soul-default-badge">
                    {t('settings.persona.soul.usingDefault')}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                data-testid="persona-soul-reset"
                variant="tertiary"
                size="xs"
                leadingIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => void onResetSoul()}
                disabled={soulBusy || soulIsDefault}>
                {t('settings.persona.soul.reset')}
              </Button>
            </div>
          </Card>
        </>
      )}

      {soulError && (
        <Alert variant="destructive" density="compact" data-testid="persona-soul-error">
          <AlertDescription>{soulError}</AlertDescription>
        </Alert>
      )}

      {/* ── One save bar for the page, shown only with unsaved edits ────── */}
      {dirty && (
        <div
          className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-float backdrop-blur"
          data-testid="persona-save-bar">
          <span className="text-sm text-content-muted">{t('settings.persona.unsavedChanges')}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onDiscard} disabled={soulBusy}>
              {t('settings.persona.discard')}
            </Button>
            <Button
              size="sm"
              data-testid="persona-save"
              onClick={() => void onSaveAll()}
              disabled={soulBusy}>
              {t('settings.persona.saveChanges')}
            </Button>
          </div>
        </div>
      )}
    </>
  );

  // Embedded inside another page: the host owns the header and gutter.
  if (embedded) return <div className="space-y-5">{body}</div>;

  return <SettingsPanel description={t('settings.personality.menuDesc')}>{body}</SettingsPanel>;
};

export default PersonaPanel;
