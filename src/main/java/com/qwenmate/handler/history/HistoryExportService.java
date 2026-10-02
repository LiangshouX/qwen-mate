package com.qwenmate.handler.history;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.core.HandlerContext;

import com.qwenmate.provider.dsh.DshHistoryReader;
import com.qwenmate.provider.qwen.QwenHistoryReader;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Service for exporting session data.
 */
class HistoryExportService {

    private static final Logger LOG = Logger.getInstance(HistoryExportService.class);

    private final HandlerContext context;
    private final Gson gson = new Gson();

    HistoryExportService(HandlerContext context) {
        this.context = context;
    }

    /**
     * Export session data.
     * Reads all messages of the session and returns them to the frontend.
     */
    void handleExportSession(String content, String currentProvider) {
        CompletableFuture.runAsync(() -> {
            LOG.info("[HistoryHandler] ========== 开始导出会话 ==========");

            try {
                // Parse JSON from frontend to extract sessionId and title
                JsonObject exportRequest = gson.fromJson(content, JsonObject.class);
                String sessionId = exportRequest.get("sessionId").getAsString();
                String title = exportRequest.get("title").getAsString();
                // Prefer provider embedded in the export request (history row) when present.
                String provider = currentProvider;
                if (exportRequest.has("provider") && !exportRequest.get("provider").isJsonNull()) {
                    String fromRequest = exportRequest.get("provider").getAsString();
                    if (fromRequest != null && !fromRequest.trim().isEmpty()) {
                        provider = fromRequest.trim();
                    }
                }

                String rawPath = context.resolveEffectiveWorkingDirectory();
                String nodePath = NodeDetector.getInstance().getCachedNodePath();
                String projectPath = NodeDetector.isWslPath(nodePath) ? NodeDetector.convertToWslPath(rawPath) : rawPath;
                if (projectPath == null) {
                    LOG.warn("[HistoryHandler] Project base path is null");
                    return;
                }
                LOG.info("[HistoryHandler] SessionId: " + sessionId);
                LOG.info("[HistoryHandler] Title: " + title);
                LOG.info("[HistoryHandler] ProjectPath: " + projectPath);
                LOG.info("[HistoryHandler] CurrentProvider: " + provider);

                JsonElement messagesElement = loadMessagesForExport(provider, sessionId, projectPath);

                // Wrap messages into an object containing sessionId and title
                JsonObject exportData = new JsonObject();
                exportData.addProperty("sessionId", sessionId);
                exportData.addProperty("title", title);
                exportData.addProperty("provider", provider != null ? provider : "qwen");
                exportData.add("messages", messagesElement);

                String wrappedJson = gson.toJson(exportData);

                LOG.info("[HistoryHandler] 读取到会话消息，准备注入到前端");

                // Use Base64 encoding to avoid JavaScript string escaping issues
                String base64Json = Base64.getEncoder().encodeToString(
                        wrappedJson.getBytes(StandardCharsets.UTF_8));

                ApplicationManager.getApplication().invokeLater(() -> {
                    String jsCode = "console.log('[Backend->Frontend] Starting to inject export data');" +
                                            "if (window.onExportSessionData) { " +
                                            "  try { " +
                                            "    var base64Str = '" + base64Json + "'; " +
                                            "    var binaryStr = atob(base64Str); " +
                                            "    var bytes = new Uint8Array(binaryStr.length); " +
                                            "    for (var i = 0; i < binaryStr.length; i++) { bytes[i] = binaryStr.charCodeAt(i); } " +
                                            "    var jsonStr = new TextDecoder('utf-8').decode(bytes); " +
                                            "    window.onExportSessionData(jsonStr); " +
                                            "    console.log('[Backend->Frontend] Export data injected successfully'); " +
                                            "  } catch(e) { " +
                                            "    console.error('[Backend->Frontend] Failed to inject export data:', e); " +
                                            "  } " +
                                            "} else { " +
                                            "  console.error('[Backend->Frontend] onExportSessionData not available!'); " +
                                            "}";

                    context.executeJavaScriptQueued(jsCode);
                });

                LOG.info("[HistoryHandler] ========== 导出会话完成 ==========");

            } catch (Exception e) {
                LOG.error("[HistoryHandler] 导出会话失败: " + e.getMessage(), e);

                ApplicationManager.getApplication().invokeLater(() -> {
                    String jsCode = "if (window.addToast) { " +
                                            "  window.addToast('导出失败: " + context.escapeJs(e.getMessage() != null ? e.getMessage() : "未知错误") + "', 'error'); " +
                                            "}";
                    context.executeJavaScriptQueued(jsCode);
                });
            }
        });
    }

    private JsonElement loadMessagesForExport(String provider, String sessionId, String projectPath) {
        if ("dsh".equals(provider)) {
            LOG.info("[HistoryHandler] 使用 DshHistoryReader 导出 DSH 会话");
            return toJsonArray(new DshHistoryReader().getSessionMessages(sessionId, projectPath));
        }
        LOG.info("[HistoryHandler] 使用 QwenHistoryReader 导出 qwen 会话");
        return toJsonArray(new QwenHistoryReader().getSessionMessages(sessionId, projectPath));
    }

    private JsonElement toJsonArray(List<JsonObject> messages) {
        if (messages == null || messages.isEmpty()) {
            return new JsonArray();
        }
        JsonArray array = new JsonArray();
        for (JsonObject message : messages) {
            if (message != null) {
                array.add(message);
            }
        }
        return array;
    }
}
