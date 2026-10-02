import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  promptProvider,
  resetPromptsState,
  setupPromptsCallback,
} from './promptProvider';

describe('promptProvider provider isolation', () => {
  beforeEach(() => {
    resetPromptsState();
    window.sendToJava = vi.fn();
    setupPromptsCallback();
  });

  it('loads only prompts owned by the requested provider', async () => {
    const loading = promptProvider('', new AbortController().signal, 'dsh');
    window.updateGlobalPrompts?.(JSON.stringify({
      provider: 'dsh',
      prompts: [
        { id: 'codex-1', name: 'Dsh prompt', content: 'dsh', provider: 'dsh' },
        { id: 'claude-1', name: 'Qwen prompt', content: 'qwen', provider: 'qwen' },
      ],
    }));
    window.updateProjectPrompts?.(JSON.stringify({ provider: 'dsh', prompts: [] }));

    const items = await loading;

    expect(items.map(item => item.id)).toContain('codex-1');
    expect(items.map(item => item.id)).not.toContain('claude-1');
  });

  it('ignores callbacks for a provider that is no longer active', async () => {
    window.updateGlobalPrompts?.(JSON.stringify({ provider: 'dsh', prompts: [
      { id: 'codex-1', name: 'Dsh prompt', content: 'dsh', provider: 'dsh' },
    ] }));
    await promptProvider('', new AbortController().signal, 'dsh');

    await promptProvider('', new AbortController().signal, 'qwen');
    window.updateGlobalPrompts?.(JSON.stringify({ provider: 'dsh', prompts: [
      { id: 'codex-2', name: 'Stale Dsh prompt', content: 'dsh', provider: 'dsh' },
    ] }));
    window.updateGlobalPrompts?.(JSON.stringify({ provider: 'qwen', prompts: [
      { id: 'claude-1', name: 'Qwen prompt', content: 'qwen' },
    ] }));
    window.updateProjectPrompts?.(JSON.stringify({ provider: 'qwen', prompts: [] }));

    const items = await promptProvider('', new AbortController().signal, 'qwen');

    expect(items.map(item => item.id)).toContain('claude-1');
    expect(items.map(item => item.id)).not.toContain('codex-2');
  });
});
