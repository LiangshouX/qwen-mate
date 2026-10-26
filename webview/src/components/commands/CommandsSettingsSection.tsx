import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Command, CommandFilter, CommandsConfig } from '../../types/command';
import { sendToJava } from '../../utils/bridge';

/**
 * Custom commands settings component.
 * Lists ~/.qwen/commands and project .qwen/commands entries with counts;
 * expanding a card shows its frontmatter. Editing is delegated to the IDE
 * editor since commands are plain Markdown files.
 */
export function CommandsSettingsSection() {
  const { t } = useTranslation();

  // Commands data
  const [commands, setCommands] = useState<CommandsConfig>({ global: {}, local: {} });
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // UI state
  const [currentFilter, setCurrentFilter] = useState<CommandFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadCommands = useCallback(() => {
    setLoading(true);
    sendToJava('get_all_commands', {});
  }, []);

  // Register callback: Java side returns the commands list
  useEffect(() => {
    window.updateCommands = (jsonStr: string) => {
      try {
        const data: CommandsConfig = JSON.parse(jsonStr);
        setCommands(data);
      } catch (error) {
        console.error('[CommandsSettings] Failed to parse commands:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCommands();

    return () => {
      window.updateCommands = undefined;
    };
  }, [loadCommands]);

  // Filtered list and tab counts
  const { filteredCommands, totalCount, globalCount, localCount } = useMemo(() => {
    const globalList = Object.values(commands.global ?? {});
    const localList = Object.values(commands.local ?? {});
    const allList = [...globalList, ...localList];

    let list: Command[] = [];
    if (currentFilter === 'global') {
      list = globalList;
    } else if (currentFilter === 'local') {
      list = localList;
    } else {
      list = allList;
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(cmd =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.path.toLowerCase().includes(query) ||
        (cmd.description && cmd.description.toLowerCase().includes(query))
      );
    }

    return {
      filteredCommands: list,
      totalCount: allList.length,
      globalCount: globalList.length,
      localCount: localList.length,
    };
  }, [commands, currentFilter, searchQuery]);

  // Accordion behavior: only one card expanded at a time
  const toggleExpand = (commandId: string) => {
    const next = new Set<string>();
    if (!expandedIds.has(commandId)) {
      next.add(commandId);
    }
    setExpandedIds(next);
  };

  // Open the command file in the IDE editor
  const handleOpen = (command: Command) => {
    sendToJava('open_command', { path: command.path });
  };

  const handleRefresh = () => {
    loadCommands();
  };

  return (
    <div className="skills-settings-section">
      {/* Toolbar */}
      <div className="skills-toolbar">
        <div className="filter-tabs">
          <div
            className={`tab-item ${currentFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCurrentFilter('all')}
          >
            {t('commands.all')} <span className="count-badge">{totalCount}</span>
          </div>
          <div
            className={`tab-item ${currentFilter === 'global' ? 'active' : ''}`}
            onClick={() => setCurrentFilter('global')}
          >
            {t('chat.global')} <span className="count-badge">{globalCount}</span>
          </div>
          <div
            className={`tab-item ${currentFilter === 'local' ? 'active' : ''}`}
            onClick={() => setCurrentFilter('local')}
          >
            {t('chat.localProject')} <span className="count-badge">{localCount}</span>
          </div>
        </div>

        <div className="toolbar-right">
          {/* Search box */}
          <div className="search-box">
            <span className="codicon codicon-search"></span>
            <input
              className="search-input"
              type="text"
              placeholder={t('commands.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Refresh button */}
          <button
            className="icon-btn"
            onClick={handleRefresh}
            disabled={loading}
            title={t('chat.refresh')}
          >
            <span className={`codicon codicon-refresh ${loading ? 'spinning' : ''}`}></span>
          </button>
        </div>
      </div>

      {/* Commands list */}
      <div className="skill-list">
        {filteredCommands.map((command) => (
          <div
            key={command.id}
            className={`skill-card ${expandedIds.has(command.id) ? 'expanded' : ''}`}
          >
            {/* Card header */}
            <div className="card-header" onClick={() => toggleExpand(command.id)}>
              <div className="skill-icon-wrapper" style={{ color: '#3B82F6' }}>
                <span className="codicon codicon-terminal"></span>
              </div>

              <div className="skill-info">
                <div className="skill-header-row">
                  <span className="skill-name">{command.name}</span>
                  <span className={`scope-badge ${command.scope}`}>
                    <span className={`codicon ${command.scope === 'global' ? 'codicon-globe' : 'codicon-desktop-download'}`}></span>
                    {command.scope === 'global' ? t('chat.global') : t('chat.localProject')}
                  </span>
                </div>
                <div className="skill-path" title={command.path}>{command.path}</div>
              </div>

              <div className="expand-indicator">
                <span className={`codicon ${expandedIds.has(command.id) ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}></span>
              </div>
            </div>

            {/* Expanded detail panel: description, frontmatter and edit action */}
            {expandedIds.has(command.id) && (
              <div className="card-content">
                <div className="info-section">
                  {command.description ? (
                    <div className="description-container">
                      <div className="description-label">{t('commands.description')}:</div>
                      <div className="description-content">{command.description}</div>
                    </div>
                  ) : (
                    <div className="description-placeholder">{t('commands.noDescription')}</div>
                  )}

                  {command.frontmatter && Object.keys(command.frontmatter).length > 0 ? (
                    <div className="frontmatter-container">
                      <div className="description-label">{t('commands.frontmatter')}:</div>
                      <div className="frontmatter-table">
                        {Object.entries(command.frontmatter).map(([key, value]) => (
                          <div className="frontmatter-row" key={key}>
                            <span className="frontmatter-key">{key}</span>
                            <span className="frontmatter-value">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="description-placeholder">{t('commands.noFrontmatter')}</div>
                  )}
                </div>

                <div className="actions-section">
                  <button className="action-btn edit-btn" onClick={() => handleOpen(command)}>
                    <span className="codicon codicon-edit"></span> {t('commands.editInIde')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Empty state */}
        {filteredCommands.length === 0 && !loading && (
          <div className="empty-state">
            <span className="codicon codicon-terminal"></span>
            <p>{t('commands.noMatching')}</p>
            <p className="hint">{t('commands.emptyHint')}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && filteredCommands.length === 0 && (
          <div className="loading-state">
            <span className="codicon codicon-loading codicon-modifier-spin"></span>
            <p>{t('common.loading')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
