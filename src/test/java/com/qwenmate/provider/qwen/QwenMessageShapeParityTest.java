package com.qwenmate.provider.qwen;

import com.qwenmate.session.QwenMateSession;
import com.qwenmate.session.CallbackHandler;
import com.qwenmate.session.MessageParser;
import com.qwenmate.session.QwenMessageHandler;
import com.qwenmate.session.SessionState;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Locks the message shape of qwen history restore against the live streaming
 * pipeline: whatever {@link QwenMessageHandler} builds from ai-bridge markers
 * must match what {@link QwenTranscriptParser} rebuilds from the transcript,
 * so a restored session renders identically to a live one.
 */
public class QwenMessageShapeParityTest {

    private static final String USAGE_JSON =
            "{\"input_tokens\":100,\"output_tokens\":10,\"thought_tokens\":5,"
                    + "\"cached_read_tokens\":7,\"total_tokens\":115}";

    private static final String USER_EVENT =
            "{\"type\":\"user\",\"session_id\":\"parity-1\",\"parent_tool_use_id\":null,"
                    + "\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}";

    private static final String TOOL_USE_EVENT =
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":["
                    + "{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"Read\",\"input\":{\"path\":\"a.txt\"}}]}}";

    private static final String TOOL_RESULT_EVENT =
            "{\"type\":\"tool_result\",\"tool_use_id\":\"call_1\",\"content\":\"file text\",\"is_error\":false}";

    private static final String USER_RECORD =
            "{\"uuid\":\"u0\",\"parentUuid\":null,\"sessionId\":\"parity-1\","
                    + "\"timestamp\":\"2026-09-28T09:20:00.684Z\",\"type\":\"user\","
                    + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"hello\"}]}}";

    private static final String ASSISTANT_RECORD =
            "{\"uuid\":\"u1\",\"parentUuid\":\"u0\",\"sessionId\":\"parity-1\","
                    + "\"timestamp\":\"2026-09-28T09:20:03.723Z\",\"type\":\"assistant\",\"model\":\"parity-model\","
                    + "\"message\":{\"role\":\"model\",\"parts\":["
                    + "{\"text\":\"think hard\",\"thought\":true},"
                    + "{\"text\":\"the answer\"},"
                    + "{\"functionCall\":{\"id\":\"call_1\",\"name\":\"Read\",\"args\":{\"path\":\"a.txt\"}}}]},"
                    + "\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":10,"
                    + "\"thoughtsTokenCount\":5,\"cachedContentTokenCount\":7,\"totalTokenCount\":115}}";

    private static final String TOOL_RESULT_RECORD =
            "{\"uuid\":\"u2\",\"parentUuid\":\"u1\",\"sessionId\":\"parity-1\","
                    + "\"timestamp\":\"2026-09-28T09:20:04.000Z\",\"type\":\"tool_result\","
                    + "\"message\":{\"role\":\"user\",\"parts\":["
                    + "{\"functionResponse\":{\"id\":\"call_1\",\"name\":\"Read\",\"response\":\"file text\"}}]}}";

    @Test
    public void restoredMessagesMatchLiveHandlerOutput() {
        SessionState state = new SessionState();
        state.setModel("parity-model");
        QwenMessageHandler handler = new QwenMessageHandler(state, new CallbackHandler());

        // Send-time user bubble, patched by the live user echo (SessionSendService flow).
        QwenMateSession.Message sendTimeUser =
                new QwenMateSession.Message(QwenMateSession.Message.Type.USER, "hello");
        state.addMessage(sendTimeUser);

        handler.onMessage("user", USER_EVENT);
        handler.onMessage("stream_start", "");
        handler.onMessage("thinking_delta", "think hard");
        handler.onMessage("content_delta", "the answer");
        handler.onMessage("assistant",
                "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\","
                        + "\"content\":[{\"type\":\"text\",\"text\":\"the answer\"}]}}");
        handler.onMessage("tool_use", TOOL_USE_EVENT);
        handler.onMessage("usage", USAGE_JSON);
        handler.onMessage("result", "{\"usage\":" + USAGE_JSON + "}");
        handler.onMessage("message_end", "");
        handler.onMessage("stream_end", "");
        handler.onMessage("tool_result", TOOL_RESULT_EVENT);

        List<QwenMateSession.Message> liveMessages = state.getMessages();
        QwenTranscriptParser.ParsedSession restored =
                QwenTranscriptParser.parseLines(List.of(USER_RECORD, ASSISTANT_RECORD, TOOL_RESULT_RECORD));

        assertEquals("live and restored transcripts must have the same length",
                liveMessages.size(), restored.messages.size());
        for (int i = 0; i < liveMessages.size(); i++) {
            JsonObject liveRaw = liveMessages.get(i).raw;
            JsonObject restoredRaw = restored.messages.get(i);
            assertNotNull("live message " + i + " must carry raw data", liveRaw);

            assertEquals(liveRaw.get("type"), restoredRaw.get("type"));
            assertEquals("message payload must match at index " + i,
                    liveRaw.getAsJsonObject("message"), restoredRaw.getAsJsonObject("message"));
            if (restoredRaw.has("turnUsage") || liveRaw.has("turnUsage")) {
                assertEquals("turnUsage must match at index " + i,
                        liveRaw.get("turnUsage"), restoredRaw.get("turnUsage"));
                assertEquals("turnCostUsd must match at index " + i,
                        liveRaw.get("turnCostUsd"), restoredRaw.get("turnCostUsd"));
            }

            // History records keep transcript identity for dedupe/boundaries; the
            // live stream has no uuid/timestamp envelope — everything else matches.
            assertTrue("history message " + i + " carries a uuid", restoredRaw.has("uuid"));
            assertTrue("history message " + i + " carries a timestamp", restoredRaw.has("timestamp"));
            assertFalse("live message " + i + " has no uuid envelope", liveRaw.has("uuid"));
        }
    }

    @Test
    public void restoredAssistantKeepsToolUseThinkingAndUsageTogether() {
        QwenTranscriptParser.ParsedSession restored = QwenTranscriptParser.parseLines(List.of(ASSISTANT_RECORD));

        JsonObject raw = restored.messages.get(0);
        assertEquals("assistant", raw.get("type").getAsString());
        JsonObject message = raw.getAsJsonObject("message");
        assertEquals("assistant", message.get("role").getAsString());
        assertEquals("thinking", message.getAsJsonArray("content").get(0).getAsJsonObject().get("type").getAsString());
        assertEquals("text", message.getAsJsonArray("content").get(1).getAsJsonObject().get("type").getAsString());
        assertEquals("tool_use", message.getAsJsonArray("content").get(2).getAsJsonObject().get("type").getAsString());
        assertEquals(115, message.getAsJsonObject("usage").get("total_tokens").getAsInt());
    }

    @Test
    public void restoredToolResultRoundTripsThroughMessageParser() {
        QwenTranscriptParser.ParsedSession restored =
                QwenTranscriptParser.parseLines(List.of(USER_RECORD, ASSISTANT_RECORD, TOOL_RESULT_RECORD));

        MessageParser parser = new MessageParser();
        QwenMateSession.Message toolResultMessage = parser.parseServerMessage(restored.messages.get(2));

        assertEquals(QwenMateSession.Message.Type.USER, toolResultMessage.type);
        assertEquals("[tool_result]", toolResultMessage.content);
    }
}
