import { describe, expect, it } from 'vitest';
import { getMcpMessagePrefix, resolveInitialMcpProvider } from './providerSelection';

describe('MCP provider selection', () => {
  it('resolves to the single qwen MCP surface even when the chat provider differs', () => {
    // The lightweight edition manages one MCP surface (the shared config.json
    // channel); the chat provider no longer forks it.
    expect(resolveInitialMcpProvider('codex', 'qwen')).toBe('qwen');
    expect(resolveInitialMcpProvider('qwen', 'qwen')).toBe('qwen');
  });

  it('ignores a stale saved tab from the removed multi-provider world', () => {
    expect(resolveInitialMcpProvider('codex', 'codex')).toBe('qwen');
    expect(resolveInitialMcpProvider('codex', null)).toBe('qwen');
    expect(resolveInitialMcpProvider('unknown', null)).toBe('qwen');
  });

  it('routes every provider to the shared backend message family', () => {
    expect(getMcpMessagePrefix('qwen')).toBe('');
  });
});
