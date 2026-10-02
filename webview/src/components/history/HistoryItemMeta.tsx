import type { TFunction } from 'i18next';
import type { HistorySessionSummary } from '../../types';
import { formatFileSize } from './historyItemUtils';
import { HistoryEntrypointBadge } from './HistoryEntrypointBadge';
import { HistorySessionIdCopy } from './HistorySessionIdCopy';

export interface HistoryItemMetaProps {
  session: HistorySessionSummary;
  isCopied: boolean;
  isCopyFailed: boolean;
  t: TFunction;
  onCopySessionId: (sessionId: string) => void;
}

export const HistoryItemMeta = ({
  session,
  isCopied,
  isCopyFailed,
  t,
  onCopySessionId,
}: HistoryItemMetaProps) => {
  const fileSize = session.fileSize ? formatFileSize(session.fileSize) : null;
  const entrypoint = session.entrypoint && session.entrypoint !== 'cli' && session.entrypoint !== 'remote'
    ? session.entrypoint
    : null;

  return (
    <div className="history-item-meta">
      <span>{t('history.messageCount', { count: session.messageCount })}</span>
      {fileSize ? (
        <>
          <span className="history-meta-dot">•</span>
          <span className={fileSize.isMB ? 'history-filesize-large' : ''}>{fileSize.text}</span>
        </>
      ) : null}
      {entrypoint ? <HistoryEntrypointBadge entrypoint={entrypoint} t={t} /> : null}
      <HistorySessionIdCopy
        sessionId={session.sessionId}
        isCopied={isCopied}
        isCopyFailed={isCopyFailed}
        t={t}
        onCopySessionId={onCopySessionId}
      />
    </div>
  );
};
