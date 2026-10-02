package com.qwenmate.provider.qwen;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.provider.ModelProviderHandler;
import com.qwenmate.provider.common.BaseSDKBridge;
import com.qwenmate.provider.common.DaemonBridge;
import com.qwenmate.provider.common.MessageCallback;
import com.qwenmate.provider.common.SDKResult;
import com.qwenmate.session.QwenMateSession;
import com.qwenmate.settings.QwenMateSettingsService;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * Qwen Code SDK bridge (Claude-template architecture).
 *
 * Java contract mirrors {@code ClaudeSDKBridge} send shape:
 * session/epoch/cwd/attachments/permissionMode/model/openedFiles/agentPrompt/streaming/reasoning.
 *
 * Node transport is ACP primary ({@code qwen agent stdio}) which emits Claude-compatible tags.
 */
public class QwenSDKBridge extends BaseSDKBridge {

    private static final long DAEMON_RETRY_DELAY_MS = 60_000;

    private String baseUrl = null;
    private String apiKey = null;
    private final QwenMateSettingsService settingsService = new QwenMateSettingsService();

    private final QwenDaemonRequestExecutor daemonRequestExecutor;

    // Daemon lifecycle (mirrors GrokDaemonCoordinator, kept in-bridge for this provider).
    private volatile DaemonBridge daemonBridge;
    private final Object daemonLock = new Object();
    private volatile long daemonRetryAfter = 0;
    private volatile CompletableFuture<?> prewarmFuture;
    private volatile long lifecycleGeneration;
    private final List<DaemonBridge.DaemonEventListener> cachedEventListeners = new CopyOnWriteArrayList<>();

    /** Last observed token total from ACP [USAGE] for /context synthesis. */
    private final AtomicInteger lastUsedTokens = new AtomicInteger(0);
    private volatile String lastUsageModel = "";

    public QwenSDKBridge() {
        super(QwenSDKBridge.class);
        this.daemonRequestExecutor = new QwenDaemonRequestExecutor(LOG, this);
    }

    // ============================================================================
    // Abstract method implementations
    // ============================================================================

    @Override
    protected String getProviderName() {
        return "qwen";
    }

    @Override
    protected void configureProviderEnv(Map<String, String> env, String stdinJson) {
        env.put("QWEN_USE_STDIN", "true");
        env.put("QWEN_NO_AUTO_UPDATE", "1");
        env.put("CI", "1");

        String effectiveKey = resolveEffectiveApiKey();
        if (effectiveKey != null && !effectiveKey.isEmpty()) {
            env.put("QWEN_API_KEY", effectiveKey);
            env.put("OPENAI_API_KEY", effectiveKey);
            env.put("DASHSCOPE_API_KEY", effectiveKey);
        } else {
            env.remove("QWEN_API_KEY");
            env.remove("OPENAI_API_KEY");
            env.remove("DASHSCOPE_API_KEY");
        }

        String effectiveBase = resolveEffectiveBaseUrl();
        if (effectiveBase != null && !effectiveBase.isEmpty()) {
            env.put("QWEN_BASE_URL", effectiveBase);
            env.put("QWEN_API_BASE_URL", effectiveBase);
            env.put("OPENAI_BASE_URL", effectiveBase);
        }
    }

    /**
     * Resolve the API key: explicit bridge key (injected by the host) first, then the
     * stored {@code qwen.apiKey} setting, then well-known environment fallbacks.
     */
    private String resolveEffectiveApiKey() {
        if (apiKey != null && !apiKey.isEmpty()) {
            return apiKey;
        }
        try {
            String stored = settingsService.getQwenApiKey();
            if (stored != null && !stored.isEmpty()) {
                return stored;
            }
        } catch (Exception e) {
            LOG.debug("[Qwen] Failed to read stored qwen.apiKey: " + e.getMessage());
        }
        String envKey = System.getenv("QWEN_API_KEY");
        if (envKey == null || envKey.isEmpty()) {
            envKey = System.getenv("DASHSCOPE_API_KEY");
        }
        if (envKey == null || envKey.isEmpty()) {
            envKey = System.getenv("OPENAI_API_KEY");
        }
        return envKey != null ? envKey : "";
    }

    /**
     * Resolve the base URL: explicit bridge base (injected by the host) first, then the
     * stored {@code qwen.apiBaseUrl} setting, then well-known environment fallbacks.
     * Empty leaves the CLI defaults.
     */
    private String resolveEffectiveBaseUrl() {
        if (baseUrl != null && !baseUrl.isEmpty()) {
            return baseUrl;
        }
        try {
            String stored = settingsService.getQwenApiBaseUrl();
            if (stored != null && !stored.isEmpty()) {
                return stored;
            }
        } catch (Exception e) {
            LOG.debug("[Qwen] Failed to read stored qwen.apiBaseUrl: " + e.getMessage());
        }
        String envBase = System.getenv("QWEN_BASE_URL");
        if (envBase == null || envBase.isEmpty()) {
            envBase = System.getenv("OPENAI_BASE_URL");
        }
        return envBase != null ? envBase : "";
    }

    @Override
    protected void processOutputLine(
            String line,
            MessageCallback callback,
            SDKResult result,
            StringBuilder assistantContent,
            AtomicBoolean hadSendError,
            AtomicReference<String> lastNodeError
    ) {
        if (line.contains("[DEBUG]") || line.startsWith("[QWEN-ACP]") || line.startsWith("[DIAG-")) {
            LOG.debug("[Qwen] " + line);
            return;
        }

        if (line.startsWith("[STDIN_ERROR]")
                || line.startsWith("[STDIN_PARSE_ERROR]")
                || line.startsWith("[COMMAND_ERROR]")
                || line.startsWith("[UNCAUGHT_ERROR]")
                || line.startsWith("[UNHANDLED_REJECTION]")) {
            lastNodeError.set(line);
        }

        if (line.startsWith("[MESSAGE_START]")) {
            callback.onMessage("message_start", "");
            return;
        }
        if (line.startsWith("[MESSAGE_END]")) {
            callback.onMessage("message_end", "");
            return;
        }
        if (line.startsWith("[STREAM_START]")) {
            callback.onMessage("stream_start", "");
            return;
        }
        if (line.startsWith("[STREAM_END]")) {
            callback.onMessage("stream_end", "");
            return;
        }
        if (line.startsWith("[BLOCK_RESET]")) {
            callback.onMessage("block_reset", "");
            return;
        }
        if (line.startsWith("[SESSION_ID]")) {
            String id = line.substring("[SESSION_ID]".length()).trim();
            if (!id.isEmpty()) {
                callback.onMessage("session_id", id);
            }
            return;
        }
        if (line.startsWith("[MESSAGE]")) {
            String jsonStr = line.substring("[MESSAGE]".length()).trim();
            try {
                JsonObject msg = gson.fromJson(jsonStr, JsonObject.class);
                if (msg != null) {
                    result.messages.add(msg);
                    String msgType = msg.has("type") && !msg.get("type").isJsonNull()
                            ? msg.get("type").getAsString()
                            : "assistant";
                    callback.onMessage(msgType, jsonStr);

                    if ("assistant".equals(msgType)) {
                        String text = extractAssistantText(msg);
                        if (text != null && !text.isEmpty() && assistantContent.indexOf(text) < 0) {
                            // Prefer full message text when longer than deltas
                            if (text.length() >= assistantContent.length()) {
                                assistantContent.setLength(0);
                                assistantContent.append(text);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            return;
        }
        if (line.startsWith("[CONTENT_DELTA]")) {
            String delta = decodeJsonStringPayload(line.substring("[CONTENT_DELTA]".length()));
            assistantContent.append(delta);
            callback.onMessage("content_delta", delta);
            return;
        }
        if (line.startsWith("[CONTENT]")) {
            String content = line.substring("[CONTENT]".length()).trim();
            assistantContent.append(content);
            callback.onMessage("content", content);
            return;
        }
        if (line.startsWith("[THINKING_DELTA]")) {
            String delta = decodeJsonStringPayload(line.substring("[THINKING_DELTA]".length()));
            callback.onMessage("thinking_delta", delta);
            return;
        }
        if (line.startsWith("[THINKING]")) {
            callback.onMessage("thinking", line.substring("[THINKING]".length()).trim());
            return;
        }
        if (line.startsWith("[TOOL_RESULT]")) {
            callback.onMessage("tool_result", line.substring("[TOOL_RESULT]".length()).trim());
            return;
        }
        if (line.startsWith("[PERMISSION_REQUEST]")) {
            callback.onMessage("permission_request", line.substring("[PERMISSION_REQUEST]".length()).trim());
            return;
        }
        if (line.startsWith("[USAGE]")) {
            String usageJson = line.substring("[USAGE]".length()).trim();
            try {
                JsonObject usage = gson.fromJson(usageJson, JsonObject.class);
                // Canonical snake_case for Java consumers; camelCase ACP is fallback input.
                JsonObject canonical = normalizeUsageToSnakeCase(usage);
                if (canonical != null) {
                    usageJson = gson.toJson(canonical);
                    usage = canonical;
                }
                int used = extractUsedTokens(usage);
                if (used > 0) {
                    lastUsedTokens.set(used);
                }
            } catch (Exception ignored) {
            }
            callback.onMessage("usage", usageJson);
            return;
        }
        if (line.startsWith("[SEND_ERROR]")) {
            String jsonStr = line.substring("[SEND_ERROR]".length()).trim();
            String errorMessage = jsonStr;
            try {
                JsonObject obj = gson.fromJson(jsonStr, JsonObject.class);
                if (obj != null && obj.has("error")) {
                    errorMessage = obj.get("error").getAsString();
                }
            } catch (Exception ignored) {
            }
            hadSendError.set(true);
            result.success = false;
            result.error = errorMessage;
            callback.onError(errorMessage);
            return;
        }

        // Final JSON result line from Node (success envelope)
        if (line.startsWith("{") && line.contains("\"success\"")) {
            try {
                JsonObject obj = gson.fromJson(line, JsonObject.class);
                if (obj != null && obj.has("success") && !obj.get("success").getAsBoolean()) {
                    String err = obj.has("error") ? obj.get("error").getAsString() : line;
                    hadSendError.set(true);
                    result.success = false;
                    result.error = err;
                    callback.onError(err);
                } else if (obj != null && obj.has("sessionId") && !obj.get("sessionId").isJsonNull()) {
                    String sid = obj.get("sessionId").getAsString();
                    if (sid != null && !sid.isEmpty()) {
                        callback.onMessage("session_id", sid);
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    private String decodeJsonStringPayload(String rawPayload) {
        String jsonStr = rawPayload.startsWith(" ") ? rawPayload.substring(1) : rawPayload;
        try {
            String decoded = gson.fromJson(jsonStr, String.class);
            return decoded != null ? decoded : "";
        } catch (Exception e) {
            return jsonStr;
        }
    }

    private String extractAssistantText(JsonObject msg) {
        if (msg == null || !msg.has("message")) {
            return null;
        }
        try {
            JsonObject message = msg.getAsJsonObject("message");
            if (message == null || !message.has("content")) {
                return null;
            }
            JsonElement contentEl = message.get("content");
            if (contentEl.isJsonArray()) {
                StringBuilder sb = new StringBuilder();
                for (JsonElement el : contentEl.getAsJsonArray()) {
                    if (el.isJsonObject()) {
                        JsonObject block = el.getAsJsonObject();
                        if (block.has("text")) {
                            sb.append(block.get("text").getAsString());
                        }
                    }
                }
                return sb.toString();
            } else if (contentEl.isJsonPrimitive()) {
                return contentEl.getAsString();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    // ============================================================================
    // Usage normalization (OpenAI snake_case) + context-usage synthesis
    // ============================================================================

    /**
     * Normalize usage to OpenAI snake_case ({@code total_tokens}, {@code input_tokens}, …).
     * camelCase ACP input is mapped here as fallback.
     *
     * @return new object with snake_case keys, or null if no token fields found
     */
    public static JsonObject normalizeUsageToSnakeCase(JsonObject usage) {
        if (usage == null) {
            return null;
        }
        if (usage.has("usage") && usage.get("usage").isJsonObject()
                && firstPositiveInt(usage, "total_tokens", "totalTokens", "input_tokens", "inputTokens") <= 0) {
            JsonObject nested = normalizeUsageToSnakeCase(usage.getAsJsonObject("usage"));
            if (nested != null) {
                return nested;
            }
        }

        int total = firstPositiveInt(usage, "total_tokens", "totalTokens");
        int input = firstPositiveInt(usage, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
        int output = firstPositiveInt(usage, "output_tokens", "outputTokens", "completion_tokens", "completionTokens");
        int thought = firstPositiveInt(usage, "thought_tokens", "thoughtTokens", "reasoning_tokens", "reasoningTokens");
        int cachedWrite = firstPositiveInt(usage, "cached_write_tokens", "cachedWriteTokens");
        int cachedRead = firstPositiveInt(usage, "cached_read_tokens", "cachedReadTokens", "cached_tokens", "cachedTokens");

        if (total <= 0 && input <= 0 && output <= 0 && thought <= 0 && cachedWrite <= 0 && cachedRead <= 0) {
            return null;
        }

        JsonObject out = new JsonObject();
        if (input > 0) {
            out.addProperty("input_tokens", input);
        }
        if (output > 0) {
            out.addProperty("output_tokens", output);
        }
        if (thought > 0) {
            out.addProperty("thought_tokens", thought);
        }
        if (cachedWrite > 0) {
            out.addProperty("cached_write_tokens", cachedWrite);
        }
        if (cachedRead > 0) {
            out.addProperty("cached_read_tokens", cachedRead);
        }
        int resolvedTotal = total > 0 ? total : input + output + thought + cachedWrite + cachedRead;
        out.addProperty("total_tokens", resolvedTotal);
        return out;
    }

    /** Extract used-token total from a Qwen/ACP usage JSON object (dual-reads camelCase). */
    public static int extractUsedTokens(JsonObject usage) {
        if (usage == null) {
            return 0;
        }
        JsonObject normalized = normalizeUsageToSnakeCase(usage);
        if (normalized != null) {
            int total = firstPositiveInt(normalized, "total_tokens");
            if (total > 0) {
                return total;
            }
            int used = 0;
            used += firstPositiveInt(normalized, "input_tokens");
            used += firstPositiveInt(normalized, "output_tokens");
            used += firstPositiveInt(normalized, "thought_tokens");
            used += firstPositiveInt(normalized, "cached_write_tokens");
            used += firstPositiveInt(normalized, "cached_read_tokens");
            if (used > 0) {
                return used;
            }
        }
        int total = firstPositiveInt(usage, "total_tokens", "totalTokens");
        if (total > 0) {
            return total;
        }
        int used = 0;
        used += firstPositiveInt(usage, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
        used += firstPositiveInt(usage, "output_tokens", "outputTokens", "completion_tokens", "completionTokens");
        used += firstPositiveInt(usage, "thought_tokens", "thoughtTokens");
        used += firstPositiveInt(usage, "cached_write_tokens", "cachedWriteTokens");
        used += firstPositiveInt(usage, "cached_read_tokens", "cachedReadTokens");
        return Math.max(0, used);
    }

    /** First finite non-null number &gt; 0 among keys (or 0). Snake_case keys should be listed first. */
    static int firstPositiveInt(JsonObject obj, String... keys) {
        if (obj == null || keys == null) {
            return 0;
        }
        for (String key : keys) {
            if (key == null || !obj.has(key) || obj.get(key).isJsonNull()) {
                continue;
            }
            try {
                int n = obj.get(key).getAsInt();
                if (n > 0) {
                    return n;
                }
            } catch (Exception ignored) {
                // non-numeric
            }
        }
        return 0;
    }

    /**
     * Build a {@code ContextUsageData}-compatible payload. Qwen ACP only exposes aggregate
     * token usage, so we synthesize used conversation tokens + free space within the limit.
     */
    static JsonObject buildContextUsage(int usedTokens, int maxTokens, String model) {
        int used = Math.max(0, usedTokens);
        int max = Math.max(1, maxTokens);
        if (used > max) {
            used = max;
        }
        int free = Math.max(0, max - used);
        double percentage = (100.0 * used) / max;

        JsonObject root = new JsonObject();
        root.addProperty("success", true);
        root.addProperty("totalTokens", used);
        root.addProperty("maxTokens", max);
        root.addProperty("rawMaxTokens", max);
        root.addProperty("percentage", Math.round(percentage * 10.0) / 10.0);
        root.addProperty("model", model != null ? model : "");
        root.addProperty("isAutoCompactEnabled", false);
        root.addProperty("source", "qwen-synthesized");

        JsonArray categories = new JsonArray();
        JsonObject usedCat = new JsonObject();
        usedCat.addProperty("name", "Conversation");
        usedCat.addProperty("tokens", used);
        usedCat.addProperty("color", "claude");
        categories.add(usedCat);

        JsonObject freeCat = new JsonObject();
        freeCat.addProperty("name", "Free space");
        freeCat.addProperty("tokens", free);
        freeCat.addProperty("color", "inactive");
        categories.add(freeCat);
        root.add("categories", categories);

        JsonArray gridRows = new JsonArray();
        JsonArray row = new JsonArray();
        row.add(gridCell("claude", used > 0, "Conversation", used, percentage, used > 0 ? 1.0 : 0.0));
        double freePct = 100.0 - percentage;
        row.add(gridCell("inactive", false, "Free space", free, freePct, free > 0 ? Math.min(1.0, free / (double) max) : 0.0));
        gridRows.add(row);
        root.add("gridRows", gridRows);

        root.add("memoryFiles", new JsonArray());
        root.add("mcpTools", new JsonArray());
        root.add("agents", new JsonArray());

        return root;
    }

    private static JsonObject gridCell(
            String color,
            boolean isFilled,
            String categoryName,
            int tokens,
            double percentage,
            double squareFullness
    ) {
        JsonObject cell = new JsonObject();
        cell.addProperty("color", color);
        cell.addProperty("isFilled", isFilled);
        cell.addProperty("categoryName", categoryName);
        cell.addProperty("tokens", tokens);
        cell.addProperty("percentage", Math.round(percentage * 10.0) / 10.0);
        cell.addProperty("squareFullness", squareFullness);
        return cell;
    }

    // ============================================================================
    // Qwen-specific configuration
    // ============================================================================

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getBaseUrl() {
        return this.baseUrl;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getApiKey() {
        return this.apiKey;
    }

    // ============================================================================
    // Daemon lifecycle (parity with Claude)
    // ============================================================================

    public void addDaemonEventListener(DaemonBridge.DaemonEventListener listener) {
        if (listener == null) {
            return;
        }
        cachedEventListeners.add(listener);
        DaemonBridge current = daemonBridge;
        if (current != null && current.isAlive()) {
            current.addEventListener(listener);
        }
    }

    public void removeDaemonEventListener(DaemonBridge.DaemonEventListener listener) {
        if (listener == null) {
            return;
        }
        cachedEventListeners.remove(listener);
        DaemonBridge current = daemonBridge;
        if (current != null && current.isAlive()) {
            current.removeEventListener(listener);
        }
    }

    public void shutdownDaemon() {
        CompletableFuture<?> runningPrewarm;
        DaemonBridge current;
        synchronized (daemonLock) {
            lifecycleGeneration++;
            runningPrewarm = prewarmFuture;
            prewarmFuture = null;
            current = daemonBridge;
            daemonBridge = null;
            daemonRetryAfter = 0;
        }
        if (runningPrewarm != null) {
            runningPrewarm.cancel(true);
        }
        if (current != null) {
            current.stop();
        }
    }

    public DaemonBridge getCurrentDaemonBridgeForInspection() {
        return daemonBridge;
    }

    /** Non-spawning accessor: returns an already-running daemon (or null). */
    private DaemonBridge getCurrentDaemonBridge() {
        return daemonBridge;
    }

    /** Get-or-create the persistent Qwen daemon. Returns null when unavailable (caller falls back). */
    private DaemonBridge getDaemonBridge() {
        DaemonBridge current = daemonBridge;
        if (current != null && current.isAlive()) {
            return current;
        }
        if (System.currentTimeMillis() < daemonRetryAfter) {
            return null;
        }

        synchronized (daemonLock) {
            current = daemonBridge;
            if (current != null && current.isAlive()) {
                return current;
            }

            if (current != null && current.isIdleRetired()) {
                if (current.ensureRunning()) {
                    daemonRetryAfter = 0;
                    return current;
                }
                daemonRetryAfter = System.currentTimeMillis() + DAEMON_RETRY_DELAY_MS;
                return null;
            }

            daemonRetryAfter = System.currentTimeMillis() + DAEMON_RETRY_DELAY_MS;
            try {
                if (current != null) {
                    current.stop();
                }

                // Typed target so the DaemonBridge(…, Consumer) overload is selected
                // unambiguously (the TimeSource overload shares the same arity).
                Consumer<Map<String, String>> customEnvConfigurator = env -> configureProviderEnv(env, "{}");
                DaemonBridge newBridge = new DaemonBridge(
                        nodeDetector,
                        getDirectoryResolver(),
                        envConfigurator,
                        customEnvConfigurator
                );
                if (newBridge.start()) {
                    daemonBridge = newBridge;
                    daemonRetryAfter = 0;
                    for (DaemonBridge.DaemonEventListener cached : cachedEventListeners) {
                        newBridge.addEventListener(cached);
                    }
                    LOG.info("[QwenSDKBridge] Daemon bridge started successfully");
                    return newBridge;
                }
                LOG.warn("[QwenSDKBridge] Failed to start daemon, falling back to one-shot");
            } catch (Exception e) {
                LOG.debug("[QwenSDKBridge] Daemon init failed: " + e.getMessage());
            }
            return null;
        }
    }

    public void prewarmDaemonAsync(String cwd, String runtimeSessionEpoch) {
        prewarmDaemonAsync(cwd, runtimeSessionEpoch, null);
    }

    public void prewarmDaemonAsync(String cwd, String runtimeSessionEpoch, String sessionId) {
        CompletableFuture<?> previous = prewarmFuture;
        if (previous != null && !previous.isDone()) {
            previous.cancel(true);
        }

        final long generation = lifecycleGeneration;
        prewarmFuture = CompletableFuture.runAsync(() -> {
            try {
                if (generation != lifecycleGeneration) {
                    return;
                }
                DaemonBridge daemon = getDaemonBridge();
                if (daemon == null) {
                    LOG.info("[QwenSDKBridge] Prewarm skipped (daemon unavailable)");
                    return;
                }
                if (generation != lifecycleGeneration) {
                    daemon.stop();
                    return;
                }

                JsonObject params = new JsonObject();
                params.addProperty("cwd", cwd != null ? cwd : "");
                params.addProperty("sessionId", sessionId != null ? sessionId : "");
                params.addProperty("runtimeSessionEpoch", runtimeSessionEpoch != null ? runtimeSessionEpoch : "");
                // Match UI default so preconnect runtime is reused by default-mode sends
                // and tools go through the permission dialog (not a silent empty mode).
                params.addProperty("permissionMode", "default");
                params.addProperty("model", "");
                params.addProperty("streaming", true);
                params.add("env", new JsonObject());

                daemonRequestExecutor.preconnectViaDaemon(daemon, params)
                        .get(45, TimeUnit.SECONDS);
                LOG.info("[QwenSDKBridge] prewarm completed for epoch="
                        + (runtimeSessionEpoch != null ? runtimeSessionEpoch : "(none)"));
            } catch (Exception e) {
                LOG.debug("[QwenSDKBridge] prewarm failed: " + e.getMessage());
            }
        });
    }

    public void resetPersistentRuntime(String runtimeSessionEpoch) {
        DaemonBridge daemon = daemonBridge;
        if (daemon == null || !daemon.isAlive()) {
            LOG.info("[QwenSDKBridge] Skip reset; daemon unavailable for epoch="
                    + (runtimeSessionEpoch != null ? runtimeSessionEpoch : "(none)"));
            return;
        }
        try {
            JsonObject params = new JsonObject();
            params.addProperty("runtimeSessionEpoch", runtimeSessionEpoch != null ? runtimeSessionEpoch : "");
            daemon.sendCommand(
                    "qwen.resetRuntime",
                    params,
                    new DaemonBridge.DaemonOutputCallback() {
                        @Override
                        public void onLine(String line) {
                            if (line != null && !line.isBlank()) {
                                LOG.debug("[QwenSDKBridge] reset line: " + line);
                            }
                        }

                        @Override
                        public void onStderr(String text) {
                            if (text != null && !text.isBlank()) {
                                LOG.debug("[QwenSDKBridge] reset stderr: " + text);
                            }
                        }

                        @Override
                        public void onError(String error) {
                            LOG.warn("[QwenSDKBridge] reset error: " + error);
                        }

                        @Override
                        public void onComplete(boolean success) {
                            LOG.info("[QwenSDKBridge] reset completed: success=" + success
                                    + " epoch=" + (runtimeSessionEpoch != null ? runtimeSessionEpoch : "(none)"));
                        }
                    }
            ).get(15, TimeUnit.SECONDS);
        } catch (Exception e) {
            LOG.warn("[QwenSDKBridge] reset failed: " + e.getMessage());
        }
    }

    /**
     * Push permission mode to the live Qwen daemon runtime so Auto/bypass takes
     * effect mid-turn (session/request_permission + always-approve), not only on
     * the next user message.
     *
     * <p>Mirrors {@code ClaudeSDKBridge#setPermissionModeLive}: best-effort against
     * an already-running daemon only (no spawn). A fresh daemon has no runtime, so
     * {@code setPermissionModePersistent} would be a no-op.
     *
     * @return JSON with success/applied/reason (or error) for diagnostics
     */
    public CompletableFuture<JsonObject> setPermissionModeLive(String sessionId, String epoch, String mode) {
        // Non-spawning accessor: only push to an already-running daemon.
        DaemonBridge db = getCurrentDaemonBridge();
        if (db == null || !db.isAlive()) {
            JsonObject skipped = new JsonObject();
            skipped.addProperty("success", true);
            skipped.addProperty("applied", false);
            skipped.addProperty("reason", "no-daemon");
            LOG.info("[Qwen] setPermissionModeLive skipped (no live daemon): mode=" + mode);
            return CompletableFuture.completedFuture(skipped);
        }

        JsonObject params = new JsonObject();
        if (sessionId != null && !sessionId.isEmpty()) {
            params.addProperty("sessionId", sessionId);
        }
        if (epoch != null && !epoch.isEmpty()) {
            params.addProperty("runtimeSessionEpoch", epoch);
        }
        if (mode != null && !mode.isEmpty()) {
            params.addProperty("permissionMode", mode);
        }

        LOG.info("[Qwen] setPermissionModeLive → qwen.setPermissionMode mode=" + mode
                + " sessionId=" + (sessionId != null ? sessionId : "(none)")
                + " epoch=" + (epoch != null ? epoch : "(none)"));

        return daemonRequestExecutor.setPermissionModeViaDaemon(db, params)
                .thenApply(result -> {
                    JsonObject out = new JsonObject();
                    boolean success = !result.has("success") || result.get("success").getAsBoolean();
                    out.addProperty("success", success);
                    out.addProperty("applied", success);
                    if (result.has("error")) {
                        out.addProperty("error", result.get("error").getAsString());
                    }
                    return out;
                });
    }

    /**
     * Context usage for the /context dialog.
     * Prefer daemon runtime snapshot when available; otherwise synthesize from the
     * last ACP [USAGE] line + static model context limits.
     */
    public CompletableFuture<JsonObject> getContextUsage(String sessionId, String cwd, String model) {
        String effectiveModel = (model != null && !model.isEmpty()) ? model : lastUsageModel;
        int maxTokens = ModelProviderHandler.getModelContextLimit(effectiveModel);
        int usedTokens = lastUsedTokens.get();

        DaemonBridge db = getCurrentDaemonBridge();
        if (db != null && db.isAlive()) {
            JsonObject params = new JsonObject();
            if (sessionId != null && !sessionId.isEmpty()) {
                params.addProperty("sessionId", sessionId);
            }
            if (cwd != null && !cwd.isEmpty()) {
                params.addProperty("cwd", cwd);
            }
            if (effectiveModel != null && !effectiveModel.isEmpty()) {
                params.addProperty("model", effectiveModel);
            }
            params.addProperty("usedTokens", usedTokens);
            params.addProperty("maxTokens", maxTokens);

            return daemonRequestExecutor.getContextUsageViaDaemon(db, params)
                    .thenApply(result -> {
                        boolean ok = !result.has("success") || result.get("success").getAsBoolean();
                        if (ok && result.has("totalTokens")) {
                            return result;
                        }
                        return buildContextUsage(usedTokens, maxTokens, effectiveModel);
                    })
                    .exceptionally(ex -> {
                        LOG.warn("[Qwen] daemon getContextUsage failed, using local synthesis: " + ex.getMessage());
                        return buildContextUsage(usedTokens, maxTokens, effectiveModel);
                    });
        }

        return CompletableFuture.completedFuture(
                buildContextUsage(usedTokens, maxTokens, effectiveModel)
        );
    }

    /**
     * Interrupt a channel. In daemon mode, sends an abort command to cancel the
     * active Qwen ACP turn. Also delegates to ProcessManager for fallback.
     */
    @Override
    public void interruptChannel(String channelId) {
        DaemonBridge db = getCurrentDaemonBridge();
        if (db != null && db.isAlive()) {
            LOG.info("[QwenSDKBridge] Sending daemon abort for channel: " + channelId);
            try {
                db.sendAbort();
            } catch (Exception e) {
                LOG.error("[QwenSDKBridge] Daemon abort failed: " + e.getMessage());
            }
        }
        // Also try per-process interrupt (covers one-shot fallback)
        super.interruptChannel(channelId);
    }

    @Override
    public void cleanupAllProcesses() {
        shutdownDaemon();
        super.cleanupAllProcesses();
    }

    // ============================================================================
    // Message sending (SDK-shaped)
    // ============================================================================

    /**
     * Full SDK-shaped send entry (preferred). Tries daemon first for persistent ACP.
     */
    public CompletableFuture<SDKResult> sendMessage(
            String channelId,
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort,
            MessageCallback callback
    ) {
        String normalizedCwd = normalizeCwdForNode(cwd);

        DaemonBridge db = getDaemonBridge();
        if (db != null) {
            boolean hasAttachments = attachments != null && !attachments.isEmpty();
            return sendMessageViaDaemon(
                    db,
                    hasAttachments,
                    channelId,
                    message,
                    sessionId,
                    runtimeSessionEpoch,
                    normalizedCwd,
                    attachments,
                    permissionMode,
                    model,
                    openedFiles,
                    agentPrompt,
                    streaming,
                    disableThinking,
                    reasoningEffort,
                    callback
            );
        }

        LOG.info("[QwenSDKBridge] Using per-process (channel-manager) mode (daemon unavailable)");
        // Fallback to one-shot
        JsonObject stdinInput = buildStdinPayloadForDaemon(
                message, sessionId, runtimeSessionEpoch, normalizedCwd, attachments,
                permissionMode, model, openedFiles, agentPrompt, streaming, disableThinking, reasoningEffort
        );
        String stdinJson = gson.toJson(stdinInput);
        List<String> command = buildBaseCommand(
                attachments != null && !attachments.isEmpty() ? "sendWithAttachments" : "send"
        );
        LOG.info("[Qwen] sendMessage (fallback) sessionId=" + (sessionId != null ? sessionId : "(new)")
                + ", epoch=" + (runtimeSessionEpoch != null ? runtimeSessionEpoch : "(none)")
                + ", model=" + (model != null ? model : "(default)"));

        return executeStreamingCommand(channelId, command, stdinJson, normalizedCwd, callback);
    }

    private String normalizeCwdForNode(String cwd) {
        if (cwd == null || cwd.isEmpty()) {
            return cwd;
        }
        String nodePath = nodeDetector.getCachedNodePath();
        boolean isWsl = nodePath != null && NodeDetector.isWslPath(nodePath);
        return isWsl ? NodeDetector.convertToWslPath(cwd) : cwd;
    }

    private CompletableFuture<SDKResult> sendMessageViaDaemon(
            DaemonBridge daemon,
            boolean hasAttachments,
            String channelId,
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort,
            MessageCallback callback
    ) {
        if (hasAttachments) {
            return daemonRequestExecutor.sendMessageWithAttachmentsViaDaemon(
                    daemon, channelId, message, sessionId, runtimeSessionEpoch, cwd,
                    attachments, permissionMode, model, openedFiles, agentPrompt,
                    streaming, disableThinking, reasoningEffort, callback
            );
        }
        return daemonRequestExecutor.sendMessageViaDaemon(
                daemon, channelId, message, sessionId, runtimeSessionEpoch, cwd,
                attachments, permissionMode, model, openedFiles, agentPrompt,
                streaming, disableThinking, reasoningEffort, callback
        );
    }

    /**
     * Compatibility overload used by older call sites.
     */
    public CompletableFuture<SDKResult> sendMessage(
            String channelId,
            String message,
            String sessionId,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            String agentPrompt,
            MessageCallback callback
    ) {
        return sendMessage(
                channelId,
                message,
                sessionId,
                null,
                cwd,
                attachments,
                permissionMode,
                model,
                null,
                agentPrompt,
                true,
                false,
                null,
                callback
        );
    }

    // Package-visible for QwenDaemonRequestExecutor
    JsonObject buildStdinPayloadForDaemon(
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort
    ) {
        return buildStdinPayload(
                message, sessionId, runtimeSessionEpoch, cwd, attachments,
                permissionMode, model, openedFiles, agentPrompt, streaming, disableThinking, reasoningEffort
        );
    }

    private JsonObject buildStdinPayload(
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort
    ) {
        JsonObject stdinInput = new JsonObject();
        stdinInput.addProperty("message", message != null ? message : "");
        stdinInput.addProperty("sessionId", sessionId != null ? sessionId : "");
        if (runtimeSessionEpoch != null && !runtimeSessionEpoch.isEmpty()) {
            stdinInput.addProperty("runtimeSessionEpoch", runtimeSessionEpoch);
        }
        stdinInput.addProperty("cwd", cwd != null ? cwd : "");
        stdinInput.addProperty("permissionMode", permissionMode != null ? permissionMode : "");
        stdinInput.addProperty("model", model != null ? model : "");

        String effectiveBase = resolveEffectiveBaseUrl();
        stdinInput.addProperty("baseUrl", effectiveBase != null ? effectiveBase : "");
        String effectiveKey = resolveEffectiveApiKey();
        stdinInput.addProperty("apiKey", effectiveKey != null ? effectiveKey : "");

        stdinInput.addProperty("agentPrompt", agentPrompt != null ? agentPrompt : "");
        stdinInput.addProperty("streaming", streaming == null || streaming);
        stdinInput.addProperty("disableThinking", disableThinking);
        if (reasoningEffort != null && !reasoningEffort.isEmpty()) {
            stdinInput.addProperty("reasoningEffort", reasoningEffort);
        }
        if (openedFiles != null) {
            stdinInput.add("openedFiles", openedFiles);
        }
        if (attachments != null && !attachments.isEmpty()) {
            JsonArray attArr = new JsonArray();
            for (QwenMateSession.Attachment a : attachments) {
                JsonObject o = new JsonObject();
                o.addProperty("fileName", a.fileName);
                o.addProperty("mediaType", a.mediaType);
                o.addProperty("data", a.data);
                attArr.add(o);
            }
            stdinInput.add("attachments", attArr);
        }
        return stdinInput;
    }

    /** Package-visible for tests: last captured ACP usage total. */
    int getLastUsedTokensForTest() {
        return lastUsedTokens.get();
    }

    void setLastUsedTokensForTest(int tokens) {
        lastUsedTokens.set(tokens);
    }
}
