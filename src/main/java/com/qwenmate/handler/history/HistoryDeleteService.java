package com.qwenmate.handler.history;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.NodeJsServiceCaller;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.provider.qwen.QwenHistoryReader;

import com.qwenmate.cache.SessionIndexCache;
import com.qwenmate.cache.SessionIndexManager;
import com.qwenmate.session.QwenMateSession;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;

/**
 * Service for deleting session history files and related data.
 */
class HistoryDeleteService {

    private static final Logger LOG = Logger.getInstance(HistoryDeleteService.class);
    private static final Gson GSON = new Gson();

    // Reject anything outside [A-Za-z0-9._-] to defeat path-traversal payloads such as "../foo"
    // before they reach Path.resolve. Session IDs in both providers are alphanumeric/UUID style.
    private static final Pattern SESSION_ID_PATTERN = Pattern.compile("^[A-Za-z0-9._-]+$");

    static boolean isValidSessionId(String sessionId) {
        return sessionId != null && SESSION_ID_PATTERN.matcher(sessionId).matches();
    }

    private final HandlerContext context;
    private final NodeJsServiceCaller nodeJsServiceCaller;
    private final HistoryLoadService historyLoadService;

    HistoryDeleteService(HandlerContext context, NodeJsServiceCaller nodeJsServiceCaller, HistoryLoadService historyLoadService) {
        this.context = context;
        this.nodeJsServiceCaller = nodeJsServiceCaller;
        this.historyLoadService = historyLoadService;
    }

    /**
     * Delete session history files.
     * Deletes the .jsonl file for the specified sessionId and related agent-xxx.jsonl files.
     */
    void handleDeleteSession(String sessionId, String currentProvider) {
        if (!isValidSessionId(sessionId)) {
            LOG.warn("[HistoryHandler] Delete session rejected: invalid sessionId");
            return;
        }
        quiesceActiveSessionForDeletion(
                context.getSession(), Collections.singleton(sessionId), currentProvider)
                .thenRunAsync(() -> {
                    try {
                        LOG.info("[HistoryHandler] ========== Delete session start ==========");
                        LOG.info("[HistoryHandler] SessionId: " + sessionId + ", Provider: " + currentProvider);

                        DeleteResult result = deleteSessionFiles(sessionId, currentProvider);

                        LOG.info("[HistoryHandler] Delete completed - Main file: " + (result.mainDeleted ? "deleted" : "not found") + ", Agent files: " + result.agentFilesDeleted);

                        if (result.mainDeleted) {
                            cleanupSessionMetadata(sessionId);
                        }
                        cleanupCache(currentProvider);

                        LOG.info("[HistoryHandler] Reloading history data...");
                        historyLoadService.handleLoadHistoryData(currentProvider);

                    } catch (Exception e) {
                        LOG.error("[HistoryHandler] Delete session failed: " + e.getMessage(), e);
                    }
                }).exceptionally(ex -> {
                    handleQuiesceFailure("deletion", currentProvider, ex);
                    return null;
                });
    }

    /**
     * Batch delete session history files in one backend request.
     */
    void handleDeleteSessions(String content, String currentProvider) {
        List<String> sessionIds = parseSessionIds(content);
        if (sessionIds.isEmpty()) {
            LOG.warn("[HistoryHandler] Batch delete failed: empty sessionIds");
            return;
        }

        quiesceActiveSessionForDeletion(context.getSession(), sessionIds, currentProvider)
                .thenRunAsync(() -> {
                    try {
                        LOG.info("[HistoryHandler] ========== Batch delete sessions start ==========");
                        LOG.info("[HistoryHandler] SessionIds: " + GSON.toJson(sessionIds) + ", Provider: " + currentProvider);

                        int mainDeletedCount = 0;
                        int agentFilesDeletedCount = 0;

                        for (String sessionId : sessionIds) {
                            try {
                                DeleteResult result = deleteSessionFiles(sessionId, currentProvider);
                                if (result.mainDeleted) {
                                    mainDeletedCount++;
                                    cleanupSessionMetadata(sessionId);
                                }
                                agentFilesDeletedCount += result.agentFilesDeleted;
                            } catch (Exception e) {
                                LOG.error("[HistoryHandler] Batch delete single session failed: " + sessionId + " - " + e.getMessage(), e);
                            }
                        }

                        cleanupCache(currentProvider);

                        LOG.info("[HistoryHandler] Batch delete completed - Main files: " + mainDeletedCount + "/" + sessionIds.size()
                                + ", Agent files: " + agentFilesDeletedCount);
                        LOG.info("[HistoryHandler] Reloading history data...");
                        historyLoadService.handleLoadHistoryData(currentProvider);
                    } catch (Exception e) {
                        LOG.error("[HistoryHandler] Batch delete sessions failed: " + e.getMessage(), e);
                    }
                }).exceptionally(ex -> {
                    handleQuiesceFailure("batch deletion", currentProvider, ex);
                    return null;
                });
    }

    private void handleQuiesceFailure(String action, String currentProvider, Throwable error) {
        LOG.warn("[HistoryHandler] Failed to stop active session before " + action
                + ": " + error.getMessage(), error);
        try {
            historyLoadService.handleLoadHistoryData(currentProvider);
        } catch (Exception reloadError) {
            LOG.warn("[HistoryHandler] Failed to restore history after aborted " + action
                    + ": " + reloadError.getMessage(), reloadError);
        }
    }

    static CompletableFuture<Void> quiesceActiveSessionForDeletion(
            QwenMateSession session,
            Collection<String> sessionIds,
            String currentProvider
    ) {
        if (session == null || sessionIds == null || sessionIds.isEmpty()) {
            return CompletableFuture.completedFuture(null);
        }
        String activeSessionId = session.getSessionId();
        if (activeSessionId == null
                || !sessionIds.contains(activeSessionId)
                || !Objects.equals(session.getProvider(), currentProvider)) {
            return CompletableFuture.completedFuture(null);
        }
        return session.interrupt();
    }

    static List<String> parseSessionIds(String content) {
        LinkedHashSet<String> sessionIds = new LinkedHashSet<>();
        if (content == null || content.trim().isEmpty()) {
            return new ArrayList<>();
        }

        try {
            JsonElement parsed = JsonParser.parseString(content);
            if (parsed.isJsonArray()) {
                collectSessionIds(parsed.getAsJsonArray(), sessionIds);
            } else if (parsed.isJsonObject()) {
                JsonObject object = parsed.getAsJsonObject();
                JsonElement sessionIdsElement = object.get("sessionIds");
                if (sessionIdsElement != null && sessionIdsElement.isJsonArray()) {
                    collectSessionIds(sessionIdsElement.getAsJsonArray(), sessionIds);
                }
            }
        } catch (Exception e) {
            LOG.warn("[HistoryHandler] Batch delete sessionIds parse failed: " + e.getMessage());
        }

        return new ArrayList<>(sessionIds);
    }

    private static void collectSessionIds(JsonArray array, LinkedHashSet<String> sessionIds) {
        for (JsonElement element : array) {
            if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
                continue;
            }

            String sessionId = element.getAsString().trim();
            if (sessionId.isEmpty()) {
                continue;
            }
            if (!isValidSessionId(sessionId)) {
                LOG.warn("[HistoryHandler] Batch delete ignored invalid sessionId");
                continue;
            }
            sessionIds.add(sessionId);
        }
    }

    private DeleteResult deleteSessionFiles(String sessionId, String currentProvider) throws IOException {
        if (!isValidSessionId(sessionId)) {
            LOG.warn("[HistoryHandler] Delete session rejected: invalid sessionId");
            return new DeleteResult(false, 0);
        }
        if ("qwen".equals(currentProvider)) {
            return new DeleteResult(deleteQwenSession(sessionId), 0);
        }
        return new DeleteResult(false, 0);
    }

    /**
     * Delete a qwen session: transcript, runtime sidecar and per-session subagent
     * logs under {@code ~/.qwen/projects/<key>/}. The shared session index entry is
     * cleared by {@link #cleanupCache(String)}.
     */
    private boolean deleteQwenSession(String sessionId) {
        String rawPath = context.resolveEffectiveWorkingDirectory();
        String nodePath = NodeDetector.getInstance().getCachedNodePath();
        String projectPath = NodeDetector.isWslPath(nodePath) ? NodeDetector.convertToWslPath(rawPath) : rawPath;
        boolean deleted = new QwenHistoryReader().deleteSession(sessionId, projectPath);
        LOG.info("[HistoryHandler] Delete Qwen session " + sessionId + ": " + (deleted ? "ok" : "not found"));
        return deleted;
    }


    private void cleanupSessionMetadata(String sessionId) {
        try {
            nodeJsServiceCaller.callNodeJsFavoritesService("removeFavorite", sessionId);
            nodeJsServiceCaller.callNodeJsDeleteTitle(sessionId);
            LOG.info("[HistoryHandler] Cleaned up session metadata");
        } catch (Exception e) {
            LOG.warn("[HistoryHandler] Failed to clean up metadata (does not affect deletion): " + e.getMessage());
        }
    }

    private void cleanupCache(String currentProvider) {
        try {
            String rawPath2 = context.resolveEffectiveWorkingDirectory();
            String nodePath2 = NodeDetector.getInstance().getCachedNodePath();
            String projectPath = NodeDetector.isWslPath(nodePath2) ? NodeDetector.convertToWslPath(rawPath2) : rawPath2;
            if (projectPath != null) {
                SessionIndexCache.getInstance().clearProject(projectPath);
                SessionIndexManager.getInstance().clearProjectIndex(currentProvider, projectPath);
            }
        } catch (Exception e) {
            LOG.warn("[HistoryHandler] Failed to clean up cache (does not affect deletion): " + e.getMessage());
        }
    }


    private static class DeleteResult {
        private final boolean mainDeleted;
        private final int agentFilesDeleted;

        private DeleteResult(boolean mainDeleted, int agentFilesDeleted) {
            this.mainDeleted = mainDeleted;
            this.agentFilesDeleted = agentFilesDeleted;
        }
    }
}
