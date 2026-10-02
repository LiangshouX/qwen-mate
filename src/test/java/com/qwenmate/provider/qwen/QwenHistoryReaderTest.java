package com.qwenmate.provider.qwen;

import com.qwenmate.cache.SessionIndexCache;
import com.qwenmate.cache.SessionIndexManager;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for the qwen history reader: session listing, turn-aligned disk
 * pagination boundaries, restore, delete and tolerant handling of dirty data.
 */
public class QwenHistoryReaderTest {

    private Path tempRoot;
    private Path projectPath;
    private Path chatsDir;
    private String projectKey;
    private QwenHistoryReader reader;

    @Before
    public void setUp() throws IOException {
        tempRoot = Files.createTempDirectory("qwen-history-reader-test");
        projectPath = tempRoot.resolve("project");
        Files.createDirectories(projectPath);
        projectKey = QwenHistoryReader.projectKeyCandidates(projectPath.toString()).get(0);
        chatsDir = tempRoot.resolve(".qwen").resolve("projects").resolve(projectKey).resolve("chats");
        Files.createDirectories(chatsDir);
        reader = new QwenHistoryReader(
                tempRoot.resolve(".qwen"),
                new SessionIndexManager(tempRoot.resolve("index-cache")));
    }

    @After
    public void tearDown() throws IOException {
        deleteRecursively(tempRoot);
    }

    // ===== fixtures =====

    private static String conversationRecord(
            String uuid,
            String parentUuid,
            String type,
            String text,
            String timestamp
    ) {
        boolean assistant = "assistant".equals(type);
        String role = assistant ? "model" : "user";
        String modelField = assistant ? "\"model\":\"qwen3-coder-plus\"," : "";
        return "{\"uuid\":\"" + uuid + "\",\"parentUuid\":" + (parentUuid == null ? "null" : "\"" + parentUuid + "\"")
                + ",\"sessionId\":\"session-1\",\"timestamp\":\"" + timestamp + "\",\"type\":\"" + type + "\","
                + "\"cwd\":\"fixture\"," + modelField
                + "\"message\":{\"role\":\"" + role + "\",\"parts\":[{\"text\":\"" + text + "\"}]}}";
    }

    /**
     * Write one five-turn session (10 messages, one parentUuid chain) with
     * predictable timestamps. Appends only when the file already exists.
     */
    private void writeFiveTurnSession(String sessionId) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int turn = 1; turn <= 5; turn++) {
            String parent = turn == 1 ? null : "assistant-" + (turn - 1);
            sb.append(conversationRecord("user-" + turn, parent, "user",
                    "prompt-" + turn, "2026-09-28T09:2" + turn + ":00.000Z").replace("session-1", sessionId));
            sb.append('\n');
            sb.append(conversationRecord("assistant-" + turn, "user-" + turn, "assistant",
                    "reply-" + turn, "2026-09-28T09:2" + turn + ":30.000Z").replace("session-1", sessionId));
            sb.append('\n');
        }
        writeSessionFile(sessionId, sb.toString());
    }

    private Path writeSessionFile(String sessionId, String content) throws IOException {
        Path file = chatsDir.resolve(sessionId + ".jsonl");
        Files.writeString(file, content, StandardCharsets.UTF_8);
        return file;
    }

    // ===== session listing =====

    @Test
    public void listsSessionsWithMetadataSortedByNewestFirst() throws IOException {
        writeFiveTurnSession("11111111-1111-4111-8111-111111111111");
        String newer = String.join("\n",
                conversationRecord("user-1", null, "user", "newest prompt", "2026-09-29T10:00:00.000Z"),
                conversationRecord("assistant-1", "user-1", "assistant", "newest reply", "2026-09-29T10:00:30.000Z"))
                .replace("session-1", "22222222-2222-4222-8222-222222222222");
        writeSessionFile("22222222-2222-4222-8222-222222222222", newer);
        // Junk that must never show up as sessions.
        writeSessionFile("notes", "garbage");
        writeSessionFile("00000000-0000-4000-8000-000000000000", "");

        String json = reader.getSessionsForProjectAsJson(projectPath.toString());
        JsonObject payload = new Gson().fromJson(json, JsonObject.class);

        assertTrue(payload.get("success").getAsBoolean());
        JsonArray sessions = payload.getAsJsonArray("sessions");
        assertEquals(2, sessions.size());
        assertEquals(2, payload.get("sessionCount").getAsInt());
        assertEquals(12, payload.get("total").getAsInt());

        JsonObject newest = sessions.get(0).getAsJsonObject();
        assertEquals("22222222-2222-4222-8222-222222222222", newest.get("sessionId").getAsString());
        assertEquals("newest prompt", newest.get("title").getAsString());
        assertEquals(2, newest.get("messageCount").getAsInt());
        assertEquals("qwen3-coder-plus", newest.get("model").getAsString());

        JsonObject older = sessions.get(1).getAsJsonObject();
        assertEquals("11111111-1111-4111-8111-111111111111", older.get("sessionId").getAsString());
        assertEquals("prompt-1", older.get("title").getAsString());
        assertEquals(10, older.get("messageCount").getAsInt());
    }

    @Test
    public void repeatedListingIsServedFromCacheAndIndexSurvivesRescan() throws IOException {
        writeFiveTurnSession("33333333-3333-4333-8333-333333333333");

        String first = reader.getSessionsForProjectAsJson(projectPath.toString());
        String second = reader.getSessionsForProjectAsJson(projectPath.toString());

        assertEquals(first, second);
        // Durable index entry written for the session.
        SessionIndexManager.ProjectIndex index = new SessionIndexManager(tempRoot.resolve("index-cache"))
                .readClaudeIndex().projects.get(projectPath.toString());
        assertNotNull(index);
        assertEquals(1, index.sessions.size());
        assertEquals("33333333-3333-4333-8333-333333333333", index.sessions.get(0).sessionId);
        assertEquals("qwen3-coder-plus", index.sessions.get(0).model);

        // Appending a turn refreshes the indexed metadata once the in-memory cache is
        // invalidated — appends do not touch the chats dir mtime, so the deep-search
        // and delete flows (clearProject) are what bust the cache, mirroring production.
        Path file = chatsDir.resolve("33333333-3333-4333-8333-333333333333.jsonl");
        Files.writeString(file, conversationRecord("user-6", "assistant-5", "user",
                        "late prompt", "2026-09-30T09:00:00.000Z").replace("session-1", "33333333-3333-4333-8333-333333333333"),
                StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.APPEND);
        Files.setLastModifiedTime(file, FileTime.from(Instant.parse("2026-09-30T09:00:00.000Z")));
        SessionIndexCache.getInstance().clearProject(projectPath.toString());

        String third = reader.getSessionsForProjectAsJson(projectPath.toString());
        JsonObject payload = new Gson().fromJson(third, JsonObject.class);
        JsonObject session = payload.getAsJsonArray("sessions").get(0).getAsJsonObject();
        assertEquals(11, session.get("messageCount").getAsInt());
    }

    // ===== disk pagination boundaries =====

    @Test
    public void latestPageCoversLastTurnsWhenCursorIsNull() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), null, 2);

        assertTrue(page.get("success").getAsBoolean());
        assertEquals(5, page.get("totalTurns").getAsInt());
        assertEquals(3, page.get("fromTurn").getAsInt());
        assertEquals(5, page.get("toTurn").getAsInt());
        assertTrue(page.get("hasMore").getAsBoolean());
        assertFalse(page.get("cursorReset").getAsBoolean());
        JsonArray messages = page.getAsJsonArray("messages");
        assertEquals(4, messages.size());
        assertEquals("prompt-4", firstText(messages.get(0).getAsJsonObject()));
    }

    @Test
    public void firstPageClampsFromTurnToZero() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 2, 2);

        assertEquals(0, page.get("fromTurn").getAsInt());
        assertEquals(2, page.get("toTurn").getAsInt());
        assertFalse(page.get("hasMore").getAsBoolean());
        assertFalse(page.get("cursorReset").getAsBoolean());
        JsonArray messages = page.getAsJsonArray("messages");
        assertEquals(4, messages.size());
        assertEquals("prompt-1", firstText(messages.get(0).getAsJsonObject()));
        assertEquals("reply-2", firstText(messages.get(3).getAsJsonObject()));
    }

    @Test
    public void middlePageCoversRequestedTurnWindow() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 4, 2);

        assertEquals(2, page.get("fromTurn").getAsInt());
        assertEquals(4, page.get("toTurn").getAsInt());
        assertTrue(page.get("hasMore").getAsBoolean());
        JsonArray messages = page.getAsJsonArray("messages");
        assertEquals(4, messages.size());
        assertEquals("prompt-3", firstText(messages.get(0).getAsJsonObject()));
    }

    @Test
    public void lastPageEndsAtTotalTurns() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 5, 2);

        assertEquals(3, page.get("fromTurn").getAsInt());
        assertEquals(5, page.get("toTurn").getAsInt());
        assertTrue(page.get("hasMore").getAsBoolean());
        assertEquals(4, page.getAsJsonArray("messages").size());
    }

    @Test
    public void singlePageCoversWholeSession() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 5, 30);

        assertEquals(0, page.get("fromTurn").getAsInt());
        assertEquals(5, page.get("toTurn").getAsInt());
        assertFalse(page.get("hasMore").getAsBoolean());
        assertEquals(10, page.getAsJsonArray("messages").size());
    }

    @Test
    public void cursorBeyondEndResetsToLatestPage() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 99, 2);

        assertTrue(page.get("cursorReset").getAsBoolean());
        assertEquals(3, page.get("fromTurn").getAsInt());
        assertEquals(5, page.get("toTurn").getAsInt());
        assertEquals(4, page.getAsJsonArray("messages").size());
    }

    @Test
    public void zeroCursorReturnsEmptyPageWithoutError() throws IOException {
        writeFiveTurnSession("session-page");

        JsonObject page = reader.getSessionMessagesPage("session-page", projectPath.toString(), 0, 2);

        assertTrue(page.get("success").getAsBoolean());
        assertEquals(0, page.get("fromTurn").getAsInt());
        assertEquals(0, page.get("toTurn").getAsInt());
        assertFalse(page.get("hasMore").getAsBoolean());
        assertTrue(page.getAsJsonArray("messages").isEmpty());
    }

    @Test
    public void missingSessionPageReportsFailure() {
        JsonObject page = reader.getSessionMessagesPage("nope", projectPath.toString(), 1, 2);

        assertFalse(page.get("success").getAsBoolean());
        assertNotNull(page.get("error"));
    }

    // ===== restore =====

    @Test
    public void restoresConvertedMessagesForKnownSession() throws IOException {
        writeFiveTurnSession("session-page");

        List<JsonObject> messages = reader.getSessionMessages("session-page", projectPath.toString());

        assertEquals(10, messages.size());
        assertEquals("user", messages.get(0).get("type").getAsString());
        assertEquals("assistant", messages.get(1).get("type").getAsString());
    }

    @Test
    public void restoreReturnsEmptyForMissingOrInvalidSessionIds() {
        assertTrue(reader.getSessionMessages("missing", projectPath.toString()).isEmpty());
        assertTrue(reader.getSessionMessages("../../../evil", projectPath.toString()).isEmpty());
        assertTrue(reader.getSessionMessages("", projectPath.toString()).isEmpty());
    }

    @Test
    public void restoreServesParseablePrefixOfCorruptFile() throws IOException {
        writeSessionFile("corrupt", "not json\n{\"uuid\":\"c1\",\"parentUuid\":null,"
                + "\"sessionId\":\"corrupt\",\"timestamp\":\"2026-09-28T09:20:00.000Z\",\"type\":\"user\","
                + "\"message\":{\"role\":\"user\",\"parts\":[{\"text\":\"still here\"}]}}\n{\"torn");

        List<JsonObject> messages = reader.getSessionMessages("corrupt", projectPath.toString());

        assertEquals(1, messages.size());
    }

    // ===== delete =====

    @Test
    public void deleteRemovesTranscriptSidecarAndSubagents() throws IOException {
        writeFiveTurnSession("session-page");
        Files.writeString(chatsDir.resolve("session-page.runtime.json"), "{}");
        Path subagentsDir = tempRoot.resolve(".qwen").resolve("projects").resolve(projectKey)
                .resolve("subagents").resolve("session-page");
        Files.createDirectories(subagentsDir);
        Files.writeString(subagentsDir.resolve("agent-Explore-call_1.jsonl"), "{}");
        Files.writeString(subagentsDir.resolve("agent-Explore-call_1.meta.json"), "{}");

        assertTrue(reader.deleteSession("session-page", projectPath.toString()));

        assertFalse(Files.exists(chatsDir.resolve("session-page.jsonl")));
        assertFalse(Files.exists(chatsDir.resolve("session-page.runtime.json")));
        assertFalse(Files.exists(subagentsDir));
        assertFalse("second delete reports nothing to remove",
                reader.deleteSession("session-page", projectPath.toString()));
    }

    @Test
    public void deleteRejectsPathTraversal() throws IOException {
        writeFiveTurnSession("session-page");
        Path outside = tempRoot.resolve("evil.jsonl");
        Files.writeString(outside, "important");

        assertFalse(reader.deleteSession("../evil", projectPath.toString()));

        assertTrue(Files.exists(outside));
        assertTrue(Files.exists(chatsDir.resolve("session-page.jsonl")));
    }

    // ===== helpers =====

    private static String firstText(JsonObject message) {
        return message.getAsJsonObject("message").getAsJsonArray("content").get(0)
                .getAsJsonObject().get("text").getAsString();
    }

    private static void deleteRecursively(Path root) throws IOException {
        if (root == null || !Files.exists(root)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(root)) {
            walk.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // best effort cleanup
                }
            });
        }
    }
}
