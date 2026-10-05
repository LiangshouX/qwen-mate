import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QwenConfigSection from '../QwenConfigSection';
import CliSection from '../CliSection';
import { useQwenModelOptions } from '../../../hooks/providers/useQwenModelOptions';
import styles from './style.module.less';

export type ProviderManageTab = 'qwen' | 'cli';

interface ProviderTabSectionProps {
  currentProvider: string;
  /** Deep-linked sub-tab (e.g. from the provider dropdown's CLI entry); wins over currentProvider inference */
  initialSubTab?: ProviderManageTab;
  // Shared
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const ProviderTabSection = ({
  initialSubTab,
  addToast,
}: ProviderTabSectionProps) => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<ProviderManageTab>(() => {
    if (initialSubTab) return initialSubTab;
    return 'qwen';
  });

  // Read-only catalog of models configured in ~/.qwen/settings.json.
  const qwenModelOptions = useQwenModelOptions();

  return (
    <div className={styles.providerTabSection}>
      <h3 className={styles.sectionTitle}>{t('settings.providers')}</h3>
      <p className={styles.sectionDesc}>{t('settings.providersDesc')}</p>

      <div className={styles.tabSelector} role="tablist" aria-label={t('settings.providers')}>
        <button
          role="tab"
          aria-selected={activeTab === 'qwen'}
          aria-controls="panel-qwen-config"
          className={`${styles.tabBtn} ${activeTab === 'qwen' ? styles.active : ''}`}
          onClick={() => setActiveTab('qwen')}
        >
          <span className="codicon codicon-vm-connect" aria-hidden="true" />
          {t('settings.providerTab.qwen', { defaultValue: 'Qwen 配置' })}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'cli'}
          aria-controls="panel-cli-tools"
          className={`${styles.tabBtn} ${activeTab === 'cli' ? styles.active : ''}`}
          onClick={() => setActiveTab('cli')}
        >
          <span className="codicon codicon-terminal-bash" aria-hidden="true" />
          {t('settings.providerTab.cli')}
        </button>
      </div>

      {/* Mount only the active sub-tab. */}
      {activeTab === 'qwen' && (
        <div id="panel-qwen-config" role="tabpanel">
          <QwenConfigSection
            addToast={addToast}
            qwenModelOptions={qwenModelOptions}
          />
        </div>
      )}

      {activeTab === 'cli' && (
        <div id="panel-cli-tools" role="tabpanel">
          <CliSection addToast={addToast} />
        </div>
      )}
    </div>
  );
};

export default ProviderTabSection;
