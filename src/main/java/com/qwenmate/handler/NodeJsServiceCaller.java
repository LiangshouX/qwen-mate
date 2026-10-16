package com.qwenmate.handler;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.bridge.ProcessManager;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.util.PlatformUtils;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Handles Node.js subprocess calls for favorites and session titles services.
 * <p>
 * Extracted from HistoryHandler to encapsulate all Node.js process invocation logic
 * for favorites-service.cjs and session-titles-service.cjs.
 */
public class NodeJsServiceCaller {

    private static final int PROCESS_TIMEOUT_SECONDS = 30;

    private static final Set<String> ALLOWED_FAVORITES_FUNCTIONS = Set.of(
        "loadFavorites", "toggleFavorite"
    );

    private static final Set<String> ALLOWED_TITLES_FUNCTIONS = Set.of(
        "loadTitles", "updateTitle", "deleteTitle"
    );

    private final HandlerContext context;

    public NodeJsServiceCaller(HandlerContext context) {
        this.context = context;
    }

    /**
     * Call Node.js favorites-service.
     */
    public String callNodeJsFavoritesService(String functionName, String sessionId) throws Exception {
        validateFunctionName(functionName, ALLOWED_FAVORITES_FUNCTIONS);

        String bridgePath = context.getQwenSDKBridge().getSdkTestDir().getAbsolutePath();
        String nodePath = context.getQwenSDKBridge().getNodeExecutable();
        String servicePath = resolveServicePath(nodePath, bridgePath, "favorites-service.cjs");

        String nodeScript = String.format(
            "const { %s } = require(process.argv[1]); " +
            "const result = %s(process.env.SESSION_ID); " +
            "console.log(JSON.stringify(result));",
            functionName,
            functionName
        );

        ProcessBuilder pb = buildNodeProcessBuilder(nodePath, nodeScript, servicePath);
        pb.redirectErrorStream(true);
        pb.environment().put("SESSION_ID", sessionId);

        return executeNodeScript(pb);
    }

    /**
     * Call Node.js session-titles-service (no-argument version, for loadTitles).
     */
    public String callNodeJsTitlesService(String functionName) throws Exception {
        validateFunctionName(functionName, ALLOWED_TITLES_FUNCTIONS);

        String bridgePath = context.getQwenSDKBridge().getSdkTestDir().getAbsolutePath();
        String nodePath = context.getQwenSDKBridge().getNodeExecutable();
        String servicePath = resolveServicePath(nodePath, bridgePath, "session-titles-service.cjs");

        String nodeScript = String.format(
            "const { %s } = require(process.argv[1]); " +
            "const result = %s(); " +
            "console.log(JSON.stringify(result));",
            functionName,
            functionName
        );

        ProcessBuilder pb = buildNodeProcessBuilder(nodePath, nodeScript, servicePath);
        pb.redirectErrorStream(true);

        return executeNodeScript(pb);
    }

    /**
     * Call Node.js session-titles-service (with parameters, for updateTitle).
     */
    public String callNodeJsTitlesServiceWithParams(String functionName, String sessionId, String customTitle) throws Exception {
        validateFunctionName(functionName, ALLOWED_TITLES_FUNCTIONS);

        String bridgePath = context.getQwenSDKBridge().getSdkTestDir().getAbsolutePath();
        String nodePath = context.getQwenSDKBridge().getNodeExecutable();
        String servicePath = resolveServicePath(nodePath, bridgePath, "session-titles-service.cjs");

        String nodeScript = String.format(
            "const { %s } = require(process.argv[1]); " +
            "const result = %s(process.env.SESSION_ID, process.env.CUSTOM_TITLE); " +
            "console.log(JSON.stringify(result));",
            functionName,
            functionName
        );

        ProcessBuilder pb = buildNodeProcessBuilder(nodePath, nodeScript, servicePath);
        pb.redirectErrorStream(true);
        pb.environment().put("SESSION_ID", sessionId);
        pb.environment().put("CUSTOM_TITLE", customTitle);

        return executeNodeScript(pb);
    }

    /**
     * Call Node.js session-titles-service to delete a title (single parameter version).
     */
    public String callNodeJsDeleteTitle(String sessionId) throws Exception {
        String bridgePath = context.getQwenSDKBridge().getSdkTestDir().getAbsolutePath();
        String nodePath = context.getQwenSDKBridge().getNodeExecutable();
        String servicePath = resolveServicePath(nodePath, bridgePath, "session-titles-service.cjs");

        String nodeScript =
            "const { deleteTitle } = require(process.argv[1]); " +
            "const result = deleteTitle(process.env.SESSION_ID); " +
            "console.log(JSON.stringify({ success: result }));";

        ProcessBuilder pb = buildNodeProcessBuilder(nodePath, nodeScript, servicePath);
        pb.redirectErrorStream(true);
        pb.environment().put("SESSION_ID", sessionId);

        return executeNodeScript(pb);
    }

    /**
     * Build a ProcessBuilder for running a Node.js inline script.
     * Delegates to {@link NodeDetector#buildNodeInlineCommand} so WSL prefixing is centralised.
     */
    private ProcessBuilder buildNodeProcessBuilder(String nodePath, String nodeScript, String servicePath) {
        List<String> command = NodeDetector.buildNodeInlineCommand(nodePath, nodeScript);
        command.add(servicePath);
        return new ProcessBuilder(command);
    }

    static String resolveServicePath(String nodePath, String bridgePath, String serviceFileName) {
        String servicePath = bridgePath + "/services/" + serviceFileName;
        return NodeDetector.isWslPath(nodePath) ? NodeDetector.convertToWslPath(servicePath) : servicePath;
    }

    /**
     * Validate that the function name is in the allowed set to prevent injection.
     */
    private void validateFunctionName(String functionName, Set<String> allowedFunctions) {
        if (functionName == null || !allowedFunctions.contains(functionName)) {
            throw new IllegalArgumentException(
                "Invalid function name: " + functionName + ". Allowed: " + allowedFunctions
            );
        }
    }

    /**
     * Execute a Node.js script via ProcessBuilder, read its output, enforce a timeout,
     * and return the last line of stdout (expected to be JSON).
     */
    private String executeNodeScript(ProcessBuilder pb) throws Exception {
        // L8 fix: register with ProcessManager so cleanupAllProcesses sees this child.
        ProcessManager processManager = context.getQwenSDKBridge().getProcessManager();
        String channelId = ProcessManager.newChannelId("node-service");
        Process process = null;
        try {
            process = pb.start();
            processManager.registerProcess(channelId, process);

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }

            boolean finished = process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                PlatformUtils.terminateProcess(process);
                throw new Exception("Node.js process timed out after " + PROCESS_TIMEOUT_SECONDS + " seconds");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                throw new Exception("Node.js process exited with code " + exitCode + ": " + output);
            }

            String[] lines = output.toString().split("\n");
            return lines.length > 0 ? lines[lines.length - 1] : "{}";
        } finally {
            if (process != null) {
                if (process.isAlive()) {
                    PlatformUtils.terminateProcess(process);
                }
                processManager.unregisterProcess(channelId, process);
            }
        }
    }

    /**
     * Run one provider-config operation in the settings-writer Node service
     * (services/settings-writer-service.cjs). The payload travels over stdin
     * so API keys never land in argv or the process environment — only the
     * (secret-free) settings file paths go through env vars.
     *
     * @return the service's JSON result line ({ok, op, snapshot} / {ok:false, code, message})
     */
    public String callProviderConfigService(String settingsPath, String projectSettingsPath, String payloadJson) throws Exception {
        String bridgePath = context.getQwenSDKBridge().getSdkTestDir().getAbsolutePath();
        String nodePath = context.getQwenSDKBridge().getNodeExecutable();
        String servicePath = resolveServicePath(nodePath, bridgePath, "settings-writer-service.cjs");
        if (NodeDetector.isWslPath(nodePath)) {
            settingsPath = NodeDetector.convertToWslPath(settingsPath);
            if (projectSettingsPath != null && !projectSettingsPath.isEmpty()) {
                projectSettingsPath = NodeDetector.convertToWslPath(projectSettingsPath);
            }
        }
        String nodeScript =
            "let d = '';" +
            "process.stdin.setEncoding('utf8');" +
            "process.stdin.on('data', c => d += c);" +
            "process.stdin.on('end', () => {" +
            "  let r;" +
            "  try {" +
            "    const s = require(process.argv[1]);" +
            "    r = s.runProviderConfigOp(process.env.QWM_SETTINGS_PATH || '', process.env.QWM_PROJECT_SETTINGS_PATH || '', d);" +
            "  } catch (e) {" +
            "    r = { ok: false, code: 'internal_error', message: String((e && e.message) || e) };" +
            "  }" +
            "  process.stdout.write('\\n' + JSON.stringify(r));" +
            "});";

        ProcessBuilder pb = buildNodeProcessBuilder(nodePath, nodeScript, servicePath);
        pb.redirectErrorStream(true);
        pb.environment().put("QWM_SETTINGS_PATH", settingsPath == null ? "" : settingsPath);
        pb.environment().put("QWM_PROJECT_SETTINGS_PATH", projectSettingsPath == null ? "" : projectSettingsPath);
        return executeNodeScriptWithStdin(pb, payloadJson == null ? "" : payloadJson);
    }

    /**
     * Same as {@link #executeNodeScript} but feeds a UTF-8 payload to the
     * child's stdin before draining stdout. The child consumes stdin
     * continuously, so large payloads cannot deadlock against its output.
     */
    private String executeNodeScriptWithStdin(ProcessBuilder pb, String stdinPayload) throws Exception {
        ProcessManager processManager = context.getQwenSDKBridge().getProcessManager();
        String channelId = ProcessManager.newChannelId("node-service-stdin");
        Process process = null;
        try {
            process = pb.start();
            processManager.registerProcess(channelId, process);

            try (java.io.OutputStream stdin = process.getOutputStream()) {
                stdin.write(stdinPayload.getBytes(StandardCharsets.UTF_8));
                stdin.flush();
            }

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }

            boolean finished = process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                PlatformUtils.terminateProcess(process);
                throw new Exception("Node.js provider-config service timed out after " + PROCESS_TIMEOUT_SECONDS + " seconds");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                throw new Exception("Node.js provider-config service exited with code " + exitCode + ": " + output);
            }

            String[] lines = output.toString().split("\n");
            return lines.length > 0 ? lines[lines.length - 1] : "{}";
        } finally {
            if (process != null) {
                if (process.isAlive()) {
                    PlatformUtils.terminateProcess(process);
                }
                processManager.unregisterProcess(channelId, process);
            }
        }
    }
}
