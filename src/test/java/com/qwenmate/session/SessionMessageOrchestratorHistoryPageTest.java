package com.qwenmate.session;

import com.qwenmate.permission.PermissionRequest;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for disk-backed history pagination: turn-page prepends, cursor
 * resets and the graceful "not available" degradation for providers without a
 * paginated history source.
 */
public class SessionMessageOrchestratorHistoryPageTest {

    @Test
    public void loadEarlierClaudeHistoryPagePrependsOlderTurns() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setSessionId("session-page");
        state.setCwd("/workspace");
        state.addMessage(stateMessage(QwenMateSession.Message.Type.USER, "recent prompt"));
        state.addMessage(stateMessage(QwenMateSession.Message.Type.ASSISTANT, "recent reply"));

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        PagingHistoryAccess historyAccess = new PagingHistoryAccess();
        historyAccess.page = page(true,
                List.of(message("user", "older prompt"), message("assistant", "older reply")),
                0, 2, 4, false, false, "Renamed in CLI");

        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, historyAccess, (usedTokens, maxTokens) -> {
        });

        orchestrator.loadEarlierClaudeHistoryPage("session-page", "/workspace", 2).join();

        List<QwenMateSession.Message> messages = state.getMessages();
        assertEquals(4, messages.size());
        assertEquals("older prompt", messages.get(0).content);
        assertEquals("older reply", messages.get(1).content);
        assertEquals("recent prompt", messages.get(2).content);
        assertEquals("recent reply", messages.get(3).content);
        assertEquals(List.of("session-page|0|4|false|false|Renamed in CLI"), callback.pageInfos);
        assertTrue(callback.pageErrors.isEmpty());
        assertEquals(1, callback.messageUpdates.size());
        assertEquals(0, orchestrator.getHistoryFromTurn());
        assertEquals(4, orchestrator.getHistoryTotalTurns());
        assertTrue(!orchestrator.hasMoreHistory());
    }

    @Test
    public void loadEarlierClaudeHistoryPageReplacesTranscriptOnCursorReset() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setSessionId("session-page");
        state.addMessage(stateMessage(QwenMateSession.Message.Type.USER, "stale prompt"));
        state.addMessage(stateMessage(QwenMateSession.Message.Type.ASSISTANT, "stale reply"));

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        PagingHistoryAccess historyAccess = new PagingHistoryAccess();
        historyAccess.page = page(true,
                List.of(message("user", "fresh prompt"), message("assistant", "fresh reply")),
                0, 2, 2, false, true, null);

        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, historyAccess, (usedTokens, maxTokens) -> {
        });

        orchestrator.loadEarlierClaudeHistoryPage("session-page", "/workspace", 99).join();

        List<QwenMateSession.Message> messages = state.getMessages();
        assertEquals(2, messages.size());
        assertEquals("fresh prompt", messages.get(0).content);
        assertEquals("fresh reply", messages.get(1).content);
        assertEquals(List.of("session-page|0|2|false|true|null"), callback.pageInfos);
        assertTrue(callback.pageErrors.isEmpty());
    }

    @Test
    public void loadEarlierClaudeHistoryPageNotifiesErrorWhenQueryFails() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setSessionId("session-page");

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        PagingHistoryAccess historyAccess = new PagingHistoryAccess();
        historyAccess.page = failedPage("History page query failed");

        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, historyAccess, (usedTokens, maxTokens) -> {
        });

        orchestrator.loadEarlierClaudeHistoryPage("session-page", "/workspace", 2).join();

        assertTrue(state.getMessages().isEmpty());
        assertEquals(1, callback.pageErrors.size());
        assertEquals("session-page|History page query failed", callback.pageErrors.get(0));
        assertTrue(callback.pageInfos.isEmpty());
    }

    @Test
    public void loadEarlierClaudeHistoryPageDegradesGracefullyWithoutPageSupport() {
        SessionState state = new SessionState();
        state.setProvider("dsh");
        state.setSessionId("session-page");

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        // Default SessionHistoryAccess returns null pages (CLI-routed providers).
        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, new PagingHistoryAccess(), (usedTokens, maxTokens) -> {
        });

        orchestrator.loadEarlierClaudeHistoryPage("session-page", "/workspace", 2).join();

        assertEquals(1, callback.pageErrors.size());
        assertEquals("session-page|Earlier history pages are not available", callback.pageErrors.get(0));
    }

    @Test
    public void loadEarlierClaudeHistoryPageIgnoresSessionsThatChangedWhileLoading() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setSessionId("other-session");

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        PagingHistoryAccess historyAccess = new PagingHistoryAccess();
        historyAccess.page = page(true, List.of(message("user", "older prompt")), 0, 1, 1, false, false, null);

        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, historyAccess, (usedTokens, maxTokens) -> {
        });

        orchestrator.loadEarlierClaudeHistoryPage("session-page", "/workspace", 1).join();

        assertTrue(state.getMessages().isEmpty());
        assertTrue(callback.messageUpdates.isEmpty());
        assertTrue(callback.pageInfos.isEmpty());
    }

    @Test
    public void fullLoadSeedsPaginationMetadataForDiskBackedProviders() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setSessionId("session-2");
        state.setCwd("/workspace");

        RecordingCallback callback = new RecordingCallback();
        SessionCallbackFacade callbackFacade = new SessionCallbackFacade(null);
        callbackFacade.setCallback(callback);

        PagingHistoryAccess historyAccess = new PagingHistoryAccess();
        historyAccess.providerHistory = List.of(
                message("user", "first prompt"),
                message("assistant", "first reply"),
                message("user", "second prompt"),
                message("assistant", "second reply"));

        SessionMessageOrchestrator orchestrator = new SessionMessageOrchestrator(
                state, new MessageParser(), callbackFacade, historyAccess, (usedTokens, maxTokens) -> {
        });

        orchestrator.loadFromServer().join();

        assertEquals(List.of("session-2|0|2|false|false|null"), callback.pageInfos);
        assertEquals(2, orchestrator.getHistoryTotalTurns());
        assertTrue(!orchestrator.hasMoreHistory());
    }

    // ===== fixtures =====

    private static QwenMateSession.Message stateMessage(QwenMateSession.Message.Type type, String text) {
        return new QwenMateSession.Message(type, text);
    }

    private static JsonObject message(String type, String text) {
        JsonObject message = new JsonObject();
        message.addProperty("type", type);
        JsonObject inner = new JsonObject();
        inner.addProperty("role", "user".equals(type) ? "user" : "assistant");
        JsonArray content = new JsonArray();
        JsonObject block = new JsonObject();
        block.addProperty("type", "text");
        block.addProperty("text", text);
        content.add(block);
        inner.add("content", content);
        message.add("message", inner);
        return message;
    }

    private static JsonObject page(
            boolean success,
            List<JsonObject> messages,
            int fromTurn,
            int toTurn,
            int totalTurns,
            boolean hasMore,
            boolean cursorReset,
            String sessionTitle
    ) {
        JsonObject page = new JsonObject();
        page.addProperty("success", success);
        JsonArray array = new JsonArray();
        for (JsonObject message : messages) {
            array.add(message);
        }
        page.add("messages", array);
        page.addProperty("fromTurn", fromTurn);
        page.addProperty("toTurn", toTurn);
        page.addProperty("totalTurns", totalTurns);
        page.addProperty("hasMore", hasMore);
        page.addProperty("cursorReset", cursorReset);
        if (sessionTitle != null) {
            page.addProperty("sessionTitle", sessionTitle);
        }
        return page;
    }

    private static JsonObject failedPage(String error) {
        JsonObject page = new JsonObject();
        page.addProperty("success", false);
        page.addProperty("error", error);
        return page;
    }

    private static final class PagingHistoryAccess implements SessionMessageOrchestrator.SessionHistoryAccess {
        private List<JsonObject> providerHistory = List.of();
        private JsonObject page;

        @Override
        public List<JsonObject> getProviderSessionMessages(String provider, String sessionId, String cwd) {
            return providerHistory;
        }

        @Override
        public JsonObject getProviderSessionMessagesPage(
                String provider, String sessionId, String cwd, Integer beforeTurn, int turnLimit) {
            return page;
        }
    }

    private static final class RecordingCallback implements QwenMateSession.SessionCallback {
        private final List<List<QwenMateSession.Message>> messageUpdates = new ArrayList<>();
        private final List<String> pageInfos = new ArrayList<>();
        private final List<String> pageErrors = new ArrayList<>();

        @Override
        public void onMessageUpdate(List<QwenMateSession.Message> messages) {
            messageUpdates.add(messages);
        }

        @Override
        public void onStateChange(boolean busy, boolean loading, String error) {
        }

        @Override
        public void onSessionIdReceived(String sessionId) {
        }

        @Override
        public void onPermissionRequested(PermissionRequest request) {
        }

        @Override
        public void onThinkingStatusChanged(boolean isThinking) {
        }

        @Override
        public void onSlashCommandsReceived(List<String> slashCommands) {
        }

        @Override
        public void onNodeLog(String log) {
        }

        @Override
        public void onSummaryReceived(String summary) {
        }

        @Override
        public void onQwenMateHistoryPageInfo(
                String sessionId, int fromTurn, int totalTurns, boolean hasMore, boolean cursorReset, String sessionTitle) {
            pageInfos.add(sessionId + "|" + fromTurn + "|" + totalTurns + "|" + hasMore + "|" + cursorReset
                    + "|" + sessionTitle);
        }

        @Override
        public void onQwenMateHistoryPageError(String sessionId, String message) {
            pageErrors.add(sessionId + "|" + message);
        }
    }
}
