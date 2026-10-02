/**
 * MCP provider selection — the lightweight edition manages a single MCP
 * surface (the Qwen/shared config.json channel). Kept as a named type so the
 * settings dialogs can still carry an explicit provider tag.
 */
export type McpProvider = 'qwen';

export function resolveInitialMcpProvider(
  _currentProvider: string,
  _savedProvider: string | null,
): McpProvider {
  return 'qwen';
}

export function getMcpMessagePrefix(_provider: McpProvider): '' {
  return '';
}
