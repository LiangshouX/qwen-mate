package com.qwenmate.session;

import com.google.gson.JsonObject;
import com.qwenmate.permission.PermissionRequest;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Locks the live context-ring pipeline: a per-round {@code [USAGE]} must reach the
 * webview with the context-window reading (prompt input — Qwen Code counts cache
 * inside input, never output), end of turn must re-push that snapshot, and a round
 * without usage must fall back to the CLI's own context snapshot instead of leaving
 * the ring frozen.
 */
public class QwenMessageHandlerUsageTest {

    /** input 1000 is the full prompt (cache_read 200 counted inside it); output/thought are NOT context. */
    private static final String USAGE_JSON =
            "{\"input_tokens\":1000,\"output_tokens\":500,\"thought_tokens\":50,"
                    + "\"cached_read_tokens\":200,\"total_tokens\":1750}";

    /** Qwen Code input is cache-inclusive: context = 1000, never 1000 + 200. */
    private static final int EXPECTED_CONTEXT_TOKENS = 1000;

    /** Suffix [500k] drives the static window; the odd name keeps user config out of it. */
    private static final String TEST_MODEL = "usage-test-model[500k]";
    private static final int EXPECTED_MAX_TOKENS = 500_000;

    private final RecordingCallback callback = new RecordingCallback();

    private SessionState newState() {
        SessionState state = new SessionState();
        state.setProvider("qwen");
        state.setModel(TEST_MODEL);
        state.setCwd("C:\\usage-test");
        return state;
    }

    private CallbackHandler newCallbackHandler() {
        CallbackHandler handler = new CallbackHandler();
        handler.setCallback(callback);
        return handler;
    }

    @Test
    public void usageEventPushesContextTokensInsteadOfTotal() {
        QwenMessageHandler handler =
                new QwenMessageHandler(newState(), newCallbackHandler());

        handler.onMessage("stream_start", "");
        handler.onMessage("usage", USAGE_JSON);

        assertEquals("one ring push per [USAGE] event", 1, callback.usageUpdates.size());
        UsagePush push = callback.usageUpdates.get(0);
        assertEquals("context window counts the prompt input alone",
                EXPECTED_CONTEXT_TOKENS, push.usedTokens);
        assertEquals(EXPECTED_MAX_TOKENS, push.maxTokens);
    }

    @Test
    public void streamEndRePushesTheStoredUsageSnapshot() {
        QwenMessageHandler handler =
                new QwenMessageHandler(newState(), newCallbackHandler());

        handler.onMessage("stream_start", "");
        handler.onMessage("usage", USAGE_JSON);
        callback.usageUpdates.clear();

        handler.onMessage("stream_end", "");

        assertEquals("stream_end must refresh the ring from the stored snapshot",
                1, callback.usageUpdates.size());
        assertEquals(EXPECTED_CONTEXT_TOKENS, callback.usageUpdates.get(0).usedTokens);
    }

    @Test
    public void streamEndFallsBackToTheCliContextSnapshot() {
        JsonObject snapshot = new JsonObject();
        snapshot.addProperty("success", true);
        snapshot.addProperty("totalTokens", 300_000);
        snapshot.addProperty("maxTokens", 700_000);
        QwenMessageHandler handler =
                new QwenMessageHandler(newState(), newCallbackHandler(), new SnapshotBridge(snapshot));

        // No [USAGE] in this session — the fallback is the only thing that can move the ring.
        handler.onMessage("stream_start", "");
        handler.onMessage("stream_end", "");

        assertEquals("CLI snapshot must push instead of leaving the ring behind",
                1, callback.usageUpdates.size());
        assertEquals(300_000, callback.usageUpdates.get(0).usedTokens);
        assertEquals(700_000, callback.usageUpdates.get(0).maxTokens);
    }

    @Test
    public void streamEndWithoutBridgeLeavesTheRingUntouched() {
        QwenMessageHandler handler = new QwenMessageHandler(newState(), newCallbackHandler());

        handler.onMessage("stream_start", "");
        handler.onMessage("stream_end", "");

        assertTrue("no usage data means no push — never a zeroing of the ring",
                callback.usageUpdates.isEmpty());
    }

    @Test
    public void resultUsageIsRecordedForCostButNeverMovesTheRing() {
        SessionState state = newState();
        QwenMessageHandler handler = new QwenMessageHandler(state, newCallbackHandler());

        handler.onMessage("stream_start", "");
        handler.onMessage("usage", USAGE_JSON);
        callback.usageUpdates.clear();

        // The result envelope carries session-cumulative usage across every round.
        handler.onMessage("result",
                "{\"usage\":{\"input_tokens\":9000000,\"output_tokens\":1,\"total_tokens\":9000001}}");

        assertTrue("cumulative usage must not be pushed as context occupancy",
                callback.usageUpdates.isEmpty());
        QwenMateSession.Message last = lastAssistantMessage(state);
        assertNotNull(last);
        assertNotNull("usage stays on the message for cost accounting",
                last.raw.get("turnUsage"));
    }

    private QwenMateSession.Message lastAssistantMessage(SessionState state) {
        List<QwenMateSession.Message> messages = state.getMessages();
        for (int i = messages.size() - 1; i >= 0; i--) {
            if (messages.get(i).type == QwenMateSession.Message.Type.ASSISTANT) {
                return messages.get(i);
            }
        }
        return null;
    }

    /** Bridge stub that answers the context-snapshot query with a fixed payload. */
    private static final class SnapshotBridge extends QwenSDKBridge {
        private final JsonObject snapshot;

        private SnapshotBridge(JsonObject snapshot) {
            this.snapshot = snapshot;
        }

        @Override
        public CompletableFuture<JsonObject> getContextUsage(String sessionId, String cwd, String model) {
            return CompletableFuture.completedFuture(snapshot);
        }
    }

    /** Records only the ring pushes; everything else is a no-op. */
    private static final class RecordingCallback implements QwenMateSession.SessionCallback {
        private final List<UsagePush> usageUpdates = new ArrayList<>();

        @Override
        public void onUsageUpdate(int usedTokens, int maxTokens) {
            usageUpdates.add(new UsagePush(usedTokens, maxTokens));
        }

        @Override
        public void onMessageUpdate(List<QwenMateSession.Message> messages) {
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
    }

    private static final class UsagePush {
        private final int usedTokens;
        private final int maxTokens;

        private UsagePush(int usedTokens, int maxTokens) {
            this.usedTokens = usedTokens;
            this.maxTokens = maxTokens;
        }
    }
}
