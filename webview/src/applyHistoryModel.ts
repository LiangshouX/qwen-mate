import { sendBridgeEvent } from './utils/bridge';
import type { ChatScreenProps } from './components/ChatScreen';

/** Signature expected by useSessionManagement (UseSessionManagementOptions). */
export type ApplyHistoryModel = (provider: string, model: string, agent?: string | null) => void;

/** Subset of useModelProviderState's return consumed by the factory. */
export interface ApplyHistoryModelDeps {
  currentProvider: string;
  handleProviderSelect: (providerId: string) => void;
  handleAgentSelect: ChatScreenProps['onAgentSelect'];
  setSelectedQwenModel: (model: string) => void;
  setSelectedDshModel: (model: string) => void;
}

interface CreateApplyHistoryModelOptions {
  modelState: ApplyHistoryModelDeps;
}

/**
 * Builds the applyHistoryModel callback passed to useSessionManagement.
 * Extracted verbatim from App.tsx: switch provider first when the history row
 * differs, then apply the model with a direct bridge event + setter because
 * handleModelSelect reads currentProvider from a stale closure right after a
 * provider switch.
 */
export const createApplyHistoryModel = ({
  modelState,
}: CreateApplyHistoryModelOptions): ApplyHistoryModel => {
  const {
    currentProvider,
    handleProviderSelect,
    handleAgentSelect,
    setSelectedQwenModel,
    setSelectedDshModel,
  } = modelState;

  return (provider, model, agent) => {
    // Switch provider first when history row differs, then apply model.
    if (provider && provider !== currentProvider) {
      handleProviderSelect(provider);
    }
    if (model) {
      // handleModelSelect reads currentProvider; after provider switch state
      // may not have flushed yet — send bridge + setter for the target provider.
      if (provider === 'dsh') {
        setSelectedDshModel(model);
      } else {
        setSelectedQwenModel(model);
      }
      sendBridgeEvent('set_model', model);
    }
    if (agent) {
      handleAgentSelect({ id: agent, name: agent, prompt: '' });
    }
  };
};
