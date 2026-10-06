package com.qwenmate.provider.qwen;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.cache.SessionIndexManager;
import com.qwenmate.util.PathUtils;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Qwen Code local history reader.
 *
 * <p>Reads session transcripts directly from disk (no daemon round-trip), mirroring
 * the architecture of the reference implementation's history reader: a facade over a
 * transcript parser plus an index service that keeps {@link com.qwenmate.cache.SessionIndexManager}
 * warm.</p>
 *
 * <p>Layout (qwen-code 0.20.x – 0.24.x):
 * {@code ~/.qwen/projects/<sanitizeCwd(cwd)>/chats/<sessionId>.jsonl} with an
 * optional {@code <sessionId>.runtime.json} sidecar and per-session subagent logs
 * under {@code <projectDir>/subagents/<sessionId>/}.</p>
 */
public class QwenHistoryReader {

    private static final Logger LOG = Logger.getInstance(QwenHistoryReader.class);

    static final String QWEN_DIR = ".qwen";
    static final String PROJECTS_DIR = "projects";
    static final String CHATS_DIR = "chats";

    private final Gson gson = new Gson();
    private final QwenHistoryIndexService indexService;

    private static Path defaultQwenHome() {
        return Paths.get(NodeDetector.resolveHomeForFileOps(), QWEN_DIR);
    }

    public QwenHistoryReader() {
        this(defaultQwenHome());
    }

    QwenHistoryReader(Path qwenHome) {
        this(qwenHome, SessionIndexManager.getInstance());
    }

    /** Test seam: keeps the durable index inside the fixture directory. */
    QwenHistoryReader(Path qwenHome, SessionIndexManager indexManager) {
        this.indexService = new QwenHistoryIndexService(qwenHome, indexManager);
    }

    /** One session's summary row for the history panel. */
    public static class SessionInfo {
        public String sessionId;
        public String title;
        public int messageCount;
        /** Epoch millis of the newest message (0 when unknown). */
        public long lastTimestamp;
        /** Epoch millis of the oldest message (0 when unknown). */
        public long firstTimestamp;
        public String cwd;
        public long fileSize;
        public String model;
        /** Session source ("cli", "sdk-cli", …) or "" when the transcript records none. */
        public String entrypoint = "";
    }

    /**
     * List the qwen sessions of one project as the history-panel JSON
     * ({@code {success, sessions, total, sessionCount}}).
     *
     * @param projectPath the project working directory
     * @return JSON payload; always well-formed, {@code success:false} on failure
     */
    public String getSessionsForProjectAsJson(String projectPath) {
        try {
            List<SessionInfo> sessions = indexService.readProjectSessions(projectPath);
            int totalMessages = 0;
            for (SessionInfo session : sessions) {
                totalMessages += session.messageCount;
            }
            JsonObject result = new JsonObject();
            result.addProperty("success", true);
            result.add("sessions", gson.toJsonTree(sessions));
            result.addProperty("total", totalMessages);
            result.addProperty("sessionCount", sessions.size());
            return gson.toJson(result);
        } catch (Exception e) {
            LOG.error("[QwenHistoryReader] Failed to read sessions for project: " + e.getMessage(), e);
            JsonObject error = new JsonObject();
            error.addProperty("success", false);
            error.addProperty("error", "Failed to read Qwen sessions: " + e.getMessage());
            error.add("sessions", new JsonArray());
            return gson.toJson(error);
        }
    }

    /**
     * Load one session's messages in the message shape consumed by
     * {@code SessionMessageOrchestrator} (see {@link QwenTranscriptParser}).
     *
     * @param sessionId the session id
     * @param cwd       the project path used to resolve the project directory
     * @return messages in transcript order; empty when the session is missing/unreadable
     */
    public List<JsonObject> getSessionMessages(String sessionId, String cwd) {
        if (sessionId == null || sessionId.isBlank()) {
            return List.of();
        }
        try {
            for (Path chatsDir : chatsDirCandidates(cwd)) {
                Path file = resolveSessionFile(chatsDir, sessionId);
                if (file == null) {
                    continue;
                }
                return QwenTranscriptParser.parse(file).messages;
            }
        } catch (Exception e) {
            LOG.warn("[QwenHistoryReader] Failed to load session " + sessionId + ": " + e.getMessage());
        }
        return List.of();
    }

    /**
     * Load one turn-aligned page of a session's messages.
     *
     * <p>Turns are counted over human user messages (tool-result rows do not start a
     * turn). {@code beforeTurn == null} returns the latest {@code turnLimit} turns;
     * otherwise the page covers turns {@code [max(0, beforeTurn - turnLimit), beforeTurn)}.
     * A cursor past the end reports {@code cursorReset:true} and serves the latest
     * page instead, so the caller replaces rather than prepends a duplicated tail.</p>
     *
     * @param sessionId  the session id
     * @param cwd        the project path used to resolve the project directory
     * @param beforeTurn exclusive turn cursor, or null for the latest page
     * @param turnLimit  maximum turns per page (&gt; 0)
     * @return page payload ({@code success, messages, fromTurn, toTurn, totalTurns,
     *         hasMore, cursorReset, sessionTitle}), or {@code success:false} on failure
     */
    public JsonObject getSessionMessagesPage(String sessionId, String cwd, Integer beforeTurn, int turnLimit) {
        JsonObject page = new JsonObject();
        if (sessionId == null || sessionId.isBlank() || turnLimit <= 0) {
            page.addProperty("success", false);
            page.addProperty("error", "Invalid Qwen history page request");
            return page;
        }
        try {
            for (Path chatsDir : chatsDirCandidates(cwd)) {
                Path file = resolveSessionFile(chatsDir, sessionId);
                if (file == null) {
                    continue;
                }
                QwenTranscriptParser.ParsedSession session = QwenTranscriptParser.parse(file);
                paginate(session, beforeTurn, turnLimit, page);
                page.addProperty("success", true);
                return page;
            }
            page.addProperty("success", false);
            page.addProperty("error", "Session history not found");
        } catch (Exception e) {
            LOG.warn("[QwenHistoryReader] Failed to page session " + sessionId + ": " + e.getMessage());
            page.addProperty("success", false);
            page.addProperty("error", e.getMessage() != null ? e.getMessage() : "History page query failed");
        }
        return page;
    }

    /**
     * Delete a session's transcripts and index entry.
     *
     * <p>Removes {@code <sessionId>.jsonl}, its {@code .runtime.json} sidecar and the
     * per-session subagent directory. The shared session index entry is cleared by
     * the caller ({@code HistoryDeleteService.cleanupCache}).</p>
     *
     * @param sessionId   the session id
     * @param projectPath the project working directory
     * @return true when the main transcript existed and was deleted
     */
    public boolean deleteSession(String sessionId, String projectPath) {
        if (sessionId == null || sessionId.isBlank()) {
            return false;
        }
        String safeSessionId = sessionId.trim();
        boolean deleted = false;
        try {
            for (Path chatsDir : chatsDirCandidates(projectPath)) {
                Path sessionFile = chatsDir.resolve(safeSessionId + ".jsonl").normalize();
                if (!sessionFile.startsWith(chatsDir.normalize())) {
                    continue;
                }
                if (Files.exists(sessionFile)) {
                    Files.delete(sessionFile);
                    deleted = true;
                    LOG.info("[QwenHistoryReader] Deleted session file: " + sessionFile.getFileName());
                }
                Path runtimeFile = chatsDir.resolve(safeSessionId + ".runtime.json").normalize();
                if (runtimeFile.startsWith(chatsDir.normalize())) {
                    Files.deleteIfExists(runtimeFile);
                }
            }
            for (Path subagentsDir : subagentsDirCandidates(projectPath)) {
                Path sessionDir = subagentsDir.resolve(safeSessionId).normalize();
                if (sessionDir.startsWith(subagentsDir.normalize()) && Files.isDirectory(sessionDir)) {
                    deleteRecursively(sessionDir);
                    LOG.info("[QwenHistoryReader] Deleted subagent dir: " + sessionDir);
                }
            }
        } catch (Exception e) {
            LOG.warn("[QwenHistoryReader] Failed to delete session " + safeSessionId + ": " + e.getMessage());
        }
        return deleted;
    }

    /**
     * Resolve one session's transcript file, refusing path traversal and
     * requiring a UUID-style file name.
     */
    Path resolveSessionFile(Path chatsDir, String sessionId) {
        if (sessionId == null || sessionId.isBlank() || chatsDir == null) {
            return null;
        }
        Path file = chatsDir.resolve(sessionId.trim() + ".jsonl").normalize();
        if (!file.startsWith(chatsDir.normalize())) {
            return null;
        }
        return Files.isRegularFile(file) ? file : null;
    }

    /**
     * Project-level {@code chats} directories to probe: canonical key first, then
     * legacy/symlink-resolved key variants (see {@link PathUtils#getSanitizedPathCandidates}).
     */
    List<Path> chatsDirCandidates(String projectPath) {
        List<Path> candidates = new ArrayList<>(2);
        for (Path projectDir : projectDirCandidates(projectPath)) {
            candidates.add(projectDir.resolve(CHATS_DIR));
        }
        return candidates;
    }

    /** Project-level {@code subagents} directories to probe. */
    List<Path> subagentsDirCandidates(String projectPath) {
        List<Path> candidates = new ArrayList<>(2);
        for (Path projectDir : projectDirCandidates(projectPath)) {
            candidates.add(projectDir.resolve("subagents"));
        }
        return candidates;
    }

    /** The qwen project dir ({@code ~/.qwen/projects/<key>}) for every plausible key. */
    List<Path> projectDirCandidates(String projectPath) {
        Path projectsRoot = indexService.qwenHome().resolve(PROJECTS_DIR);
        List<Path> candidates = new ArrayList<>(4);
        Set<String> seen = new HashSet<>();
        for (String key : projectKeyCandidates(projectPath)) {
            if (seen.add(key)) {
                candidates.add(projectsRoot.resolve(key));
            }
        }
        return candidates;
    }

    /**
     * Qwen project keys for a working directory. Mirrors qwen-code's
     * {@code sanitizeCwd} (lowercase + {@code [^a-zA-Z0-9]} → {@code '-'}, matching
     * the CLI on Windows where it lowercases first) plus the non-lowercased form so
     * transcripts written on case-sensitive hosts stay reachable.
     */
    public static List<String> projectKeyCandidates(String projectPath) {
        if (projectPath == null || projectPath.isBlank()) {
            return List.of();
        }
        LinkedHashSet<String> keys = new LinkedHashSet<>();
        for (String candidate : PathUtils.getSanitizedPathCandidates(projectPath.trim())) {
            keys.add(sanitizeCwd(candidate, true));
            keys.add(sanitizeCwd(candidate, false));
        }
        return new ArrayList<>(keys);
    }

    /** qwen-code {@code sanitizeCwd}: optional lowercase, then non-alphanumerics to '-'. */
    static String sanitizeCwd(String path, boolean lowercase) {
        String normalized = lowercase ? path.toLowerCase(Locale.ROOT) : path;
        StringBuilder sb = new StringBuilder(normalized.length());
        for (int i = 0; i < normalized.length(); i++) {
            char c = normalized.charAt(i);
            boolean alphanumeric = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
            sb.append(alphanumeric ? c : '-');
        }
        return sb.toString();
    }

    /**
     * qwen-code {@code getProjectHash}: SHA-256 of the lowercased project path
     * (the {@code ~/.qwen/tmp/<hash>} identity). Exposed for diagnostics/tests.
     */
    public static String projectHash(String projectPath) {
        if (projectPath == null) {
            return "";
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(
                    projectPath.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return "";
        }
    }

    /**
     * Turn-aligned page selection over converted messages. Package-private so the
     * pagination boundaries (first / middle / last / single page) stay unit-tested.
     *
     * <p>A turn starts at each human user message and spans until the next one;
     * messages before the first turn belong to no page (mirrors the reference turn
     * collector). {@code beforeTurn == null} (or a cursor past the end) selects the
     * last {@code pageSize} turns.</p>
     */
    static void paginate(QwenTranscriptParser.ParsedSession session, Integer beforeTurn, int pageSize, JsonObject page) {
        List<JsonObject> messages = session.messages;
        List<Integer> turnStartIndexes = new ArrayList<>();
        for (int i = 0; i < messages.size(); i++) {
            if (isHumanUserMessage(messages.get(i))) {
                turnStartIndexes.add(i);
            }
        }
        int totalTurns = turnStartIndexes.size();
        page.addProperty("totalTurns", totalTurns);
        page.addProperty("sessionTitle", session.title);

        boolean cursorReset = beforeTurn != null && beforeTurn > totalTurns;
        Integer requestedBeforeTurn = (beforeTurn == null || cursorReset) ? null : beforeTurn;
        int fromTurn = requestedBeforeTurn == null
                ? Math.max(0, totalTurns - pageSize)
                : Math.max(0, requestedBeforeTurn - pageSize);
        int toTurn = requestedBeforeTurn == null ? totalTurns : requestedBeforeTurn;

        int startMessage;
        int endMessage;
        if (totalTurns == 0 || fromTurn >= totalTurns) {
            startMessage = messages.size();
            endMessage = messages.size();
        } else {
            startMessage = turnStartIndexes.get(fromTurn);
            endMessage = toTurn >= totalTurns ? messages.size() : turnStartIndexes.get(toTurn);
        }

        JsonArray pageMessages = new JsonArray();
        for (int i = startMessage; i < endMessage && i < messages.size(); i++) {
            pageMessages.add(messages.get(i).deepCopy());
        }

        page.addProperty("fromTurn", fromTurn);
        page.addProperty("toTurn", toTurn);
        page.addProperty("hasMore", fromTurn > 0);
        page.addProperty("cursorReset", cursorReset);
        page.add("messages", pageMessages);
    }

    /**
     * Whether a converted message is a human user turn (text or image content —
     * tool-result rows do not start turns).
     */
    static boolean isHumanUserMessage(JsonObject message) {
        if (message == null || !"user".equals(asString(message.get("type")))) {
            return false;
        }
        JsonObject inner = message.has("message") && message.get("message").isJsonObject()
                ? message.getAsJsonObject("message")
                : message;
        if (!inner.has("content") || !inner.get("content").isJsonArray()) {
            return false;
        }
        for (JsonElement element : inner.getAsJsonArray("content")) {
            if (!element.isJsonObject()) {
                continue;
            }
            String blockType = asString(element.getAsJsonObject().get("type"));
            if ("text".equals(blockType) || "image".equals(blockType)) {
                return true;
            }
        }
        return false;
    }

    private static String asString(JsonElement element) {
        return element != null && element.isJsonPrimitive() ? element.getAsString() : null;
    }

    private static void deleteRecursively(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        Deque<Path> stack = new ArrayDeque<>();
        stack.push(dir);
        while (!stack.isEmpty()) {
            Path current = stack.pop();
            try (Stream<Path> children = Files.list(current)) {
                List<Path> entries = children.toList();
                for (Path entry : entries) {
                    if (Files.isDirectory(entry)) {
                        stack.push(entry);
                    } else {
                        Files.deleteIfExists(entry);
                    }
                }
            }
            Files.deleteIfExists(current);
        }
    }
}
