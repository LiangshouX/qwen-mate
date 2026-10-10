package com.qwenmate.usage;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Loads the usage dataset from {@code ~/.qwen}:
 * <ul>
 *   <li>{@code usage_record.jsonl} — per-session aggregates written by
 *       qwen-code's {@code persistSessionUsage()} (and transcript deletion
 *       backfill). Append-only; a resumed session appends a new segment, so
 *       deduplication is per sessionId with the <em>last</em> line winning —
 *       the same semantics as qwen-code's {@code dedupBySessionId()}.</li>
 *   <li>{@code projects/<proj>/chats/<sessionId>.jsonl} — live session transcripts. Sessions
 *       absent from the usage file (still open, or crashed before flush) are
 *       rebuilt from their {@code ui_telemetry} events, matching qwen-code's
 *       {@code summarizeTranscript()} field-for-field (verified against a
 *       persisted record: tools/files exact; model tokens differ only by
 *       telemetry events that were never flushed to the transcript).</li>
 * </ul>
 *
 * <p>Results are cached with a short TTL; transcripts are additionally cached
 * per file signature (mtime + size) so unchanged files are never re-parsed.
 */
public final class UsageDataStore {

    /** Snapshot reuse window — the settings page re-requests on every refresh. */
    private static final long SNAPSHOT_TTL_MS = 3_000;

    private static final Object LOCK = new Object();
    private static volatile UsageSnapshot snapshot;
    private static volatile long snapshotAtMs;

    /** path -> parsed live record (record == null means "no telemetry events"). */
    private static final Map<String, CachedLive> LIVE_CACHE = new ConcurrentHashMap<>();

    private static final class CachedLive {
        final long mtimeMs;
        final long size;
        final JsonObject record;

        CachedLive(long mtimeMs, long size, JsonObject record) {
            this.mtimeMs = mtimeMs;
            this.size = size;
            this.record = record;
        }
    }

    private UsageDataStore() {
    }

    /**
     * Returns the merged usage snapshot, rebuilding it when the cache is stale
     * or {@code force} is set (explicit user refresh).
     */
    public static UsageSnapshot load(Path qwenDir, boolean force) {
        long now = System.currentTimeMillis();
        UsageSnapshot current = snapshot;
        if (!force && current != null && now - snapshotAtMs < SNAPSHOT_TTL_MS) {
            return current;
        }
        synchronized (LOCK) {
            now = System.currentTimeMillis();
            current = snapshot;
            if (!force && current != null && now - snapshotAtMs < SNAPSHOT_TTL_MS) {
                return current;
            }
            UsageSnapshot built = build(qwenDir);
            snapshot = built;
            snapshotAtMs = now;
            return built;
        }
    }

    private static UsageSnapshot build(Path qwenDir) {
        Path usageFile = qwenDir.resolve("usage_record.jsonl");
        boolean exists = Files.isRegularFile(usageFile);
        List<JsonObject> persistedLines = new ArrayList<>();
        if (exists) {
            try (BufferedReader reader = Files.newBufferedReader(usageFile, StandardCharsets.UTF_8)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    JsonObject record = parseRecord(line);
                    if (record != null) {
                        persistedLines.add(record);
                    }
                }
            } catch (IOException e) {
                // Unreadable file is treated as absent; the UI surfaces
                // dataFileExists separately so the user still sees a hint.
                exists = false;
            }
        }

        Set<String> persistedIds = new HashSet<>();
        for (JsonObject record : persistedLines) {
            if (record.has("sessionId")) {
                persistedIds.add(record.get("sessionId").getAsString());
            }
        }

        List<JsonObject> liveRecords = loadLiveSessions(qwenDir, persistedIds);

        Map<String, JsonObject> merged = new LinkedHashMap<>();
        for (JsonObject record : liveRecords) {
            merged.put(record.get("sessionId").getAsString(), record);
        }
        for (JsonObject record : persistedLines) {
            merged.put(record.get("sessionId").getAsString(), record);
        }
        List<JsonObject> deduped = UsageStatsAggregator.dedupLastWins(new ArrayList<>(merged.values()));

        return new UsageSnapshot(
                deduped,
                exists,
                usageFile.toAbsolutePath().toString(),
                persistedLines.size(),
                liveRecords.size()
        );
    }

    /** Parses one usage_record line; returns null for blanks, garbage or non-v1 rows. */
    static JsonObject parseRecord(String line) {
        if (line == null || line.isBlank()) {
            return null;
        }
        try {
            JsonObject record = JsonParser.parseString(line.trim()).getAsJsonObject();
            if (!record.has("version") || record.get("version").getAsInt() != 1) {
                return null;
            }
            if (!record.has("sessionId") || !record.has("timestamp")) {
                return null;
            }
            return record;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Rebuilds live (not-yet-persisted) sessions from transcripts under
     * {@code ~/.qwen/projects/<proj>/chats/<sessionId>.jsonl}.
     */
    private static List<JsonObject> loadLiveSessions(Path qwenDir, Set<String> persistedIds) {
        List<JsonObject> result = new ArrayList<>();
        Path projectsDir = qwenDir.resolve("projects");
        if (!Files.isDirectory(projectsDir)) {
            return result;
        }
        long sinceMs = System.currentTimeMillis() - UsageSnapshot.LIVE_REBUILD_WINDOW_MS;
        try (DirectoryStream<Path> projects = Files.newDirectoryStream(projectsDir)) {
            for (Path projectDir : projects) {
                if (!Files.isDirectory(projectDir)) {
                    continue;
                }
                Path chatsDir = projectDir.resolve("chats");
                if (!Files.isDirectory(chatsDir)) {
                    continue;
                }
                try (DirectoryStream<Path> chats = Files.newDirectoryStream(chatsDir, "*.jsonl")) {
                    for (Path chat : chats) {
                        String fileName = chat.getFileName().toString();
                        if (fileName.endsWith(".ledger.jsonl")) {
                            continue;
                        }
                        String sessionId = fileName.substring(0, fileName.length() - ".jsonl".length());
                        if (persistedIds.contains(sessionId)) {
                            continue;
                        }
                        try {
                            java.nio.file.attribute.BasicFileAttributes attrs =
                                    Files.readAttributes(chat, java.nio.file.attribute.BasicFileAttributes.class);
                            if (attrs.lastModifiedTime().toMillis() < sinceMs) {
                                continue;
                            }
                            JsonObject record = liveRecord(chat, sessionId, attrs);
                            if (record != null) {
                                result.add(record);
                            }
                        } catch (IOException e) {
                            // Skip unreadable transcripts — same as the CLI's rebuild.
                        }
                    }
                }
            }
        } catch (IOException e) {
            return result;
        }
        return result;
    }

    /** Returns the rebuilt record for one transcript, using the per-file cache. */
    private static JsonObject liveRecord(Path chat, String sessionId,
                                         java.nio.file.attribute.BasicFileAttributes attrs) throws IOException {
        String key = chat.toAbsolutePath().toString();
        long mtime = attrs.lastModifiedTime().toMillis();
        long size = attrs.size();
        CachedLive cached = LIVE_CACHE.get(key);
        if (cached != null && cached.mtimeMs == mtime && cached.size == size) {
            return cached.record;
        }
        JsonObject record = parseTranscript(chat, sessionId);
        LIVE_CACHE.put(key, new CachedLive(mtime, size, record));
        return record;
    }

    /**
     * Field-for-field mirror of qwen-code's {@code summarizeTranscript()}:
     * start/end timestamps from the first/last records, metrics accumulated
     * from {@code ui_telemetry} events. Returns null when the transcript has
     * no telemetry events.
     */
    static JsonObject parseTranscript(Path chat, String sessionId) throws IOException {
        String firstTimestamp = null;
        String lastTimestamp = null;
        String cwd = null;
        String lastLine = null;
        boolean hasEvents = false;

        // model -> [requests, input, output, cached, thoughts, total, latencyMs]
        Map<String, long[]> models = new LinkedHashMap<>();
        // tool -> [count, success, fail, durationMs]
        Map<String, long[]> tools = new LinkedHashMap<>();
        long[] toolTotals = new long[3]; // count, success, fail
        long linesAdded = 0;
        long linesRemoved = 0;

        try (BufferedReader reader = Files.newBufferedReader(chat, StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                if (firstTimestamp == null) {
                    JsonObject first = parseLoose(line);
                    if (first != null) {
                        firstTimestamp = optString(first, "timestamp");
                        cwd = optString(first, "cwd");
                    }
                }
                lastLine = line;
                if (!line.contains("ui_telemetry")) {
                    continue;
                }
                JsonObject record = parseLoose(line);
                if (record == null) {
                    continue;
                }
                JsonObject payload = record.getAsJsonObject("systemPayload");
                if (payload == null || !payload.has("uiEvent") || !payload.get("uiEvent").isJsonObject()) {
                    continue;
                }
                JsonObject event = payload.getAsJsonObject("uiEvent");
                hasEvents = true;
                String name = optString(event, "event.name");
                if ("qwen-code.api_response".equals(name)) {
                    String model = optString(event, "model");
                    if (model == null) {
                        model = "unknown";
                    }
                    long[] m = models.computeIfAbsent(model, k -> new long[7]);
                    m[0]++;
                    m[1] += longOpt(event, "input_token_count");
                    m[2] += longOpt(event, "output_token_count");
                    m[3] += longOpt(event, "cached_content_token_count");
                    m[4] += longOpt(event, "thoughts_token_count");
                    m[5] += longOpt(event, "total_token_count");
                    m[6] += longOpt(event, "duration_ms");
                } else if ("qwen-code.tool_call".equals(name)) {
                    String function = optString(event, "function_name");
                    if (function == null) {
                        function = "unknown";
                    }
                    boolean success = event.has("success") && event.get("success").getAsBoolean();
                    long duration = longOpt(event, "duration_ms");
                    long[] t = tools.computeIfAbsent(function, k -> new long[4]);
                    t[0]++;
                    t[1] += success ? 1 : 0;
                    t[2] += success ? 0 : 1;
                    t[3] += duration;
                    toolTotals[0]++;
                    toolTotals[1] += success ? 1 : 0;
                    toolTotals[2] += success ? 0 : 1;
                    if (event.has("metadata") && event.get("metadata").isJsonObject()) {
                        JsonObject meta = event.getAsJsonObject("metadata");
                        linesAdded += longOpt(meta, "model_added_lines") + longOpt(meta, "user_added_lines");
                        linesRemoved += longOpt(meta, "model_removed_lines") + longOpt(meta, "user_removed_lines");
                    }
                }
            }
        }

        if (!hasEvents) {
            return null;
        }
        if (lastLine != null && lastTimestamp == null) {
            JsonObject last = parseLoose(lastLine);
            if (last != null) {
                lastTimestamp = optString(last, "timestamp");
            }
        }
        if (firstTimestamp == null) {
            return null;
        }
        if (lastTimestamp == null) {
            lastTimestamp = firstTimestamp;
        }
        long startMs = parseTimestamp(firstTimestamp);
        long endMs = parseTimestamp(lastTimestamp);
        if (startMs < 0 || endMs < 0) {
            return null;
        }

        JsonObject record = new JsonObject();
        record.addProperty("version", 1);
        record.addProperty("sessionId", sessionId);
        record.addProperty("timestamp", endMs);
        record.addProperty("startTime", startMs);
        if (cwd != null) {
            record.addProperty("project", cwd);
        }
        record.addProperty("durationMs", Math.max(0, endMs - startMs));

        long totalLatency = 0;
        JsonObject modelsJson = new JsonObject();
        for (Map.Entry<String, long[]> entry : models.entrySet()) {
            long[] m = entry.getValue();
            JsonObject model = new JsonObject();
            model.addProperty("requests", m[0]);
            model.addProperty("inputTokens", m[1]);
            model.addProperty("outputTokens", m[2]);
            model.addProperty("cachedTokens", m[3]);
            model.addProperty("thoughtsTokens", m[4]);
            model.addProperty("totalTokens", m[5] > 0 ? m[5] : m[1] + m[2]);
            model.addProperty("totalLatencyMs", m[6]);
            modelsJson.add(entry.getKey(), model);
            totalLatency += m[6];
        }
        record.add("models", modelsJson);
        record.addProperty("totalLatencyMs", totalLatency);

        JsonObject toolsJson = new JsonObject();
        toolsJson.addProperty("totalCalls", toolTotals[0]);
        toolsJson.addProperty("totalSuccess", toolTotals[1]);
        toolsJson.addProperty("totalFail", toolTotals[2]);
        JsonObject byName = new JsonObject();
        for (Map.Entry<String, long[]> entry : tools.entrySet()) {
            long[] t = entry.getValue();
            JsonObject tool = new JsonObject();
            tool.addProperty("count", t[0]);
            tool.addProperty("success", t[1]);
            tool.addProperty("fail", t[2]);
            tool.addProperty("totalDurationMs", t[3]);
            byName.add(entry.getKey(), tool);
        }
        toolsJson.add("byName", byName);
        record.add("tools", toolsJson);

        JsonObject files = new JsonObject();
        files.addProperty("linesAdded", linesAdded);
        files.addProperty("linesRemoved", linesRemoved);
        record.add("files", files);
        return record;
    }

    private static JsonObject parseLoose(String line) {
        try {
            return JsonParser.parseString(line).getAsJsonObject();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String optString(JsonObject obj, String key) {
        if (obj.has(key) && obj.get(key).isJsonPrimitive()) {
            return obj.get(key).getAsString();
        }
        return null;
    }

    private static long longOpt(JsonObject obj, String key) {
        if (obj.has(key) && obj.get(key).isJsonPrimitive()) {
            try {
                return obj.get(key).getAsLong();
            } catch (RuntimeException e) {
                return 0;
            }
        }
        return 0;
    }

    private static long parseTimestamp(String iso) {
        try {
            return Instant.parse(iso).toEpochMilli();
        } catch (RuntimeException e) {
            return -1;
        }
    }
}
