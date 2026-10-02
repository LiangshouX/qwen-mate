import { useEffect, useRef } from 'react';
import type { SettingsTab } from '../SettingsSidebar';

interface LazyTabLoaders {
  loadAgents: () => void;
}

// Load heavy list / AI-feature data only when the corresponding tab is first opened.
// Opening Settings previously stampeded providers + agents + CLI probes at once.
// Commit / prompt-enhancer config probes multiple CLIs and must stay off first paint.
export function useLazyTabData(
  currentTab: SettingsTab,
  { loadAgents }: LazyTabLoaders
) {
  const loadedListTabsRef = useRef(new Set<SettingsTab>());
  useEffect(() => {
    if (currentTab === 'agents' && !loadedListTabsRef.current.has('agents')) {
      loadedListTabsRef.current.add('agents');
      loadAgents();
    }
    if (currentTab === 'commit' && !loadedListTabsRef.current.has('commit')) {
      loadedListTabsRef.current.add('commit');
      window.sendToJava?.('get_commit_prompt:');
      window.sendToJava?.('get_commit_ai_config:');
    }
    if (currentTab === 'promptEnhancer' && !loadedListTabsRef.current.has('promptEnhancer')) {
      loadedListTabsRef.current.add('promptEnhancer');
      window.sendToJava?.('get_prompt_enhancer_config:');
    }
  }, [currentTab, loadAgents]);
}
