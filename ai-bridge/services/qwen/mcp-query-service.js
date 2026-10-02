/**
 * Qwen MCP query service — bridge entry points for the MCP settings panel.
 *
 * Wires the shared services/mcp-status toolkit (server probing + tool listing)
 * to the channel/daemon command surface:
 *   qwen.getMcpServerStatus  -> emitMcpServerStatus(cwd)
 *   qwen.getMcpServerTools   -> emitMcpServerTools(serverId, cwd)
 *
 * Output contract (identical in per-process and daemon mode — the daemon wraps
 * each stdout line in an {id, line} envelope and Java unwraps it):
 *   status:  "[MCP_SERVER_STATUS]<json array>" plus a plain JSON envelope
 *   tools:   "[MCP_SERVER_TOOLS]<json object>" plus the same plain JSON object
 *
 * Failure behaviour: probes that fail degrade to an empty list / error payload,
 * never a thrown exception, so the frontend renders empty state instead of an
 * error popup.
 */
import {
  getMcpServersStatus,
  getMcpServerTools as getMcpServerToolsImpl,
  loadMcpServersConfig
} from '../mcp-status/index.js';

export const MCP_STATUS_MARKER = '[MCP_SERVER_STATUS]';
export const MCP_TOOLS_MARKER = '[MCP_SERVER_TOOLS]';

/**
 * Probe every configured MCP server and emit its connection status.
 * @param {string|null} cwd - Working directory (used to detect project-specific config)
 */
export async function emitMcpServerStatus(cwd = null) {
  try {
    const status = await getMcpServersStatus(cwd);

    // Marker line for fast identification on the Java side, plus a plain JSON
    // envelope as a structured fallback.
    console.log(MCP_STATUS_MARKER + JSON.stringify(status));
    console.log(JSON.stringify({ success: true, status, servers: status }));
  } catch (error) {
    console.error('[GET_MCP_SERVER_STATUS_ERROR]', error.message);
    // Degrade to an empty list so the panel renders empty state, not an error.
    console.log(MCP_STATUS_MARKER + JSON.stringify([]));
    console.log(JSON.stringify({ success: true, status: [], servers: [] }));
  }
}

/**
 * Connect to one MCP server and emit its tool list.
 * @param {string} serverId - MCP server ID (config key)
 * @param {string|null} cwd - Working directory (used to detect project-specific config)
 */
export async function emitMcpServerTools(serverId, cwd = null) {
  try {
    console.log('[McpTools] Getting tools for MCP server:', serverId);

    // First load server configuration, passing cwd for project-specific config
    const mcpServers = await loadMcpServersConfig(cwd);
    const targetServer = mcpServers.find(s => s.name === serverId);

    if (!targetServer) {
      const notFound = {
        success: false,
        serverId,
        error: `Server not found: ${serverId}`,
        tools: []
      };
      console.log(MCP_TOOLS_MARKER + JSON.stringify(notFound));
      console.log(JSON.stringify(notFound));
      return;
    }

    // Call the mcp-status toolkit to get the tools list
    const toolsResult = await getMcpServerToolsImpl(serverId, targetServer.config);

    const tools = toolsResult.tools || [];
    const hasError = !!toolsResult.error;
    // success=true means tools are usable; error may still contain warnings.
    // success=false only when no tools AND has error (e.g. timeout, connection failure).
    const resultJson = JSON.stringify({
      success: !hasError || tools.length > 0,
      serverId,
      serverName: toolsResult.name || serverId,
      tools,
      error: toolsResult.error
    });
    console.log(MCP_TOOLS_MARKER + resultJson);
    console.log(resultJson);
  } catch (error) {
    console.error('[GET_MCP_SERVER_TOOLS_ERROR]', error.message);
    // Degrade to an empty tool list instead of surfacing a raw exception.
    const errorResult = JSON.stringify({
      success: false,
      serverId,
      error: error.message,
      tools: []
    });
    console.log(MCP_TOOLS_MARKER + errorResult);
    console.log(errorResult);
  }
}
