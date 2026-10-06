package com.qwenmate.handler.history;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.session.QwenMateSession;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.project.Project;
import org.junit.Test;

import java.util.List;
import java.lang.reflect.Proxy;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for history loading, message hydration, and payload batching.
 */
public class HistoryMessageInjectorTest {

    @Test
    public void handleLoadSessionUsesPayloadProviderRegardlessOfCurrentProvider() {
        RecordingHistoryMessageInjector injector = new RecordingHistoryMessageInjector(createContext("D:/project/demo"));
        String[] callbackArgs = new String[4];

        injector.handleLoadSession(
                "{\"sessionId\":\"hist-qwen\",\"provider\":\"qwen\",\"model\":\"qwen3-max\"}",
                "alt",
                (sessionId, projectPath, provider, model) -> {
                    callbackArgs[0] = sessionId;
                    callbackArgs[1] = projectPath;
                    callbackArgs[2] = provider;
                    callbackArgs[3] = model;
                }
        );

        assertEquals("hist-qwen", callbackArgs[0]);
        assertEquals("D:/project/demo", callbackArgs[1]);
        assertEquals("qwen", callbackArgs[2]);
        assertEquals("qwen3-max", callbackArgs[3]);
    }

    @Test
    public void handleLoadSessionCompletesHistoryLoadWhenProjectPathMissing() {
        RecordingHistoryMessageInjector injector = new RecordingHistoryMessageInjector(createContext(null));
        boolean[] callbackInvoked = {false};

        injector.handleLoadSession(
                "{\"sessionId\":\"hist-alt\",\"provider\":\"alt\"}",
                "qwen",
                (sessionId, projectPath, provider, model) -> callbackInvoked[0] = true
        );

        assertFalse(callbackInvoked[0]);
        assertEquals(1, injector.historyLoadCompleteCount);
    }

    @Test
    public void handleLoadSessionCompletesHistoryLoadWhenCallbackMissing() {
        RecordingHistoryMessageInjector injector = new RecordingHistoryMessageInjector(createContext("D:/project/demo"));

        injector.handleLoadSession(
                "{\"sessionId\":\"hist-qwen\",\"provider\":\"qwen\"}",
                "alt",
                null
        );

        assertEquals(1, injector.historyLoadCompleteCount);
    }

    @Test
    public void restoresIsoTimestampWhenHydratingMessagesIntoSessionState() {
        JsonObject frontendMessage = frontendMessage("assistant", "done", "text");
        frontendMessage.addProperty("timestamp", "2026-07-28T12:50:07.123Z");

        QwenMateSession.Message restored = HistoryMessageInjector.toSessionMessage(frontendMessage);

        assertEquals(1785243007123L, restored.timestamp);
    }

    @Test
    public void restoresNumericStringTimestampWhenHydratingSessionState() {
        JsonObject frontendMessage = frontendMessage("user", "hello", "text");
        frontendMessage.addProperty("timestamp", "1785243007123");

        QwenMateSession.Message restored = HistoryMessageInjector.toSessionMessage(frontendMessage);

        assertEquals(1785243007123L, restored.timestamp);
    }

    @Test
    public void partitionsHistoryByMessageCountAndTargetPayloadSize() {
        List<JsonObject> messages = new java.util.ArrayList<>();
        for (int i = 0; i < 120; i++) {
            messages.add(frontendMessage(
                    i % 2 == 0 ? "user" : "assistant",
                    "message-" + i + "-" + "x".repeat(4000),
                    "text"));
        }

        List<List<JsonObject>> batches = HistoryMessageInjector.partitionHistoryMessages(messages);

        assertTrue(batches.size() > 2);
        assertEquals(120, batches.stream().mapToInt(List::size).sum());
        for (List<JsonObject> batch : batches) {
            assertTrue(batch.size() <= HistoryMessageInjector.HISTORY_BATCH_MESSAGE_LIMIT);
            assertTrue(com.qwenmate.util.JsUtils.escapeJs(
                    new com.google.gson.Gson().toJson(batch)).length()
                    <= HistoryMessageInjector.HISTORY_BATCH_TARGET_CHAR_LIMIT);
        }
    }

    @Test
    public void oversizedSingleMessageIsNotDroppedByPartitioning() {
        JsonObject oversized = frontendMessage(
                "user",
                "x".repeat(HistoryMessageInjector.HISTORY_BATCH_TARGET_CHAR_LIMIT + 1),
                "text");

        List<List<JsonObject>> batches = HistoryMessageInjector.partitionHistoryMessages(List.of(oversized));

        assertEquals(1, batches.size());
        assertEquals(1, batches.get(0).size());
        assertEquals(oversized, batches.get(0).get(0));

        String payload = new com.google.gson.Gson().toJson(batches.get(0));
        List<String> chunks = HistoryMessageInjector.splitHistoryPayload(payload);
        assertTrue(chunks.size() > 1);
        assertEquals(payload, String.join("", chunks));
        for (String chunk : chunks) {
            assertTrue(com.qwenmate.util.JsUtils.escapeJs(chunk).length()
                    <= HistoryMessageInjector.HISTORY_BATCH_TARGET_CHAR_LIMIT);
        }
    }

    @Test
    public void payloadChunksPreserveUnicodeAndStayWithinEscapedLimit() {
        String payload = ("\u2028😃</script>'\"\\").repeat(20_000);

        List<String> chunks = HistoryMessageInjector.splitHistoryPayload(payload);

        assertTrue(chunks.size() > 1);
        assertEquals(payload, String.join("", chunks));
        for (String chunk : chunks) {
            assertTrue(com.qwenmate.util.JsUtils.escapeJs(chunk).length()
                    <= HistoryMessageInjector.HISTORY_BATCH_TARGET_CHAR_LIMIT);
            if (!chunk.isEmpty()) {
                assertFalse(Character.isHighSurrogate(chunk.charAt(chunk.length() - 1)));
                assertFalse(Character.isLowSurrogate(chunk.charAt(0)));
            }
        }
    }

    private static JsonObject frontendMessage(String type, String content, String blockType) {
        JsonObject message = new JsonObject();
        message.addProperty("type", type);
        message.addProperty("content", content);
        JsonObject raw = new JsonObject();
        JsonArray blocks = new JsonArray();
        JsonObject block = new JsonObject();
        block.addProperty("type", blockType);
        blocks.add(block);
        raw.add("content", blocks);
        message.add("raw", raw);
        return message;
    }

    private static HandlerContext createContext(String basePath) {
        Project project = (Project) Proxy.newProxyInstance(
                HistoryMessageInjectorTest.class.getClassLoader(),
                new Class[]{Project.class},
                (proxy, method, args) -> {
                    if ("getBasePath".equals(method.getName())) {
                        return basePath;
                    }
                    if ("isDisposed".equals(method.getName())) {
                        return false;
                    }
                    Class<?> returnType = method.getReturnType();
                    if (returnType.equals(boolean.class)) {
                        return false;
                    }
                    if (returnType.equals(int.class)) {
                        return 0;
                    }
                    if (returnType.equals(long.class)) {
                        return 0L;
                    }
                    return null;
                }
        );

        return new HandlerContext(project, null, null, new HandlerContext.JsCallback() {
            @Override
            public void callJavaScript(String functionName, String... args) {
            }

            @Override
            public String escapeJs(String str) {
                return str;
            }
        });
    }

    private static final class RecordingHistoryMessageInjector extends HistoryMessageInjector {
        private int historyLoadCompleteCount;

        private RecordingHistoryMessageInjector(HandlerContext context) {
            super(context);
        }

        @Override
        void notifyHistoryLoadComplete() {
            historyLoadCompleteCount++;
        }
    }
}
