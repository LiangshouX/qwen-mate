import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelInfo } from './ChatInputBox/types';
import { resolveModelIdForIcon } from './ChatInputBox/modelLabelUtils';
import { ProviderModelIcon } from './shared/ProviderModelIcon';
import { useQwenModelOptions } from '../hooks/providers/useQwenModelOptions';
import { setDefaultModel } from '../utils/defaultModel';
import './ModelSelectDialog.css';

interface ModelSelectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful write so the host can toast the new default. */
  onSaved?: (modelId: string) => void;
  /** Empty-state escape hatch: jump to Settings → 供应商管理. */
  onOpenProviderSettings?: () => void;
}

/**
 * Bottom-sheet single select for the CLI's global default model (the `/model`
 * command). Session-scoped switching stays in the input-box selector; this
 * dialog only persists `model` in ~/.qwen/settings.json.
 */
const ModelSelectDialog = ({
  isOpen,
  onClose,
  onSaved,
  onOpenProviderSettings,
}: ModelSelectDialogProps) => {
  const { t } = useTranslation();
  const { configuredModel, models } = useQwenModelOptions();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSavingId(null);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && savingId === null) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, savingId, onClose]);

  const handleSelect = useCallback(async (model: ModelInfo) => {
    if (savingId !== null) return;
    setSavingId(model.id);
    setError(null);
    const result = await setDefaultModel(model.id, model.description);
    setSavingId(null);
    if (result.success) {
      onSaved?.(model.id);
      onClose();
      return;
    }
    setError(result.error || t('modelSelect.saveFailed', {
      defaultValue: 'Failed to set the default model',
    }));
  }, [savingId, onSaved, onClose, t]);

  if (!isOpen) return null;

  const currentModel = configuredModel.trim();

  return (
    <div className="permission-dialog-overlay model-select-overlay">
      <div
        className="model-select-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('modelSelect.title', { defaultValue: 'Default model' })}
      >
        <div className="model-select-header">
          <h2 className="model-select-title">
            {t('modelSelect.title', { defaultValue: 'Default model' })}
          </h2>
          <button
            type="button"
            className="model-select-close"
            onClick={onClose}
            disabled={savingId !== null}
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        <p className="model-select-hint">
          {t('modelSelect.hint', {
            defaultValue: 'This changes Qwen Code\'s global default model. To switch only the current session, use the model selector below the input box.',
          })}
        </p>

        {error ? <div className="model-select-error">{error}</div> : null}

        {models.length === 0 ? (
          <div className="model-select-empty">
            <p>{t('modelSelect.empty', {
              defaultValue: 'No models are configured in ~/.qwen/settings.json yet.',
            })}</p>
            {onOpenProviderSettings ? (
              <button
                type="button"
                className="model-select-empty-action"
                onClick={() => {
                  onClose();
                  onOpenProviderSettings();
                }}
              >
                {t('modelSelect.openProviderSettings', { defaultValue: 'Open provider settings' })}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="model-select-list" role="listbox">
            {models.map((model) => {
              const isCurrent = model.id === currentModel;
              const isSaving = savingId === model.id;
              return (
                <button
                  key={`${model.description ?? ''}:${model.id}`}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`model-select-row${isCurrent ? ' current' : ''}`}
                  onClick={() => handleSelect(model)}
                  disabled={savingId !== null}
                  data-testid={`model-select-row-${model.id}`}
                >
                  <ProviderModelIcon
                    providerId="qwen"
                    modelId={resolveModelIdForIcon(model.id)}
                    size={16}
                    colored
                  />
                  <span className="model-select-row-info">
                    <span className="model-select-row-label">{model.label}</span>
                    {model.description ? (
                      <span className="model-select-row-description">{model.description}</span>
                    ) : null}
                  </span>
                  {isSaving ? (
                    <span className="model-select-row-state">
                      {t('modelSelect.saving', { defaultValue: 'Saving…' })}
                    </span>
                  ) : isCurrent ? (
                    <span
                      className="codicon codicon-check model-select-row-check"
                      title={t('modelSelect.current', { defaultValue: 'Current default' })}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelSelectDialog;
