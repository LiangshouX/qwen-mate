import { useTranslation } from 'react-i18next';
import CliToolCard from './CliToolCard';
import {
  CLI_TOOL_DEFINITIONS,
  type CliStatusMap,
  type CliToolId,
} from '../../../types/cliTool';
import styles from './style.module.less';

interface CliToolListProps {
  loading: boolean;
  statusError: boolean;
  statusMap: CliStatusMap;
  onRefresh: () => void;
  onOpenInstall: (id: CliToolId) => void;
  onOpenDocs: (url: string) => void;
  hiddenProviders: ReadonlySet<string>;
  onToggleSwitcherVisibility: (id: CliToolId, hidden: boolean) => void;
}

const CliToolList = ({
  loading,
  statusError,
  statusMap,
  onRefresh,
  onOpenInstall,
  onOpenDocs,
  hiddenProviders,
  onToggleSwitcherVisibility,
}: CliToolListProps) => {
  const { t } = useTranslation();

  if (loading && Object.keys(statusMap).length === 0) {
    return (
      <div className={styles.cliList}>
        <div className={styles.loadingState}>
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{t('settings.cli.loading')}</span>
        </div>
      </div>
    );
  }

  if (statusError && Object.keys(statusMap).length === 0) {
    return (
      <div className={styles.cliList}>
        <div className={styles.errorState}>
          <span className="codicon codicon-warning" />
          <span>{t('settings.cli.loadFailed')}</span>
          <button type="button" className={styles.refreshBtn} onClick={onRefresh}>
            <span className="codicon codicon-refresh" />
            {t('settings.cli.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cliList}>
      {CLI_TOOL_DEFINITIONS.map((tool) => (
        <CliToolCard
          key={tool.id}
          tool={tool}
          status={statusMap[tool.id]}
          onOpenInstall={onOpenInstall}
          onOpenDocs={onOpenDocs}
          switcherHidden={hiddenProviders.has(tool.id)}
          onToggleSwitcherVisibility={onToggleSwitcherVisibility}
        />
      ))}
    </div>
  );
};

export default CliToolList;
