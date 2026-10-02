/**
 * Qwen Code channel — command routing for per-process mode.
 */
import {
  sendMessagePersistent,
  sendMessageWithAttachmentsPersistent,
  preconnectPersistent,
  resetRuntimePersistent,
  getContextUsagePersistent,
} from '../services/qwen/persistent-query-service.js';
import {
  emitMcpServerStatus,
  emitMcpServerTools,
} from '../services/qwen/mcp-query-service.js';

export function getQwenCommandList() {
  return [
    'send',
    'sendWithAttachments',
    'preconnect',
    'resetRuntime',
    'getContextUsage',
    'getMcpServerStatus',
    'getMcpServerTools',
  ];
}

export async function handleQwenCommand(command, args, stdinData) {
  switch (command) {
    case 'send':
      await sendMessagePersistent(stdinData);
      break;
    case 'sendWithAttachments':
      await sendMessageWithAttachmentsPersistent(stdinData);
      break;
    case 'preconnect':
      await preconnectPersistent(stdinData);
      break;
    case 'resetRuntime':
      await resetRuntimePersistent(stdinData);
      break;
    case 'getContextUsage':
      await getContextUsagePersistent(stdinData);
      break;
    case 'getMcpServerStatus': {
      const cwd = stdinData?.cwd || args?.[0] || null;
      await emitMcpServerStatus(cwd);
      break;
    }
    case 'getMcpServerTools': {
      const serverId = stdinData?.serverId || args?.[0] || null;
      const cwd = stdinData?.cwd || args?.[1] || null;
      await emitMcpServerTools(serverId, cwd);
      break;
    }
    default:
      console.log(JSON.stringify({ success: false, error: `Unknown qwen command: ${command}` }));
  }
}
