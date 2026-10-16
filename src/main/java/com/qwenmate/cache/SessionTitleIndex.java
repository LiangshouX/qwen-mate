package com.qwenmate.cache;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;
import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.provider.qwen.QwenHistoryReader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Resolves display titles for sessions (Settings → 用量统计, session dimension).
 *
 * <p>Mirrors the history panel's title chain, in priority order:
 * <ul>
 *   <li>{@code ~/.qwenmate/session-titles.json} — user-edited custom titles,
 *       which override everything below;</li>
 *   <li>{@code ~/.qwenmate/cache/session-index.json} — per-project titles the
 *       history panel derived from transcripts (recording title, else the first
 *       user prompt);</li>
 *   <li>backfill: for still-untitled <em>needed</em> sessions, the history
 *       panel's own per-project chain ({@code QwenHistoryReader} → shared
 *       transcript parse) is consulted — it also persists fresh titles back
 *       into the session index, so coverage grows with every refresh instead
 *       of being re-derived each time.</li>
 * </ul>
 *
 * <p>Sessions with neither source (transcript deleted) get no entry; the
 * frontend falls back to a local date-time label. Results are cached until
 * either source file changes or a newly needed session id is absent.
 */
public final class SessionTitleIndex {

    private static final Logger LOG = Logger.getInstance(SessionTitleIndex.class);

    private static final String TITLES_FILE = "session-titles.json";
    private static final String INDEX_DIR = "cache";
    private static final String INDEX_FILE = "session-index.json";

    private static final class CacheEntry {
        final Path dir;
        final String signature;
        final Map<String, String> titles;

        CacheEntry(Path dir, String signature, Map<String, String> titles) {
            this.dir = dir;
            this.signature = signature;
            this.titles = titles;
        }
    }

    private static volatile CacheEntry cached;

    private SessionTitleIndex() {
    }

    /** Disk-only variant (source files as of their last index build). */
    public static Map<String, String> loadTitles(Path qwenMateDir) {
        return loadTitles(qwenMateDir, Map.of(), project -> Map.of());
    }

    /**
     * Titles for the given {@code sessionId → project} map, backfilling from
     * the history panel's per-project chain for sessions the two source files
     * do not cover yet.
     */
    public static Map<String, String> loadTitles(Path qwenMateDir,
                                                 Map<String, String> sessionProjects) {
        return loadTitles(qwenMateDir, sessionProjects, SessionTitleIndex::loadProjectTitles);
    }

    /**
     * Test seam: {@code projectLoader} resolves one project's {@code sessionId → title}
     * map through the history chain (production) or a fixture (tests).
     */
    static Map<String, String> loadTitles(Path qwenMateDir,
                                          Map<String, String> sessionProjects,
                                          Function<String, Map<String, String>> projectLoader) {
        Path customFile = qwenMateDir.resolve(TITLES_FILE);
        Path indexFile = qwenMateDir.resolve(INDEX_DIR).resolve(INDEX_FILE);
        String signature = signature(customFile) + "|" + signature(indexFile);

        CacheEntry entry = cached;
        if (entry != null && entry.dir.equals(qwenMateDir) && entry.signature.equals(signature)
                && entry.titles.keySet().containsAll(sessionProjects.keySet())) {
            return entry.titles;
        }

        Map<String, String> titles = new HashMap<>();
        // Index titles first: custom titles below override them.
        readIndexTitles(indexFile, titles);
        readCustomTitles(customFile, titles);
        backfillMissingTitles(titles, sessionProjects, projectLoader);

        cached = new CacheEntry(qwenMateDir, signature, Map.copyOf(titles));
        return cached.titles;
    }

    /**
     * Resolves titles for needed sessions the sources did not cover, one
     * project at a time. Only projects with untitled sessions are touched, and
     * the history chain serves unchanged projects from its own warm caches.
     */
    private static void backfillMissingTitles(Map<String, String> titles,
                                              Map<String, String> sessionProjects,
                                              Function<String, Map<String, String>> projectLoader) {
        Map<String, List<String>> missingByProject = new LinkedHashMap<>();
        for (Map.Entry<String, String> session : sessionProjects.entrySet()) {
            String sessionId = session.getKey();
            if (sessionId == null || sessionId.isBlank() || titles.containsKey(sessionId)) {
                continue;
            }
            String project = session.getValue();
            if (project == null || project.isBlank()) {
                continue;
            }
            missingByProject.computeIfAbsent(project, key -> new ArrayList<>()).add(sessionId);
        }
        for (Map.Entry<String, List<String>> projectEntry : missingByProject.entrySet()) {
            Map<String, String> loaded;
            try {
                loaded = projectLoader.apply(projectEntry.getKey());
            } catch (RuntimeException e) {
                LOG.warn("[SessionTitleIndex] Backfill failed for " + projectEntry.getKey()
                        + ": " + e.getMessage());
                continue;
            }
            for (String sessionId : projectEntry.getValue()) {
                String title = loaded.get(sessionId);
                if (title != null && !title.isBlank()) {
                    titles.putIfAbsent(sessionId, title);
                }
            }
        }
    }

    /**
     * The history panel's per-project title source: parses the project's
     * transcripts through the shared index chain and returns
     * {@code sessionId → title} (empty on failure — display-only decoration).
     */
    private static Map<String, String> loadProjectTitles(String projectPath) {
        String json = new QwenHistoryReader().getSessionsForProjectAsJson(projectPath);
        Map<String, String> result = new HashMap<>();
        try {
            JsonObject root = JsonParser.parseString(json).getAsJsonObject();
            if (!root.has("success") || !root.get("success").getAsBoolean()
                    || !root.has("sessions") || !root.get("sessions").isJsonArray()) {
                return result;
            }
            for (JsonElement element : root.getAsJsonArray("sessions")) {
                if (!element.isJsonObject()) {
                    continue;
                }
                JsonObject session = element.getAsJsonObject();
                String sessionId = stringValue(session, "sessionId");
                String title = stringValue(session, "title");
                if (sessionId != null && title != null) {
                    result.put(sessionId, title);
                }
            }
        } catch (RuntimeException e) {
            LOG.warn("[SessionTitleIndex] Unreadable project response: " + e.getMessage());
        }
        return result;
    }

    /**
     * Walks every project's {@code sessions[]} in the durable session index and
     * records {@code sessionId → title}. Malformed files and entries are skipped;
     * this map is display-only decoration, never load-bearing.
     */
    private static void readIndexTitles(Path indexFile, Map<String, String> titles) {
        JsonObject root = parseObject(indexFile);
        if (root == null || !root.has("projects") || !root.get("projects").isJsonObject()) {
            return;
        }
        for (Map.Entry<String, JsonElement> projectEl : root.getAsJsonObject("projects").entrySet()) {
            if (!projectEl.getValue().isJsonObject()) {
                continue;
            }
            JsonObject project = projectEl.getValue().getAsJsonObject();
            if (!project.has("sessions") || !project.get("sessions").isJsonArray()) {
                continue;
            }
            for (JsonElement sessionEl : project.getAsJsonArray("sessions")) {
                if (!sessionEl.isJsonObject()) {
                    continue;
                }
                JsonObject session = sessionEl.getAsJsonObject();
                String sessionId = stringValue(session, "sessionId");
                String title = stringValue(session, "title");
                if (sessionId != null && title != null) {
                    titles.putIfAbsent(sessionId, title);
                }
            }
        }
    }

    /** Records {@code sessionId → customTitle}; only user edits live here. */
    private static void readCustomTitles(Path customFile, Map<String, String> titles) {
        JsonObject root = parseObject(customFile);
        if (root == null) {
            return;
        }
        for (Map.Entry<String, JsonElement> entry : root.entrySet()) {
            if (!entry.getValue().isJsonObject()) {
                continue;
            }
            String title = stringValue(entry.getValue().getAsJsonObject(), "customTitle");
            if (title != null) {
                titles.put(entry.getKey(), title);
            }
        }
    }

    private static JsonObject parseObject(Path file) {
        if (!Files.isRegularFile(file)) {
            return null;
        }
        try {
            String content = Files.readString(file, StandardCharsets.UTF_8);
            return JsonParser.parseString(content).getAsJsonObject();
        } catch (IOException | RuntimeException e) {
            LOG.warn("[SessionTitleIndex] Failed to read " + file.getFileName() + ": " + e.getMessage());
            return null;
        }
    }

    private static String signature(Path file) {
        try {
            if (!Files.isRegularFile(file)) {
                return "absent";
            }
            return Files.getLastModifiedTime(file).toMillis() + ":" + Files.size(file);
        } catch (IOException e) {
            return "unreadable";
        }
    }

    private static String stringValue(JsonObject obj, String key) {
        if (obj.has(key) && obj.get(key).isJsonPrimitive()) {
            String value = obj.get(key).getAsString();
            return value.isBlank() ? null : value;
        }
        return null;
    }

    /** Default location of the titles sources ({@code ~/.qwenmate}). */
    static Path defaultDir() {
        return Paths.get(NodeDetector.resolveHomeForFileOps(), ".qwenmate");
    }
}
