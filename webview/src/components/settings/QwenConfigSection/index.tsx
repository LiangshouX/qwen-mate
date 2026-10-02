import { useTranslation } from 'react-i18next';
import type { QwenModelOptions } from '../../ChatInputBox/resolveProviderModels';
import styles from './style.module.less';

const ICON_14_STYLE: React.CSSProperties = { fontSize: 14 };
const FLEX_1_STYLE: React.CSSProperties = { flex: 1 };

interface QwenConfigSectionProps {
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  /** Custom-model management entry (shared CustomModelDialog lives in ProviderTabSection). */
  customModelCount?: number;
  onManageCustomModels?: () => void;
  /** Read-only view of the models configured in ~/.qwen/settings.json (modelProviders). */
  qwenModelOptions?: QwenModelOptions;
}

/** Format a token count like 1000000 as "1M" / 256000 as "256K". */
function formatContextWindow(tokens?: number): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens % 1_000 === 0) return `${tokens / 1_000}K`;
  return String(tokens);
}

/**
 * Settings → Qwen 配置: a read-only view of the models configured in the Qwen
 * Code CLI settings (~/.qwen/settings.json modelProviders), plus the
 * custom-model management entry. Auth is owned by the CLI settings (API key /
 * Base URL / environment variables live there), so this panel never edits it.
 */
const QwenConfigSection = ({
  addToast: _addToast,
  customModelCount = 0,
  onManageCustomModels,
  qwenModelOptions,
}: QwenConfigSectionProps) => {
  const { t } = useTranslation();
  const models = qwenModelOptions?.models ?? [];
  const configuredModel = qwenModelOptions?.configuredModel?.trim() ?? '';

  return (
    <div className={styles.qwenConfigSection}>
      {onManageCustomModels && (
        <div
          className={styles.modelsRow}
          onClick={onManageCustomModels}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onManageCustomModels(); }}
        >
          <span className="codicon codicon-symbol-misc" style={ICON_14_STYLE} />
          <span className={styles.modelsLabel}>
            {t('settings.pluginModels.title')}
          </span>
          {customModelCount > 0 && (
            <span className={styles.modelsBadge}>{customModelCount}</span>
          )}
          <span style={FLEX_1_STYLE} />
          <button
            className={styles.modelsManageBtn}
            onClick={(e) => { e.stopPropagation(); onManageCustomModels(); }}
          >
            {t('settings.pluginModels.manage')}
          </button>
        </div>
      )}

      <div className={styles.cliModelsHeader}>
        <span className="codicon codicon-terminal" style={ICON_14_STYLE} />
        <span className={styles.modelsLabel}>
          {t('settings.qwenConfig.cliModelsTitle', { defaultValue: '来自 CLI 配置' })}
        </span>
        <span className={styles.readOnlyBadge}>
          {t('settings.qwenConfig.readOnly', { defaultValue: '只读' })}
        </span>
      </div>
      <div className={styles.cliModelsDesc}>
        {t('settings.qwenConfig.cliModelsDesc', {
          defaultValue: '读取 ~/.qwen/settings.json 的 modelProviders 配置；如需增改请直接编辑该文件。',
        })}
      </div>

      {models.length === 0 ? (
        <div className={styles.cliModelsEmpty}>
          {t('settings.qwenConfig.cliModelsEmpty', { defaultValue: '未在 CLI 配置中发现模型' })}
        </div>
      ) : (
        <div className={styles.cliModelList}>
          {models.map((model) => {
            const windowLabel = formatContextWindow(model.contextWindowTokens);
            const isCurrent = configuredModel && model.id === configuredModel;
            return (
              <div key={model.id} className={styles.cliModelRow}>
                <span className="codicon codicon-package" style={ICON_14_STYLE} />
                <span className={styles.cliModelName}>{model.label}</span>
                {isCurrent && (
                  <span className={styles.currentBadge}>
                    {t('models.qwen.currentConfigured.badge', { defaultValue: '当前' })}
                  </span>
                )}
                <span style={FLEX_1_STYLE} />
                {windowLabel && (
                  <span className={styles.cliModelMeta}>
                    {t('settings.qwenConfig.contextWindow', { defaultValue: '上下文' })} {windowLabel}
                  </span>
                )}
                {model.description && (
                  <span className={styles.cliModelProvider}>{model.description}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default QwenConfigSection;
