import { DEFAULT_QWEN_MODEL_ID } from '../../components/ChatInputBox/types';
import { useCliProviderState } from './useCliProviderState';

/**
 * Qwen provider state.
 * Auth/config lives in the Java settings (Settings → Qwen 配置); the plugin
 * only stores the last-picked model id and permission mode locally.
 */
export function useQwenProvider() {
  const state = useCliProviderState(DEFAULT_QWEN_MODEL_ID);
  return {
    selectedQwenModel: state.selectedModel,
    setSelectedQwenModel: state.setSelectedModel,
    qwenPermissionMode: state.permissionMode,
    setQwenPermissionMode: state.setPermissionMode,
  };
}

export type UseQwenProviderReturn = ReturnType<typeof useQwenProvider>;
