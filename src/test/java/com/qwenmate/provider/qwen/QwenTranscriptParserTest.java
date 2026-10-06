package com.qwenmate.provider.qwen;

import com.qwenmate.util.UsageCostCalculator;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for the qwen transcript parser: format variants, tolerant parsing
 * and the message shape used by the live QwenMessageHandler.
 */
public class QwenTranscriptParserTest {

    private static final String USER_RECORD =
            "{\"uuid\":\"u0\",\"parentUuid\":null,\"sessionId\":\"s1\","
                    + "\"timestamp\":\"2026-09-28T09:20:00.684Z\",\"type\":\"user\",\"provenance\":\"real_user\","
                    + "\"cwd\":\"D:/proj\",\"version\":\"0.24.3\","
                    + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"hello\"}]}}";

    private static final String ASSISTANT_RECORD =
            "{\"uuid\":\"u1\",\"parentUuid\":\"u0\",\"sessionId\":\"s1\","
                    + "\"timestamp\":\"2026-09-28T09:20:03.723Z\",\"type\":\"assistant\",\"provenance\":\"assistant_output\","
                    + "\"cwd\":\"D:/proj\",\"version\":\"0.24.3\",\"model\":\"test-model\","
                    + "\"message\":{\"role\":\"model\",\"parts\":["
                    + "{\"text\":\"think hard\",\"thought\":true},"
                    + "{\"text\":\"the answer\"},"
                    + "{\"functionCall\":{\"id\":\"call_1\",\"name\":\"Read\",\"args\":{\"path\":\"a.txt\"}}}]},"
                    + "\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":10,"
                    + "\"thoughtsTokenCount\":5,\"cachedContentTokenCount\":7,\"totalTokenCount\":115},"
                    + "\"contextWindowSize\":1000000}";

    private static final String TOOL_RESULT_RECORD =
            "{\"uuid\":\"u2\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                    + "\"timestamp\":\"2026-09-28T09:20:04.000Z\",\"type\":\"tool_result\",\"provenance\":\"tool_result\","
                    + "\"message\":{\"role\":\"user\",\"parts\":["
                    + "{\"functionResponse\":{\"id\":\"call_1\",\"name\":\"Read\",\"response\":{\"output\":\"file text\"}}}]},"
                    + "\"toolCallResult\":{\"status\":\"success\",\"result\":\"file text\"}}";

    private static QwenTranscriptParser.ParsedSession parse(String... lines) {
        return QwenTranscriptParser.parseLines(Arrays.asList(lines));
    }

    private static JsonObject messageAt(QwenTranscriptParser.ParsedSession session, int index) {
        return session.messages.get(index);
    }

    @Test
    public void convertsUserAssistantAndToolResultRecordsToLiveShapes() {
        QwenTranscriptParser.ParsedSession session = parse(USER_RECORD, ASSISTANT_RECORD, TOOL_RESULT_RECORD);

        assertEquals(3, session.messages.size());

        JsonObject expectedUser = JsonParser.parseString(
                "{\"type\":\"user\",\"uuid\":\"u0\",\"timestamp\":\"2026-09-28T09:20:00.684Z\","
                        + "\"session_id\":\"s1\",\"parent_tool_use_id\":null,"
                        + "\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}"
        ).getAsJsonObject();
        assertEquals(expectedUser, messageAt(session, 0));

        JsonObject expectedAssistant = JsonParser.parseString(
                "{\"type\":\"assistant\",\"uuid\":\"u1\",\"timestamp\":\"2026-09-28T09:20:03.723Z\","
                        + "\"message\":{\"role\":\"assistant\",\"content\":["
                        + "{\"type\":\"thinking\",\"thinking\":\"think hard\"},"
                        + "{\"type\":\"text\",\"text\":\"the answer\"},"
                        + "{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"Read\",\"input\":{\"path\":\"a.txt\"}}],"
                        + "\"usage\":{\"input_tokens\":100,\"output_tokens\":10,\"thought_tokens\":5,"
                        + "\"cached_read_tokens\":7,\"total_tokens\":115}},"
                        + "\"turnUsage\":{\"input_tokens\":100,\"output_tokens\":10,\"thought_tokens\":5,"
                        + "\"cached_read_tokens\":7,\"total_tokens\":115}}"
        ).getAsJsonObject();
        JsonObject actualAssistant = messageAt(session, 1).deepCopy();
        assertTrue("history assistant must carry a per-turn cost", actualAssistant.has("turnCostUsd"));
        double actualCost = actualAssistant.get("turnCostUsd").getAsDouble();
        actualAssistant.remove("turnCostUsd");
        assertEquals(expectedAssistant, actualAssistant);
        assertEquals(
                UsageCostCalculator.calculateTurnCostUsd(
                        "qwen", expectedAssistant.getAsJsonObject("turnUsage"), "test-model"),
                actualCost,
                1e-9);

        JsonObject expectedToolResult = JsonParser.parseString(
                "{\"type\":\"user\",\"uuid\":\"u2\",\"timestamp\":\"2026-09-28T09:20:04.000Z\","
                        + "\"message\":{\"content\":["
                        + "{\"type\":\"tool_result\",\"tool_use_id\":\"call_1\","
                        + "\"content\":\"{\\\"output\\\":\\\"file text\\\"}\",\"is_error\":false}]},"
                        + "\"toolUseResult\":{\"status\":\"success\",\"result\":\"file text\"}}"
        ).getAsJsonObject();
        assertEquals(expectedToolResult, messageAt(session, 2));
    }

    @Test
    public void normalizesUsageMetadataToCanonicalSnakeCase() {
        JsonObject record = JsonParser.parseString(ASSISTANT_RECORD).getAsJsonObject();

        JsonObject usage = QwenTranscriptParser.normalizeUsage(record);

        assertEquals(100, usage.get("input_tokens").getAsInt());
        assertEquals(10, usage.get("output_tokens").getAsInt());
        assertEquals(5, usage.get("thought_tokens").getAsInt());
        assertEquals(7, usage.get("cached_read_tokens").getAsInt());
        assertEquals(115, usage.get("total_tokens").getAsInt());
    }

    @Test
    public void thoughtFlagProducesThinkingBlock() {
        QwenTranscriptParser.ParsedSession session = parse(ASSISTANT_RECORD);

        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        assertEquals("thinking", blocks.get(0).getAsJsonObject().get("type").getAsString());
        assertEquals("think hard", blocks.get(0).getAsJsonObject().get("thinking").getAsString());
    }

    @Test
    public void derivesTitleFromFirstUserPrompt() {
        QwenTranscriptParser.ParsedSession session = parse(USER_RECORD, ASSISTANT_RECORD);

        assertEquals("hello", session.title);
        assertNull(session.customTitle);
        assertEquals("test-model", session.model);
    }

    @Test
    public void truncatesLongTitlesToTwoHundredChars() {
        String longPrompt = "x".repeat(260);
        String record = "{\"uuid\":\"u0\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.684Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"" + longPrompt + "\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        assertEquals(201, session.title.length());
        assertTrue(session.title.endsWith("…"));
    }

    @Test
    public void prefersLastCustomTitleRecord() {
        String customTitle = "{\"uuid\":\"t1\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:21:00.000Z\",\"type\":\"system\",\"subtype\":\"custom_title\","
                + "\"systemPayload\":{\"customTitle\":\"我的会话\",\"titleSource\":\"manual\"}}";

        QwenTranscriptParser.ParsedSession session = parse(USER_RECORD, customTitle);

        assertEquals("我的会话", session.title);
        assertEquals("我的会话", session.customTitle);
    }

    @Test
    public void harvestsModelAndEntrypointFromSystemRecords() {
        String sessionModel = "{\"uuid\":\"m1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"system\",\"subtype\":\"session_model\","
                + "\"systemPayload\":{\"modelId\":\"qwen3-coder-plus\",\"authType\":\"qwen-oauth\"}}";
        String sessionSource = "{\"uuid\":\"src1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"system\",\"subtype\":\"session_source\","
                + "\"systemPayload\":{\"sourceType\":\"sdk-cli\",\"sourceId\":\"plugin\"}}";

        QwenTranscriptParser.ParsedSession session = parse(sessionModel, sessionSource, USER_RECORD);

        assertEquals("qwen3-coder-plus", session.model);
        assertEquals("sdk-cli", session.entrypoint);
    }

    @Test
    public void skipsSystemRecordsAndMalformedLines() {
        String telemetry = "{\"uuid\":\"x1\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:05.000Z\",\"type\":\"system\",\"subtype\":\"ui_telemetry\","
                + "\"systemPayload\":{\"uiEvent\":{\"event.name\":\"qwen-code.api_response\"}}}";
        String tornTail = "{\"uuid\":\"u3\",\"parentUuid\":\"u2\",\"sessionId\":\"s1\",\"type\":\"user\",\"messa";

        QwenTranscriptParser.ParsedSession session =
                parse(USER_RECORD, telemetry, tornTail, "", "not json at all", ASSISTANT_RECORD);

        assertEquals(2, session.messages.size());
        assertEquals("user", messageAt(session, 0).get("type").getAsString());
        assertEquals("assistant", messageAt(session, 1).get("type").getAsString());
    }

    @Test
    public void emptyInputYieldsEmptySession() {
        QwenTranscriptParser.ParsedSession session = QwenTranscriptParser.parseLines(new ArrayList<>());

        assertTrue(session.messages.isEmpty());
        assertNull(session.title);
        assertEquals("", session.entrypoint);
        assertEquals(0L, session.firstTimestamp);
        assertEquals(0L, session.lastTimestamp);
    }

    @Test
    public void aggregatesFragmentedRecordsSharingUuid() {
        String fragmentA = "{\"uuid\":\"f1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"hel\"}]}}";
        String fragmentB = "{\"uuid\":\"f1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.500Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"lo\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(fragmentA, fragmentB);

        assertEquals(1, session.messages.size());
        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        assertEquals(2, blocks.size());
        assertEquals("hel", blocks.get(0).getAsJsonObject().get("text").getAsString());
        assertEquals("lo", blocks.get(1).getAsJsonObject().get("text").getAsString());
    }

    @Test
    public void followsParentChainThroughSystemRecords() {
        // Real transcripts thread attribution/telemetry system rows into the chain.
        String user = "{\"uuid\":\"u0\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"hello\"}]}}";
        String systemRow = "{\"uuid\":\"sys1\",\"parentUuid\":\"u0\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.100Z\",\"type\":\"system\",\"subtype\":\"ui_telemetry\","
                + "\"systemPayload\":{\"uiEvent\":{\"event.name\":\"qwen-code.api_response\"}}}";
        String assistant = "{\"uuid\":\"u1\",\"parentUuid\":\"sys1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:03.000Z\",\"type\":\"assistant\","
                + "\"message\":{\"role\":\"model\",\"parts\":[{\"text\":\"hi\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(user, systemRow, assistant);

        assertEquals(2, session.messages.size());
        assertEquals("user", messageAt(session, 0).get("type").getAsString());
        assertEquals("assistant", messageAt(session, 1).get("type").getAsString());
    }

    @Test
    public void followsParentChainAndDropsRewoundBranches() {
        String first = USER_RECORD;
        String reply = ASSISTANT_RECORD;
        String rewoundTurn = "{\"uuid\":\"u2\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:21:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"second\"}]}}";
        String rewoundReply = "{\"uuid\":\"u3\",\"parentUuid\":\"u2\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:21:05.000Z\",\"type\":\"assistant\","
                + "\"message\":{\"role\":\"model\",\"parts\":[{\"text\":\"reply-2\"}]}}";
        String rewoundLeaf = "{\"uuid\":\"u4\",\"parentUuid\":\"u0\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:22:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"second-again\"}]}}";

        QwenTranscriptParser.ParsedSession session =
                parse(first, reply, rewoundTurn, rewoundReply, rewoundLeaf);

        assertEquals(2, session.messages.size());
        assertEquals("hello", messageAt(session, 0).getAsJsonObject("message")
                .getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString());
        assertEquals("second-again", messageAt(session, 1).getAsJsonObject("message")
                .getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString());
    }

    @Test
    public void fallsBackToFileOrderWhenRecordsLackUuid() {
        String legacy = "{\"type\":\"user\",\"timestamp\":\"2026-09-28T09:20:00.000Z\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"legacy prompt\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(legacy, USER_RECORD);

        assertEquals(2, session.messages.size());
    }

    @Test
    public void projectsHookProvenanceToDisplayText() {
        String record = "{\"uuid\":\"h1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"systemPayload\":{\"hookContext\":\"UserPromptSubmit\",\"displayText\":\"visible text\"},"
                + "\"message\":{\"role\":\"user\",\"parts\":["
                + "{\"text\":\"model facing context\"},"
                + "{\"text\":\"<qwen:user-prompt-submit-context>\\nCTX\\n</qwen:user-prompt-submit-context>\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        assertEquals(1, session.messages.size());
        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        assertEquals(1, blocks.size());
        assertEquals("visible text", blocks.get(0).getAsJsonObject().get("text").getAsString());
    }

    @Test
    public void dropsTrailingHookContextWrapperWithoutProvenance() {
        String record = "{\"uuid\":\"h2\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":["
                + "{\"text\":\"the real question\"},"
                + "{\"text\":\"<qwen:user-prompt-submit-context>\\nCTX\\n</qwen:user-prompt-submit-context>\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        assertEquals(1, blocks.size());
        assertEquals("the real question", blocks.get(0).getAsJsonObject().get("text").getAsString());
    }

    @Test
    public void convertsInlineDataToImageBlock() {
        String record = "{\"uuid\":\"i1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":["
                + "{\"inlineData\":{\"mimeType\":\"image/png\",\"data\":\"AAAA\"}}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        JsonObject image = blocks.get(0).getAsJsonObject();
        assertEquals("image", image.get("type").getAsString());
        assertEquals("data:image/png;base64,AAAA", image.get("src").getAsString());
        assertEquals("image/png", image.get("mediaType").getAsString());
    }

    @Test
    public void supportsClaudeShapedContentBlocksFormatVariant() {
        String record = "{\"uuid\":\"c1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hi there\"}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        JsonArray blocks = messageAt(session, 0).getAsJsonObject("message").getAsJsonArray("content");
        assertEquals("hi there", blocks.get(0).getAsJsonObject().get("text").getAsString());
    }

    @Test
    public void toolResultErrorStatusMapsToIsError() {
        String record = "{\"uuid\":\"e1\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:04.000Z\",\"type\":\"tool_result\","
                + "\"message\":{\"role\":\"user\",\"parts\":["
                + "{\"functionResponse\":{\"id\":\"call_9\",\"name\":\"Bash\",\"response\":\"boom\"}}]},"
                + "\"toolCallResult\":{\"status\":\"error\"}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        JsonObject block = messageAt(session, 0).getAsJsonObject("message")
                .getAsJsonArray("content").get(0).getAsJsonObject();
        assertEquals("tool_result", block.get("type").getAsString());
        assertEquals("call_9", block.get("tool_use_id").getAsString());
        assertEquals("boom", block.get("content").getAsString());
        assertTrue(block.get("is_error").getAsBoolean());
    }

    @Test
    public void emitsOneToolResultMessagePerFunctionResponse() {
        String record = "{\"uuid\":\"m1\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:04.000Z\",\"type\":\"tool_result\","
                + "\"message\":{\"role\":\"user\",\"parts\":["
                + "{\"functionResponse\":{\"id\":\"call_a\",\"name\":\"Read\",\"response\":\"a\"}},"
                + "{\"functionResponse\":{\"id\":\"call_b\",\"name\":\"Read\",\"response\":\"b\"}}]}}";

        QwenTranscriptParser.ParsedSession session = parse(record);

        assertEquals(2, session.messages.size());
        assertEquals("call_a", messageAt(session, 0).getAsJsonObject("message")
                .getAsJsonArray("content").get(0).getAsJsonObject().get("tool_use_id").getAsString());
        assertEquals("call_b", messageAt(session, 1).getAsJsonObject("message")
                .getAsJsonArray("content").get(0).getAsJsonObject().get("tool_use_id").getAsString());
    }

    @Test
    public void keepsSidechainRecordsOnlyWhenRequested() {
        String sidechain = "{\"uuid\":\"sc1\",\"parentUuid\":null,\"sessionId\":\"s1\","
                + "\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\",\"isSidechain\":true,"
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"subagent prompt\"}]}}";

        QwenTranscriptParser.ParsedSession dropped = parse(sidechain);
        QwenTranscriptParser.ParsedSession kept = QwenTranscriptParser.parseLines(List.of(sidechain), true);

        assertTrue(dropped.messages.isEmpty());
        assertEquals(1, kept.messages.size());
    }

    @Test
    public void dirtyRecordsNeverThrow() {
        String badUsage = "{\"uuid\":\"b1\",\"parentUuid\":null,\"sessionId\":\"s1\",\"type\":\"assistant\","
                + "\"message\":{\"role\":\"model\",\"parts\":[{\"text\":\"ok\"}]},"
                + "\"usageMetadata\":{\"promptTokenCount\":\"NaN\"},\"isSidechain\":\"maybe\"}";
        String weirdParts = "{\"uuid\":\"b2\",\"parentUuid\":\"b1\",\"sessionId\":\"s1\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[42,true,{\"unknown\":{\"x\":1}}]}}";

        QwenTranscriptParser.ParsedSession session = parse(badUsage, weirdParts);

        assertEquals(1, session.messages.size());
        assertFalse(messageAt(session, 0).has("turnUsage"));
    }

    @Test
    public void projectKeyCandidatesMatchQwenSanitizeCwd() {
        List<String> keys = QwenHistoryReader.projectKeyCandidates("D:\\Code\\Java\\jetbrains-qc-gui");

        assertTrue(keys.contains("d--code-java-jetbrains-qc-gui"));
        // Case-preserving variant keeps transcripts written on case-sensitive hosts reachable.
        assertTrue(keys.contains("D--Code-Java-jetbrains-qc-gui"));
    }

    @Test
    public void projectHashMatchesSha256OfLowercasedPath() {
        // Verified against the real ~/.qwen/tmp layout written by qwen-code on this machine.
        assertEquals(
                "a568800a410b14456088b56be93a5c48ed8467775ff9627a9b8ce722f6e906e9",
                QwenHistoryReader.projectHash("D:\\Code\\Java\\jetbrains-qc-gui"));
    }
}
