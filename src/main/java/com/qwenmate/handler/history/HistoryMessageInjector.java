package com.qwenmate.handler.history;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.session.QwenMateSession;
import com.qwenmate.util.JsUtils;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Service for loading session messages and injecting them into the frontend.
 */
public class HistoryMessageInjector {

    private static final Logger LOG = Logger.getInstance(HistoryMessageInjector.class);
    static final int HISTORY_BATCH_MESSAGE_LIMIT = 50;
    static final int HISTORY_BATCH_TARGET_CHAR_LIMIT = 180_000;

    private final HandlerContext context;

    HistoryMessageInjector(HandlerContext context) {
        this.context = context;
    }

    /**
     * Load a history session.
     */
    void handleLoadSession(String sessionId, String currentProvider, HistoryHandler.SessionLoadCallback sessionLoadCallback) {
        String provider = currentProvider;
        String resolvedSessionId = sessionId;
        String model = null;

        try {
            JsonObject payload = new Gson().fromJson(sessionId, JsonObject.class);
            if (payload != null) {
                if (payload.has("sessionId") && !payload.get("sessionId").isJsonNull()) {
                    resolvedSessionId = payload.get("sessionId").getAsString();
                }
                if (payload.has("provider") && !payload.get("provider").isJsonNull()) {
                    provider = payload.get("provider").getAsString();
                }
                if (payload.has("model") && !payload.get("model").isJsonNull()) {
                    String m = payload.get("model").getAsString();
                    if (m != null && !m.trim().isEmpty()) {
                        model = m.trim();
                    }
                }
            }
        } catch (Exception ignored) {
            // Backward compatible: legacy payload is the raw sessionId string.
        }

        String rawPath = context.resolveEffectiveWorkingDirectory();
        String nodePath = NodeDetector.getInstance().getCachedNodePath();
        String projectPath = NodeDetector.isWslPath(nodePath) ? NodeDetector.convertToWslPath(rawPath) : rawPath;
        if (projectPath == null) {
            LOG.warn("[HistoryHandler] Project base path is null");
            notifyHistoryLoadComplete();
            return;
        }
        LOG.info("[HistoryHandler] Loading history session: " + resolvedSessionId
                + " from project: " + projectPath + ", provider: " + provider
                + (model != null ? ", model: " + model : ""));

        // All kept providers load through the session callback.
        if (sessionLoadCallback != null) {
            sessionLoadCallback.onLoadSession(resolvedSessionId, projectPath, provider, model);
        } else {
            LOG.warn("[HistoryHandler] WARNING: No session load callback set");
            notifyHistoryLoadComplete();
        }
    }

    /**
     * Load an earlier page of history and prepend to the current session.
     * Called when the user requests older turns from disk.
     *
     * <p>The actual pagination runs inside the session orchestrator, which owns the
     * transcript state and the {@code __messageBaseIndex}-compatible message
     * transport. Providers without a paginated history source degrade to the
     * "not available" notice.</p>
     */
    void loadEarlierClaudeHistoryPage(String content) {
        CompletableFuture.runAsync(() -> {
            String sessionId = null;
            Integer beforeTurn = null;
            try {
                JsonObject request = new Gson().fromJson(content, JsonObject.class);
                if (request == null || !request.has("sessionId") || !request.has("beforeTurn")) {
                    throw new IllegalArgumentException("Invalid history page request");
                }
                sessionId = request.get("sessionId").getAsString();
                JsonElement beforeTurnElement = request.get("beforeTurn");
                if (beforeTurnElement != null && !beforeTurnElement.isJsonNull()) {
                    beforeTurn = beforeTurnElement.getAsInt();
                }
                if (sessionId.isBlank() || sessionId.length() > 200 || (beforeTurn != null && beforeTurn < 0)) {
                    throw new IllegalArgumentException("Invalid history page cursor");
                }

                QwenMateSession session = context.getSession();
                if (session != null && sessionId.equals(session.getSessionId())) {
                    String cwd = session.getState() != null ? session.getState().getCwd() : null;
                    if (cwd == null) {
                        cwd = context.resolveEffectiveWorkingDirectory();
                    }
                    session.getOrchestrator().loadEarlierClaudeHistoryPage(sessionId, cwd, beforeTurn);
                } else {
                    LOG.warn("[HistoryHandler] History page request for inactive session: " + sessionId);
                    notifyQwenMateHistoryPageError(sessionId, beforeTurn, "Session is not active");
                }
            } catch (Exception e) {
                LOG.error("[HistoryHandler] Failed to load earlier Claude history page: " + e.getMessage(), e);
                notifyQwenMateHistoryPageError(sessionId, beforeTurn, e.getMessage());
            }
        });
    }

    private void notifyQwenMateHistoryPageError(String sessionId, Integer beforeTurn, String errorMessage) {
        JsonObject error = new JsonObject();
        if (sessionId != null) {
            error.addProperty("sessionId", sessionId);
        }
        if (beforeTurn != null) {
            error.addProperty("beforeTurn", beforeTurn);
        }
        error.addProperty("message", errorMessage != null ? errorMessage : "Unknown error");
        context.callJavaScript("qwenMateHistoryPageError", context.escapeJs(new Gson().toJson(error)));
    }

    void notifyHistoryLoadComplete() {
        ApplicationManager.getApplication().invokeLater(() -> {
            String jsCode = "if (window.historyLoadComplete) { " +
                                    "  try { " +
                                    "    window.historyLoadComplete(); " +
                                    "  } catch(e) { " +
                                    "    console.error('[HistoryHandler] historyLoadComplete callback failed:', e); " +
                                    "  } " +
                                    "}";
            context.executeJavaScriptQueued(jsCode);
        });
    }

    /**
     * 将前端统一消息结构恢复为会话内存消息结构。
     */
    static QwenMateSession.Message toSessionMessage(JsonObject frontendMsg) {
        if (frontendMsg == null || !frontendMsg.has("type")) {
            return null;
        }

        String type = frontendMsg.get("type").getAsString();
        QwenMateSession.Message.Type messageType;
        switch (type) {
            case "user":
                messageType = QwenMateSession.Message.Type.USER;
                break;
            case "assistant":
                messageType = QwenMateSession.Message.Type.ASSISTANT;
                break;
            case "system":
                messageType = QwenMateSession.Message.Type.SYSTEM;
                break;
            case "error":
                messageType = QwenMateSession.Message.Type.ERROR;
                break;
            default:
                return null;
        }

        String content = frontendMsg.has("content") ? frontendMsg.get("content").getAsString() : "";
        JsonObject raw = frontendMsg.has("raw") && frontendMsg.get("raw").isJsonObject()
            ? frontendMsg.getAsJsonObject("raw")
            : null;
        QwenMateSession.Message restored = raw != null
            ? new QwenMateSession.Message(messageType, content, raw.deepCopy())
            : new QwenMateSession.Message(messageType, content);
        Long sourceTimestamp = parseFrontendTimestamp(frontendMsg);
        if (sourceTimestamp != null) {
            restored.timestamp = sourceTimestamp;
        }
        return restored;
    }

    private static Long parseFrontendTimestamp(JsonObject frontendMsg) {
        if (!frontendMsg.has("timestamp") || frontendMsg.get("timestamp").isJsonNull()) {
            return null;
        }
        JsonElement timestamp = frontendMsg.get("timestamp");
        if (!timestamp.isJsonPrimitive()) {
            return null;
        }
        try {
            if (timestamp.getAsJsonPrimitive().isNumber()) {
                return timestamp.getAsLong();
            }
            String value = timestamp.getAsString();
            if (value == null || value.isBlank()) {
                return null;
            }
            try {
                return Long.parseLong(value);
            } catch (NumberFormatException ignored) {
                return Instant.parse(value).toEpochMilli();
            }
        } catch (NumberFormatException | DateTimeParseException ignored) {
            return null;
        }
    }

    /**
     * 分批注入前端消息，避免长历史单次传输阻塞 WebView。
     */
    static List<List<JsonObject>> partitionHistoryMessages(List<JsonObject> frontendMessages) {
        List<List<JsonObject>> batches = new ArrayList<>();
        if (frontendMessages == null || frontendMessages.isEmpty()) {
            return batches;
        }
        Gson gson = new Gson();
        List<JsonObject> batch = new ArrayList<>(HISTORY_BATCH_MESSAGE_LIMIT);
        int estimatedChars = 2;
        for (JsonObject message : frontendMessages) {
            int messageChars = JsUtils.escapeJs(gson.toJson(message)).length() + 1;
            if (!batch.isEmpty() && (batch.size() >= HISTORY_BATCH_MESSAGE_LIMIT
                    || estimatedChars + messageChars > HISTORY_BATCH_TARGET_CHAR_LIMIT)) {
                batches.add(List.copyOf(batch));
                batch = new ArrayList<>(HISTORY_BATCH_MESSAGE_LIMIT);
                estimatedChars = 2;
            }
            batch.add(message);
            estimatedChars += messageChars;
        }
        if (!batch.isEmpty()) {
            batches.add(List.copyOf(batch));
        }
        return batches;
    }

    static List<String> splitHistoryPayload(String payload) {
        List<String> chunks = new ArrayList<>();
        if (payload == null || payload.isEmpty()) {
            return chunks;
        }

        StringBuilder current = new StringBuilder(HISTORY_BATCH_TARGET_CHAR_LIMIT);
        int escapedChars = 0;
        for (int i = 0; i < payload.length(); i++) {
            char value = payload.charAt(i);
            int charCount = escapedCharCount(current, value);
            boolean surrogatePair = Character.isHighSurrogate(value)
                    && i + 1 < payload.length()
                    && Character.isLowSurrogate(payload.charAt(i + 1));
            if (surrogatePair) {
                charCount += 1;
            }

            if (escapedChars + charCount > HISTORY_BATCH_TARGET_CHAR_LIMIT && current.length() > 0) {
                chunks.add(current.toString());
                current.setLength(0);
                escapedChars = 0;
                charCount = escapedCharCount(current, value) + (surrogatePair ? 1 : 0);
            }

            current.append(value);
            if (surrogatePair) {
                current.append(payload.charAt(++i));
            }
            escapedChars += charCount;
        }
        if (current.length() > 0) {
            chunks.add(current.toString());
        }
        return chunks;
    }

    private static int escapedCharCount(StringBuilder current, char value) {
        if (value == '\u0085' || value == '\u2028' || value == '\u2029') {
            return 6;
        }
        if (value == '\\' || value == '\'' || value == '"' || value == '`'
                || value == '\n' || value == '\r' || value == '\t'
                || value == '\b' || value == '\f' || value == '\0') {
            return 2;
        }
        if (value == '/' && current.length() > 0 && current.charAt(current.length() - 1) == '<') {
            return 2;
        }
        return 1;
    }
}
