package com.qwenmate.provider.common;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import com.qwenmate.bridge.BridgeDirectoryResolver;
import com.qwenmate.bridge.EnvironmentConfigurator;
import com.qwenmate.model.NodeDetectionResult;
import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.bridge.ProcessManager;
import com.qwenmate.startup.BridgePreloader;
import com.qwenmate.util.PlatformUtils;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Base SDK bridge class.
 * Contains common logic shared by the provider SDK bridges.
 */
public abstract class BaseSDKBridge {

    protected static final String CHANNEL_SCRIPT = "channel-manager.js";
    private static final long ENVIRONMENT_CHECK_TIMEOUT_SECONDS = 5L;

    protected final Logger LOG;
    protected final Gson gson = new Gson();
    /**
     * Shared NodeDetector instance (singleton pattern).
     * This ensures that the SDK bridge subclasses share the same cache,
     * avoiding redundant Node.js path detections across modes.
     */
    protected final NodeDetector nodeDetector = NodeDetector.getInstance();
    protected final ProcessManager processManager = new ProcessManager();
    protected final EnvironmentConfigurator envConfigurator = new EnvironmentConfigurator();

    /**
     * Get the shared BridgeDirectoryResolver from BridgePreloader.
     * This ensures consistent extraction state across all components.
     */
    protected BridgeDirectoryResolver getDirectoryResolver() {
        return BridgePreloader.getSharedResolver();
    }

    protected BaseSDKBridge(Class<?> loggerClass) {
        this.LOG = Logger.getInstance(loggerClass);
        // Inject IntelliJ's managed executor into NodeDetector for in-flight detection tasks.
        this.nodeDetector.setDetectionExecutor(AppExecutorUtil.getAppExecutorService());
    }

    // ============================================================================
    // Abstract methods - to be implemented by subclasses
    // ============================================================================

    /**
     * Get the provider name (e.g., "qwen").
     */
    protected abstract String getProviderName();

    /**
     * Configure provider-specific environment variables.
     *
     * @param env       Environment map
     * @param stdinJson The JSON input that will be sent via stdin
     */
    protected abstract void configureProviderEnv(Map<String, String> env, String stdinJson);

    /**
     * Process a single line of output from the Node.js process.
     *
     * @param line             The output line
     * @param callback         Message callback
     * @param result           SDK result being built
     * @param assistantContent StringBuilder for accumulating assistant content
     * @param hadSendError     Flag indicating if send error occurred
     * @param lastNodeError    Holder for the last Node.js error
     */
    protected abstract void processOutputLine(
            String line,
            MessageCallback callback,
            SDKResult result,
            StringBuilder assistantContent,
            AtomicBoolean hadSendError,
            AtomicReference<String> lastNodeError
    );

    // ============================================================================
    // Process management methods (common)
    // ============================================================================

    /**
     * Clean up all active child processes.
     */
    public void cleanupAllProcesses() {
        processManager.cleanupAllProcesses();
    }

    /**
     * Get the count of active processes.
     */
    public int getActiveProcessCount() {
        return processManager.getActiveProcessCount();
    }

    /**
     * Expose this bridge's ProcessManager for inspection by NodeProcessRegistry.
     * Callers must treat the returned manager as read-only — do not register/unregister
     * processes through this reference; use the bridge's normal API instead.
     */
    public ProcessManager getProcessManager() {
        return processManager;
    }

    /**
     * Get the session ID for this bridge instance.
     * @return Session ID
     */
    public String getSessionId() {
        return envConfigurator.getSessionId();
    }

    /**
     * Sets the current bridge session ID for permission service routing alignment.
     */
    public void setSessionId(String sessionId) {
        envConfigurator.setSessionId(sessionId);
    }

    /**
     * Interrupt a channel.
     */
    public void interruptChannel(String channelId) {
        processManager.interruptChannel(channelId);
    }

    // ============================================================================
    // Node.js detection methods (common)
    // ============================================================================

    /**
     * Set Node.js executable path manually.
     */
    public void setNodeExecutable(String path) {
        nodeDetector.setNodeExecutable(path);
    }

    /**
     * Get the current Node.js executable path.
     */
    public String getNodeExecutable() {
        return nodeDetector.getNodeExecutable();
    }

    /**
     * Detect Node.js and return detailed results.
     */
    public NodeDetectionResult detectNodeWithDetails() {
        return nodeDetector.detectNodeWithDetails();
    }

    /**
     * Get cached Node.js version.
     */
    public String getCachedNodeVersion() {
        return nodeDetector.getCachedNodeVersion();
    }

    /**
     * Get cached Node.js path.
     */
    public String getCachedNodePath() {
        return nodeDetector.getCachedNodePath();
    }

    /**
     * Verify and cache Node.js path.
     */
    public NodeDetectionResult verifyAndCacheNodePath(String path) {
        return nodeDetector.verifyAndCacheNodePath(path);
    }

    // ============================================================================
    // Bridge directory methods (common)
    // ============================================================================

    /**
     * Set the bridge directory path manually.
     */
    public void setSdkTestDir(String path) {
        getDirectoryResolver().setSdkDir(path);
    }

    /**
     * Get the current bridge directory.
     */
    public File getSdkTestDir() {
        return getDirectoryResolver().getSdkDir();
    }

    // ============================================================================
    // MCP query methods (common)
    // ============================================================================

    /** Output marker emitted by ai-bridge for MCP status payloads. */
    private static final String MCP_STATUS_MARKER = "[MCP_SERVER_STATUS]";
    /** Output marker emitted by ai-bridge for MCP tool-list payloads. */
    private static final String MCP_TOOLS_MARKER = "[MCP_SERVER_TOOLS]";
    private static final String MCP_STATUS_CHANNEL_ID = "__mcp_status__";
    private static final String MCP_TOOLS_CHANNEL_ID = "__mcp_tools__";
    /** Upper bound for one MCP probe round (probing servers can be slow). */
    private static final long MCP_QUERY_TIMEOUT_SECONDS = 65L;

    /**
     * Get MCP server status for the given working directory.
     *
     * <p>Routes {@code qwen.getMcpServerStatus} through the warm daemon when one
     * is available and falls back to a one-shot channel-manager.js process
     * otherwise. Any failure degrades to an empty list — the MCP settings UI
     * renders empty state instead of an error popup.
     */
    public CompletableFuture<List<JsonObject>> getMcpServerStatus(String cwd) {
        return getMcpServerStatus(cwd, null);
    }

    /**
     * Get MCP server status via the given daemon (nullable).
     *
     * @param daemon the provider's daemon bridge, or null to use the
     *               per-process fallback directly
     */
    public CompletableFuture<List<JsonObject>> getMcpServerStatus(String cwd, DaemonBridge daemon) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                JsonObject params = new JsonObject();
                params.addProperty("cwd", cwd != null ? cwd : "");
                List<String> lines = queryMcpBridge(
                        "getMcpServerStatus", params, MCP_STATUS_MARKER, MCP_STATUS_CHANNEL_ID, daemon);
                List<JsonObject> servers = parseMcpStatusLines(lines);
                LOG.info("[McpStatus] Received " + servers.size() + " MCP server statuses, cwd=" + cwd);
                return servers;
            } catch (Exception e) {
                LOG.warn("[McpStatus] MCP status query failed, degrading to empty list: " + e.getMessage());
                return new ArrayList<>();
            }
        });
    }

    /**
     * Get the tool list of a specific MCP server.
     */
    public CompletableFuture<JsonObject> getMcpServerTools(String serverId) {
        return getMcpServerTools(serverId, null);
    }

    /**
     * Get the tool list of a specific MCP server for the given working directory.
     */
    public CompletableFuture<JsonObject> getMcpServerTools(String serverId, String cwd) {
        return getMcpServerTools(serverId, cwd, null);
    }

    /**
     * Get the tool list of a specific MCP server via the given daemon (nullable).
     * Failures degrade to an error payload with an empty tool list so the
     * webview renders empty state instead of hanging.
     */
    public CompletableFuture<JsonObject> getMcpServerTools(String serverId, String cwd, DaemonBridge daemon) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                JsonObject params = new JsonObject();
                params.addProperty("serverId", serverId != null ? serverId : "");
                if (cwd != null && !cwd.isEmpty()) {
                    params.addProperty("cwd", cwd);
                }
                List<String> lines = queryMcpBridge(
                        "getMcpServerTools", params, MCP_TOOLS_MARKER, MCP_TOOLS_CHANNEL_ID, daemon);
                JsonObject result = parseMcpToolsLines(lines, serverId);
                LOG.info("[McpTools] Tools result for " + serverId + ": "
                        + (result.has("tools") ? result.getAsJsonArray("tools").size() : 0) + " tool(s)");
                return result;
            } catch (Exception e) {
                LOG.warn("[McpTools] MCP tools query failed, degrading to empty tool list: " + e.getMessage());
                JsonObject errorResult = new JsonObject();
                errorResult.addProperty("serverId", serverId);
                errorResult.addProperty("error", e.getMessage() != null ? e.getMessage() : "MCP tools query failed");
                errorResult.add("tools", new JsonArray());
                return errorResult;
            }
        });
    }

    /**
     * Route one MCP query to the ai-bridge.
     * <p>
     * Prefers the warm daemon ({@code qwen.getMcpServerStatus} /
     * {@code qwen.getMcpServerTools} NDJSON commands) and falls back to a
     * one-shot {@code channel-manager.js} process when no daemon is usable.
     *
     * @return the raw output lines produced by the bridge
     */
    private List<String> queryMcpBridge(
            String action,
            JsonObject params,
            String marker,
            String channelId,
            DaemonBridge daemon
    ) {
        // 1) Warm daemon path
        DaemonBridge target = daemon;
        if (target != null && !target.isAlive()) {
            // Idle-retired daemons can be revived; anything else falls back.
            target = target.ensureRunning() ? target : null;
        }
        if (target != null) {
            try {
                return queryViaDaemon(target, action, params);
            } catch (Exception e) {
                LOG.warn("[McpQuery] daemon query failed (" + action + "), falling back to per-process: "
                        + e.getMessage());
            }
        }

        // 2) Per-process channel-manager.js path
        return queryViaChannelProcess(action, params, marker, channelId);
    }

    /**
     * Send {@code qwen.<action>} to the daemon and collect its output lines.
     */
    private List<String> queryViaDaemon(DaemonBridge daemon, String action, JsonObject params) throws Exception {
        List<String> lines = Collections.synchronizedList(new ArrayList<>());
        AtomicReference<String> errorRef = new AtomicReference<>(null);

        CompletableFuture<Boolean> cmdFuture = daemon.sendCommand(
                "qwen." + action,
                params,
                new DaemonBridge.DaemonOutputCallback() {
                    @Override
                    public void onLine(String line) {
                        if (line != null && !line.isEmpty()) {
                            lines.add(line);
                        }
                    }

                    @Override
                    public void onStderr(String text) {
                        LOG.debug("[McpQuery:stderr] " + text);
                    }

                    @Override
                    public void onError(String error) {
                        errorRef.set(error);
                    }

                    @Override
                    public void onComplete(boolean success) {
                        // Completion is observed through the command future.
                    }
                });

        Boolean success = cmdFuture.get(MCP_QUERY_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        List<String> collected = new ArrayList<>(lines);
        if ((success == null || !success) && collected.isEmpty()) {
            throw new IllegalStateException(
                    errorRef.get() != null ? errorRef.get() : ("qwen." + action + " command failed"));
        }
        return collected;
    }

    /**
     * Run a one-shot {@code channel-manager.js <provider> <action>} query and
     * collect its output lines up to the marker payload (or timeout).
     */
    private List<String> queryViaChannelProcess(
            String action,
            JsonObject params,
            String marker,
            String channelId
    ) {
        List<String> lines = Collections.synchronizedList(new ArrayList<>());
        Process process = null;
        try {
            List<String> command = buildBaseCommand(action);
            if (command.isEmpty()) {
                LOG.warn("[McpQuery] Cannot build bridge command for " + action);
                return new ArrayList<>();
            }

            File bridgeDir = getDirectoryResolver().findSdkDir();
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.directory(bridgeDir);
            pb.redirectErrorStream(true);
            String node = nodeDetector.findNodeExecutable();
            envConfigurator.updateProcessEnvironment(pb, node);
            pb.environment().put("QWEN_MATE_USE_STDIN", "true");

            LOG.info("[" + getProviderName() + "] MCP query command: " + String.join(" ", command));
            process = pb.start();
            processManager.registerProcess(channelId, process);
            final Process running = process;

            try (OutputStream stdin = running.getOutputStream()) {
                stdin.write(params.toString().getBytes(StandardCharsets.UTF_8));
                stdin.flush();
            } catch (Exception e) {
                LOG.warn("[McpQuery] Failed to write stdin: " + e.getMessage());
            }

            // Read on a helper thread so a hung child cannot block forever.
            CountDownLatch done = new CountDownLatch(1);
            Thread readerThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(running.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        lines.add(line);
                        if (line.startsWith(marker)) {
                            break;
                        }
                    }
                } catch (Exception e) {
                    LOG.debug("[McpQuery] Reader thread exception: " + e.getMessage());
                } finally {
                    done.countDown();
                }
            }, "mcp-query-reader");
            readerThread.setDaemon(true);
            readerThread.start();

            done.await(MCP_QUERY_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (running.isAlive()) {
                PlatformUtils.terminateProcess(running);
            }
            readerThread.join(2000);
            return new ArrayList<>(lines);
        } catch (Exception e) {
            LOG.warn("[McpQuery] per-process query failed (" + action + "): " + e.getMessage());
            return new ArrayList<>(lines);
        } finally {
            if (process != null) {
                try {
                    if (process.isAlive()) {
                        PlatformUtils.terminateProcess(process);
                    }
                } finally {
                    processManager.unregisterProcess(channelId, process);
                }
            }
        }
    }

    /**
     * Parse the MCP status payload out of bridge output lines.
     * Preferred: the {@code [MCP_SERVER_STATUS]} marker line. Fallback: the
     * last plain JSON envelope carrying a {@code status}/{@code servers} array.
     * Unparseable output yields an empty list (graceful degradation).
     */
    static List<JsonObject> parseMcpStatusLines(List<String> lines) {
        if (lines == null) {
            return new ArrayList<>();
        }

        for (String line : lines) {
            if (line != null && line.startsWith(MCP_STATUS_MARKER)) {
                List<JsonObject> parsed = toJsonObjectList(line.substring(MCP_STATUS_MARKER.length()).trim());
                if (parsed != null) {
                    return parsed;
                }
            }
        }

        for (int i = lines.size() - 1; i >= 0; i--) {
            String line = lines.get(i);
            if (line == null || !line.trim().startsWith("{")) {
                continue;
            }
            try {
                JsonObject obj = JsonParser.parseString(line).getAsJsonObject();
                for (String key : new String[]{"status", "servers"}) {
                    if (obj.has(key) && obj.get(key).isJsonArray()) {
                        List<JsonObject> parsed = toJsonObjectList(obj.get(key).toString());
                        if (parsed != null) {
                            return parsed;
                        }
                    }
                }
            } catch (Exception ignored) {
                // Not the envelope we are looking for — keep scanning.
            }
        }

        return new ArrayList<>();
    }

    /**
     * Parse the MCP tools payload out of bridge output lines.
     * Preferred: the {@code [MCP_SERVER_TOOLS]} marker line. Fallback: the last
     * plain JSON envelope with a {@code tools} array / {@code success} flag.
     * Always returns a webview-shaped payload (serverId + tools).
     */
    static JsonObject parseMcpToolsLines(List<String> lines, String serverId) {
        if (lines != null) {
            for (String line : lines) {
                if (line != null && line.startsWith(MCP_TOOLS_MARKER)) {
                    try {
                        JsonObject payload = JsonParser.parseString(
                                line.substring(MCP_TOOLS_MARKER.length()).trim()).getAsJsonObject();
                        normalizeToolsPayload(payload, serverId);
                        return payload;
                    } catch (Exception ignored) {
                        // Try the next candidate.
                    }
                }
            }

            for (int i = lines.size() - 1; i >= 0; i--) {
                String line = lines.get(i);
                if (line == null || !line.trim().startsWith("{")) {
                    continue;
                }
                try {
                    JsonObject payload = JsonParser.parseString(line).getAsJsonObject();
                    if (payload.has("tools") || payload.has("success")) {
                        normalizeToolsPayload(payload, serverId);
                        return payload;
                    }
                } catch (Exception ignored) {
                    // Not the envelope we are looking for — keep scanning.
                }
            }
        }

        JsonObject errorResult = new JsonObject();
        errorResult.addProperty("serverId", serverId);
        errorResult.addProperty("error", "Failed to get tools list");
        errorResult.add("tools", new JsonArray());
        return errorResult;
    }

    private static void normalizeToolsPayload(JsonObject payload, String serverId) {
        if (!payload.has("serverId") || payload.get("serverId").isJsonNull()) {
            payload.addProperty("serverId", serverId);
        }
        if (!payload.has("tools") || !payload.get("tools").isJsonArray()) {
            payload.add("tools", new JsonArray());
        }
    }

    private static List<JsonObject> toJsonObjectList(String json) {
        try {
            JsonElement parsed = JsonParser.parseString(json);
            if (parsed == null || !parsed.isJsonArray()) {
                return null;
            }
            List<JsonObject> result = new ArrayList<>();
            for (JsonElement elem : parsed.getAsJsonArray()) {
                if (elem.isJsonObject()) {
                    result.add(elem.getAsJsonObject());
                }
            }
            return result;
        } catch (Exception e) {
            return null;
        }
    }

    // ============================================================================
    // Channel management (common)
    // ============================================================================

    /**
     * Launch a new channel (auto-launch on first send).
     */
    public JsonObject launchChannel(String channelId, String sessionId, String cwd) {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        if (sessionId != null) {
            result.addProperty("sessionId", sessionId);
        }
        result.addProperty("channelId", channelId);
        result.addProperty("message", getProviderName() + " channel ready (auto-launch on first send)");
        return result;
    }

    // ============================================================================
    // Environment check (common)
    // ============================================================================

    /**
     * Check if the environment is ready.
     */
    public boolean checkEnvironment() {
        Process process = null;
        try {
            String node = nodeDetector.findNodeExecutable();
            List<String> versionCmd = NodeDetector.buildNodeScriptCommand(node, "--version");
            ProcessBuilder pb = new ProcessBuilder(versionCmd);
            envConfigurator.updateProcessEnvironment(pb, node);
            process = pb.start();

            boolean finished = process.waitFor(
                    ENVIRONMENT_CHECK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                LOG.warn("Node.js environment check timed out; terminating probe process");
                process.destroyForcibly();
                return false;
            }

            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String version = reader.readLine();
                LOG.debug("Node.js version: " + version);
            }

            if (process.exitValue() != 0) {
                return false;
            }

            // Check bridge directory
            File bridgeDir = getDirectoryResolver().findSdkDir();
            if (bridgeDir == null) {
                // Bridge extraction is in progress (background initialization scenario)
                LOG.info("Bridge directory not ready yet (extraction in progress)");
                return false;
            }

            File scriptFile = new File(bridgeDir, CHANNEL_SCRIPT);
            if (!scriptFile.exists()) {
                LOG.error("channel-manager.js not found at: " + scriptFile.getAbsolutePath());
                return false;
            }

            LOG.info("Environment check passed for " + getProviderName());
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOG.warn("Environment check was interrupted");
            return false;
        } catch (Exception e) {
            LOG.warn("Environment check failed: " + e.getMessage());
            return false;
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    // ============================================================================
    // Common message sending infrastructure
    // ============================================================================

    /**
     * Execute a command and process streaming output.
     * This is the core method that handles process lifecycle.
     *
     * @param channelId Channel identifier
     * @param command   Command arguments (node script provider action)
     * @param stdinJson JSON to write to stdin
     * @param cwd       Working directory
     * @param callback  Message callback
     * @return CompletableFuture with the result
     */
    protected CompletableFuture<SDKResult> executeStreamingCommand(
            String channelId,
            List<String> command,
            String stdinJson,
            String cwd,
            MessageCallback callback
    ) {
        return CompletableFuture.supplyAsync(() -> {
            SDKResult result = new SDKResult();
            StringBuilder assistantContent = new StringBuilder();
            AtomicBoolean hadSendError = new AtomicBoolean(false);
            AtomicReference<String> lastNodeError = new AtomicReference<>(null);

            try {
                File bridgeDir = getDirectoryResolver().findSdkDir();
                if (bridgeDir == null) {
                    // Bridge extraction is in progress
                    result.success = false;
                    result.error = "Bridge directory not ready yet (extraction in progress)";
                    callback.onError(result.error);
                    return result;
                }

                File processTempDir = processManager.prepareProcessTempDir();

                ProcessBuilder pb = new ProcessBuilder(command);

                // Set working directory
                if (cwd != null && !cwd.isEmpty() && !"undefined".equals(cwd) && !"null".equals(cwd)) {
                    File userWorkDir = new File(cwd);
                    if (userWorkDir.exists() && userWorkDir.isDirectory()) {
                        pb.directory(userWorkDir);
                    } else {
                        pb.directory(bridgeDir);
                    }
                } else {
                    pb.directory(bridgeDir);
                }

                // Configure environment
                Map<String, String> env = pb.environment();
                envConfigurator.configureTempDir(env, processTempDir);
                configureProviderEnv(env, stdinJson);

                pb.redirectErrorStream(true);
                String node = nodeDetector.findNodeExecutable();
                envConfigurator.updateProcessEnvironment(pb, node);

                LOG.info("[" + getProviderName() + "] Command: " + String.join(" ", command));

                Process process = null;
                try {
                    process = pb.start();
                    processManager.registerProcess(channelId, process);

                    // Write to stdin
                    try (OutputStream stdin = process.getOutputStream()) {
                        stdin.write(stdinJson.getBytes(StandardCharsets.UTF_8));
                        stdin.flush();
                    } catch (Exception e) {
                        LOG.warn("Failed to write stdin: " + e.getMessage());
                    }

                    // Read output
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {

                        String line;
                        while ((line = reader.readLine()) != null) {

                            // Capture Node.js error logs
                            if (line.startsWith("[UNCAUGHT_ERROR]")
                                    || line.startsWith("[UNHANDLED_REJECTION]")
                                    || line.startsWith("[COMMAND_ERROR]")
                                    || line.startsWith("[STARTUP_ERROR]")
                                    || line.startsWith("[ERROR]")) {
                                LOG.warn("[Node.js ERROR] " + line);
                                lastNodeError.set(line);
                            }

                            // Delegate to subclass for provider-specific processing
                            processOutputLine(line, callback, result, assistantContent, hadSendError, lastNodeError);
                        }
                    }

                    process.waitFor();

                    int exitCode = process.exitValue();
                    boolean wasInterrupted = processManager.wasInterrupted(channelId);

                    result.finalResult = assistantContent.toString();
                    result.messageCount = result.messages.size();

                    if (wasInterrupted) {
                        result.success = false;
                        result.error = "User interrupted";
                        callback.onComplete(result);
                    } else if (!hadSendError.get()) {
                        result.success = exitCode == 0;
                        if (result.success) {
                            callback.onComplete(result);
                        } else {
                            String errorMsg = getProviderName() + " process exited with code: " + exitCode;
                            String nodeErr = lastNodeError.get();
                            if (nodeErr != null && !nodeErr.isEmpty()) {
                                errorMsg = errorMsg + "\n\nDetails: " + nodeErr;
                            }
                            result.error = errorMsg;
                            callback.onError(errorMsg);
                        }
                    } else {
                        // Send phase already handled the error, no need to append recent output
                        if (exitCode != 0 && result.error != null) {
                            callback.onError(result.error);
                        }
                    }

                    return result;
                } finally {
                    processManager.unregisterProcess(channelId, process);
                    processManager.waitForProcessTermination(process);
                    // L9 fix: waitForProcessTermination only waits 5s and then gives
                    // up. If the SDK is stuck on a network read it can outlive that
                    // window — force-kill so the child does not become a long-lived
                    // orphan. Matches the cleanup guarantee in interruptChannel.
                    if (process.isAlive()) {
                        LOG.warn("[" + getProviderName() + "] process " + process.pid()
                                + " did not terminate within waitForProcessTermination window, force-killing");
                        PlatformUtils.terminateProcess(process);
                    }
                }

            } catch (Exception e) {
                result.success = false;
                result.error = e.getMessage();
                callback.onError(e.getMessage());
                return result;
            }
        }).exceptionally(ex -> {
            SDKResult errorResult = new SDKResult();
            errorResult.success = false;
            errorResult.error = ex.getCause() != null ? ex.getCause().getMessage() : ex.getMessage();
            callback.onError(errorResult.error);
            return errorResult;
        });
    }

    /**
     * Build the base command for invoking channel-manager.js.
     * When the node executable is a WSL path, prepends 'wsl' and converts
     * the script path to a WSL-accessible format.
     *
     * @param action The action to perform (e.g., "send", "sendWithAttachments")
     * @return Command list
     */
    protected List<String> buildBaseCommand(String action) {
        List<String> command = new ArrayList<>();
        try {
            String node = nodeDetector.findNodeExecutable();
            File bridgeDir = getDirectoryResolver().findSdkDir();
            if (bridgeDir == null) {
                LOG.warn("Bridge directory not ready yet (extraction in progress), cannot build command");
                return command;
            }

            String scriptPath = new File(bridgeDir, CHANNEL_SCRIPT).getAbsolutePath();
            command.addAll(NodeDetector.buildNodeScriptCommand(node, scriptPath));
            command.add(getProviderName());
            command.add(action);
        } catch (Exception e) {
            LOG.error("Failed to build command: " + e.getMessage());
        }
        return command;
    }
}
