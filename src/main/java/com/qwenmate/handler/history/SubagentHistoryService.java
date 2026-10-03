package com.qwenmate.handler.history;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.provider.qwen.QwenHistoryReader;
import com.qwenmate.provider.qwen.QwenTranscriptParser;
import com.qwenmate.util.JsUtils;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Reads Qwen Code sidechain subagent logs for display inside Agent cards.
 */
class SubagentHistoryService {

    private static final Logger LOG = Logger.getInstance(SubagentHistoryService.class);
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]+");
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9_:-]{1,256}");
    private static final Gson GSON = new Gson();
    private static final int MAX_JSONL_LINES = 50_000;

    private final HandlerContext context;

    SubagentHistoryService(HandlerContext context) {
        this.context = context;
    }

    void handleLoadSubagentSession(String content) {
        JsonObject request = parseRequest(content);
        String sessionId = getString(request, "sessionId");
        String agentId = getString(request, "agentId");
        String agentPath = getString(request, "agentPath");
        String toolUseId = getString(request, "toolUseId");
        String description = getString(request, "description");
        String provider = getString(request, "provider");

        JsonObject response = new JsonObject();
        response.addProperty("toolUseId", toolUseId);
        response.addProperty("agentId", agentId);
        response.addProperty("agentPath", agentPath);
        response.addProperty("sessionId", sessionId);
        response.addProperty("provider", provider);

        if ("qwen".equals(provider)) {
            handleLoadQwenSubagentSession(response, sessionId, agentId, toolUseId, description);
            return;
        }
        // Non-qwen providers have no subagent transcripts to load.
        response.addProperty("success", true);
        response.addProperty("completed", true);
        response.addProperty("status", "completed");
        response.add("messages", new JsonArray());
        sendResponse(response);
    }

    void handleLoadSubagentStatuses(String content) {
        JsonObject response = new JsonObject();
        response.add("statuses", new JsonArray());

        try {
            JsonObject request = parseRequest(content);
            String sessionId = getString(request, "sessionId");
            String provider = getString(request, "provider");
            String requestId = getString(request, "requestId");
            response.addProperty("sessionId", sessionId);
            response.addProperty("provider", provider);
            response.addProperty("requestId", requestId);

            validateId("sessionId", sessionId);
            validateRequestId(requestId);
            if ("qwen".equals(provider)) {
                response.add("statuses", collectQwenSubagentStatuses(sessionId));
            }
            response.addProperty("success", true);
        } catch (Exception e) {
            response.addProperty("success", false);
            response.addProperty("error", e.getMessage() != null ? e.getMessage() : "Invalid request");
        }
        sendStatusesResponse(response);
    }

    private JsonObject parseRequest(String content) {
        if (content == null || content.trim().isEmpty()) {
            return new JsonObject();
        }
        return JsonParser.parseString(content).getAsJsonObject();
    }

    /**
     * Load one qwen subagent transcript from the per-session logs under
     * {@code ~/.qwen/projects/<key>/subagents/<sessionId>/}. Sessions without
     * subagent data degrade to an empty completed panel.
     */
    private void handleLoadQwenSubagentSession(
            JsonObject response,
            String sessionId,
            String agentId,
            String toolUseId,
            String description
    ) {
        try {
            validateId("sessionId", sessionId);
            Path file = resolveQwenSubagentFile(sessionId, agentId, toolUseId, description);
            if (file == null || !Files.isRegularFile(file)) {
                response.addProperty("success", true);
                response.addProperty("completed", true);
                response.addProperty("status", "completed");
                response.add("messages", new JsonArray());
                sendResponse(response);
                return;
            }
            response.addProperty("agentId", extractAgentId(file));
            QwenTranscriptParser.ParsedSession parsed = QwenTranscriptParser.parse(file, true);
            JsonArray messages = new JsonArray();
            for (JsonObject message : parsed.messages) {
                messages.add(message);
            }
            boolean completed = isQwenSubagentCompleted(file);
            response.addProperty("success", true);
            response.addProperty("completed", completed);
            response.addProperty("status", completed ? "completed" : "running");
            response.add("messages", messages);
        } catch (Exception e) {
            LOG.warn("[SubagentHistory] Failed to load qwen subagent log: " + e.getMessage());
            response.addProperty("success", false);
            response.addProperty("status", "error");
            response.addProperty("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
        sendResponse(response);
    }

    /**
     * Resolve a qwen subagent transcript: by agent id first, then by the tool call
     * id / description recorded in the sidecar metadata.
     */
    private Path resolveQwenSubagentFile(String sessionId, String agentId, String toolUseId, String description) {
        for (Path sessionDir : qwenSubagentSessionDirs(sessionId)) {
            if (agentId != null && !agentId.isEmpty() && SAFE_ID.matcher(agentId).matches()) {
                Path file = sessionDir.resolve("agent-" + agentId + ".jsonl").normalize();
                if (file.startsWith(sessionDir) && Files.isRegularFile(file)) {
                    return file;
                }
            }
            if (toolUseId != null && !toolUseId.isEmpty()) {
                Path byToolUseId = findQwenSubagentByMeta(sessionDir, "toolUseId", toolUseId);
                if (byToolUseId != null) {
                    return byToolUseId;
                }
            }
            if (description != null && !description.isEmpty()) {
                Path byDescription = findQwenSubagentByMeta(sessionDir, "description", description);
                if (byDescription != null) {
                    return byDescription;
                }
            }
        }
        return null;
    }

    /** Per-session qwen subagent directories that exist for this project. */
    private List<Path> qwenSubagentSessionDirs(String sessionId) {
        List<Path> dirs = new ArrayList<>();
        if (sessionId == null || sessionId.isEmpty()) {
            return dirs;
        }
        Path qwenProjects = Path.of(NodeDetector.resolveHomeForFileOps(), ".qwen", "projects");
        for (String key : QwenHistoryReader.projectKeyCandidates(qwenProjectBasePath())) {
            Path sessionDir = qwenProjects.resolve(key).resolve("subagents").resolve(sessionId).normalize();
            if (Files.isDirectory(sessionDir)) {
                dirs.add(sessionDir);
            }
        }
        return dirs;
    }

    private String qwenProjectBasePath() {
        String rawPath = context.getProject().getBasePath();
        String nodePath = NodeDetector.getInstance().getCachedNodePath();
        return NodeDetector.isWslPath(nodePath) ? NodeDetector.convertToWslPath(rawPath) : rawPath;
    }

    /** Newest subagent transcript whose metadata field equals the expected value. */
    private Path findQwenSubagentByMeta(Path sessionDir, String field, String expected) {
        if (sessionDir == null || !Files.isDirectory(sessionDir)) {
            return null;
        }
        Path match = null;
        long newest = Long.MIN_VALUE;
        try (Stream<Path> stream = Files.list(sessionDir)) {
            for (Path metaFile : stream.filter(path -> path.getFileName().toString().endsWith(".meta.json")).toList()) {
                if (expected.equals(readQwenSubagentMetaString(metaFile, field))
                        && lastModifiedMillis(metaFile) > newest) {
                    newest = lastModifiedMillis(metaFile);
                    match = metaFile;
                }
            }
        } catch (Exception e) {
            LOG.warn("[SubagentHistory] Failed to scan qwen subagent metadata: " + e.getMessage());
            return null;
        }
        return match == null ? null : metaToJsonl(match);
    }

    private static String readQwenSubagentMetaString(Path metaFile, String field) {
        try {
            JsonObject meta = JsonParser.parseString(Files.readString(metaFile, StandardCharsets.UTF_8)).getAsJsonObject();
            return getString(meta, field);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Completion from the sidecar metadata status. Metadata is written before the
     * run starts, so its absence means the log predates tracking — report the
     * subagent as finished instead of leaving the panel spinning forever.
     */
    private static boolean isQwenSubagentCompleted(Path jsonlFile) {
        String name = jsonlFile.getFileName().toString();
        Path metaFile = jsonlFile.resolveSibling(
                name.endsWith(".jsonl") ? name.substring(0, name.length() - ".jsonl".length()) + ".meta.json" : name);
        String status = readQwenSubagentMetaString(metaFile, "status");
        if (status == null) {
            return true;
        }
        String normalized = status.toLowerCase(Locale.ROOT);
        return !"running".equals(normalized) && !"pending".equals(normalized) && !"starting".equals(normalized);
    }

    /** Status snapshots of every qwen subagent recorded for the session. */
    private JsonArray collectQwenSubagentStatuses(String sessionId) {
        JsonArray statuses = new JsonArray();
        for (Path sessionDir : qwenSubagentSessionDirs(sessionId)) {
            try (Stream<Path> stream = Files.list(sessionDir)) {
                for (Path metaFile : stream.filter(path -> path.getFileName().toString().endsWith(".meta.json")).toList()) {
                    try {
                        JsonObject meta = JsonParser.parseString(
                                Files.readString(metaFile, StandardCharsets.UTF_8)).getAsJsonObject();
                        JsonObject snapshot = new JsonObject();
                        snapshot.addProperty("success", true);
                        addIfPresent(snapshot, "agentId", getString(meta, "agentId"));
                        addIfPresent(snapshot, "toolUseId", getString(meta, "toolUseId"));
                        String status = mapQwenSubagentStatus(getString(meta, "status"));
                        snapshot.addProperty("status", status);
                        snapshot.addProperty("completed", !"running".equals(status));
                        statuses.add(snapshot);
                    } catch (Exception e) {
                        LOG.warn("[SubagentHistory] Skipping unreadable qwen subagent metadata: " + e.getMessage());
                    }
                }
            } catch (Exception e) {
                LOG.warn("[SubagentHistory] Failed to list qwen subagent metadata: " + e.getMessage());
            }
        }
        return statuses;
    }

    private static String mapQwenSubagentStatus(String status) {
        if (status == null) {
            return "running";
        }
        String normalized = status.toLowerCase(Locale.ROOT);
        if ("completed".equals(normalized)) {
            return "completed";
        }
        if ("failed".equals(normalized) || "error".equals(normalized) || "cancelled".equals(normalized)) {
            return "error";
        }
        return "running";
    }

    private static void addIfPresent(JsonObject target, String key, String value) {
        if (value != null) {
            target.addProperty(key, value);
        }
    }

    private static String getString(JsonObject object, String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
            return null;
        }
        return object.get(key).getAsString();
    }

    private static void validateId(String name, String value) {
        if (value == null || value.isEmpty() || !SAFE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid " + name);
        }
    }

    private static void validateRequestId(String value) {
        if (value == null || !SAFE_REQUEST_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid requestId");
        }
    }




    private long lastModifiedMillis(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    private Path metaToJsonl(Path metaFile) {
        String name = metaFile.getFileName().toString().replaceFirst("\\.meta\\.json$", ".jsonl");
        return metaFile.resolveSibling(name);
    }

    private String extractAgentId(Path jsonlFile) {
        String name = jsonlFile.getFileName().toString();
        if (name.startsWith("agent-") && name.endsWith(".jsonl")) {
            return name.substring("agent-".length(), name.length() - ".jsonl".length());
        }
        return null;
    }







    static boolean hasCompleted(JsonArray messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            if (!messages.get(i).isJsonObject()) {
                continue;
            }
            JsonObject record = messages.get(i).getAsJsonObject();
            if (!"assistant".equals(getString(record, "type"))
                    || !record.has("message") || !record.get("message").isJsonObject()) {
                continue;
            }
            JsonObject message = record.getAsJsonObject("message");
            String stopReason = getString(message, "stop_reason");
            // The sidechain's last assistant stop_reason is the only persisted
            // completion signal (task_notification is a live event, not stored).
            // tool_use means the agent is still mid-turn (waiting on a tool
            // result); a null/missing value means streaming/incomplete. Any
            // other value (end_turn, stop_sequence, max_tokens, pause_turn,
            // refusal) means the agent's turn ended - treat it as terminal so
            // the UI does not stay stuck on "running" after a max_tokens or
            // refusal termination, which would reproduce the bug this fixes.
            return stopReason != null && !"tool_use".equals(stopReason);
        }
        return false;
    }

    private void sendResponse(JsonObject response) {
        if (context.getProject() == null || context.getProject().isDisposed()) {
            return;
        }
        String responseJson = GSON.toJson(response);
        String payload = JsUtils.escapeJs(responseJson);
        if (payload.length() <= HistoryMessageInjector.HISTORY_BATCH_TARGET_CHAR_LIMIT) {
            context.callJavaScript("onSubagentHistoryLoaded", payload);
            return;
        }

        String transferId = UUID.randomUUID().toString();
        List<String> chunks = HistoryMessageInjector.splitHistoryPayload(responseJson);
        for (int i = 0; i < chunks.size(); i++) {
            context.callJavaScript(
                    "onSubagentHistoryChunk",
                    transferId,
                    JsUtils.escapeJs(chunks.get(i)),
                    String.valueOf(i == chunks.size() - 1)
            );
        }
    }

    private void sendStatusesResponse(JsonObject response) {
        if (context.getProject() == null || context.getProject().isDisposed()) {
            return;
        }
        context.callJavaScript("onSubagentStatusesLoaded", JsUtils.escapeJs(GSON.toJson(response)));
    }
}
