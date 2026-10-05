import { memo } from 'react';
import type { SubagentHistoryResponse } from '../../types';

interface SubagentProcessErrorProps {
  history?: SubagentHistoryResponse;
}

const SubagentProcessError = memo(function SubagentProcessError({
  history,
}: SubagentProcessErrorProps) {
  // Pending snapshots carry transient "not found yet" text with a running
  // status; those stay hidden. Real lookup failures (status 'error') must
  // remain visible.
  if (!history?.error || history.status !== 'error') {
    return null;
  }
  return <div className="subagent-error">{history.error}</div>;
});

export default SubagentProcessError;
