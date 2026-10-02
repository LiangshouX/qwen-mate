package com.qwenmate.permission;

import com.google.gson.JsonObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Stores remembered permission decisions at tool and tool+input granularity.
 */
class PermissionDecisionStore {

    private final Map<String, Integer> parameterDecisionMemory = new ConcurrentHashMap<>();
    private final Map<String, Boolean> toolDecisionMemory = new ConcurrentHashMap<>();

    PermissionService.PermissionResponse getToolDecision(String toolName) {
        Boolean allow = toolDecisionMemory.get(toolName);
        if (allow == null) {
            return null;
        }
        return allow
                ? PermissionService.PermissionResponse.ALLOW_ALWAYS
                : PermissionService.PermissionResponse.DENY;
    }

    /**
     * Command-execution tools (Bash; Codex shell commands also map to "Bash"; plus Agent
     * launches) whose parameter-level memory key is built from the command string alone.
     * See buildMemoryKey.
     */
    static boolean isCommandExecutionTool(String toolName) {
        return "Bash".equals(toolName) || "Agent".equals(toolName);
    }

    PermissionService.PermissionResponse getParameterDecision(String toolName, JsonObject inputs) {
        Integer remembered = parameterDecisionMemory.get(buildMemoryKey(toolName, inputs));
        if (remembered == null) {
            return null;
        }
        return PermissionService.PermissionResponse.fromValue(remembered);
    }

    String buildMemoryKey(String toolName, JsonObject inputs) {
        // For command-execution tools, key only on the command string. The rest of the input
        // (e.g. Bash "description", which the model regenerates every call) is volatile and
        // would otherwise make a remembered command-level decision almost never match on the
        // next, differently-described invocation of the very same command.
        if (isCommandExecutionTool(toolName) && inputs != null
                && inputs.has("command") && inputs.get("command").isJsonPrimitive()) {
            return toolName + ":cmd:" + inputs.get("command").getAsString();
        }
        return toolName + ":" + (inputs != null ? inputs.toString() : "null");
    }

    void rememberToolDecision(String toolName, PermissionService.PermissionResponse decision) {
        if (toolName == null || decision == null) {
            return;
        }
        if (decision == PermissionService.PermissionResponse.ALLOW_ALWAYS) {
            toolDecisionMemory.put(toolName, true);
        } else if (decision == PermissionService.PermissionResponse.DENY) {
            toolDecisionMemory.put(toolName, false);
        }
    }

    void rememberParameterDecision(String toolName, JsonObject inputs, PermissionService.PermissionResponse decision) {
        if (toolName == null || decision == null) {
            return;
        }
        parameterDecisionMemory.put(buildMemoryKey(toolName, inputs), decision.getValue());
    }

    void clear() {
        parameterDecisionMemory.clear();
        toolDecisionMemory.clear();
    }

    int getParameterMemorySize() {
        return parameterDecisionMemory.size();
    }

    int getToolMemorySize() {
        return toolDecisionMemory.size();
    }
}
