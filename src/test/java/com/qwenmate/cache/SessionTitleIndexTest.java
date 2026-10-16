package com.qwenmate.cache;

import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * Tests for the session-title resolver backing the usage-stats session
 * dimension (Settings → 用量统计).
 *
 * <p>Priority mirrors the history panel: the user-edited customTitle in
 * {@code session-titles.json} wins over the transcript-derived title cached
 * in {@code session-index.json}; unresolvable or corrupt sources degrade to
 * "no title" (the frontend falls back to a truncated session id).
 */
public class SessionTitleIndexTest {

    private static Map<String, String> titles(Path dir, String indexJson, String customJson)
            throws IOException {
        Path cacheDir = Files.createDirectories(dir.resolve("cache"));
        if (indexJson != null) {
            Files.writeString(cacheDir.resolve("session-index.json"), indexJson, StandardCharsets.UTF_8);
        }
        if (customJson != null) {
            Files.writeString(dir.resolve("session-titles.json"), customJson, StandardCharsets.UTF_8);
        }
        return SessionTitleIndex.loadTitles(dir);
    }

    @Test
    public void customTitleOverridesIndexTitle() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Map<String, String> resolved = titles(
                dir,
                "{\"version\":9,\"projects\":{\"D\\\\proj\":{\"sessions\":["
                        + "{\"sessionId\":\"s1\",\"title\":\"转录派生标题\"},"
                        + "{\"sessionId\":\"s2\",\"title\":\"另一个标题\"}]}}}",
                "{\"s1\":{\"customTitle\":\"手动改名\"}}");

        assertEquals("手动改名", resolved.get("s1"));
        assertEquals("另一个标题", resolved.get("s2"));
    }

    @Test
    public void indexTitlesMergeAcrossProjects() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Map<String, String> resolved = titles(
                dir,
                "{\"version\":9,\"projects\":{"
                        + "\"D\\\\a\":{\"sessions\":[{\"sessionId\":\"s1\",\"title\":\"A 项目会话\"}]},"
                        + "\"D\\\\b\":{\"sessions\":[{\"sessionId\":\"s2\",\"title\":\"B 项目会话\"}]}}}",
                null);

        assertEquals("A 项目会话", resolved.get("s1"));
        assertEquals("B 项目会话", resolved.get("s2"));
    }

    @Test
    public void corruptOrMissingSourcesYieldEmptyMap() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        assertTrue(titles(dir, "not json at all", "{\"broken\":").isEmpty());

        Path clean = Files.createTempDirectory("qwenmate-titles");
        assertTrue(titles(clean, null, null).isEmpty());
    }

    @Test
    public void blankTitlesAreSkipped() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Map<String, String> resolved = titles(
                dir,
                "{\"version\":9,\"projects\":{\"D\\\\a\":{\"sessions\":[{\"sessionId\":\"s1\",\"title\":\"  \"}]}}}",
                "{\"s2\":{\"customTitle\":\"\"}}");

        assertTrue(resolved.isEmpty());
    }

    @Test
    public void backfillResolvesUntitledSessionsThroughTheProjectChain() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Path cacheDir = Files.createDirectories(dir.resolve("cache"));
        Files.writeString(cacheDir.resolve("session-index.json"),
                "{\"version\":9,\"projects\":{\"D\\\\a\":{\"sessions\":["
                        + "{\"sessionId\":\"s1\",\"title\":\"索引里的标题\"}]}}}",
                StandardCharsets.UTF_8);
        // s1 comes from the index; s2/s3 are only resolvable via the loader.
        Map<String, String> resolved = SessionTitleIndex.loadTitles(
                dir,
                Map.of("s1", "D:\\a", "s2", "D:\\b", "s3", "D:\\b"),
                project -> "D:\\b".equals(project)
                        ? Map.of("s2", "转录派生标题", "s3", "另一个标题")
                        : Map.of());

        assertEquals("索引里的标题", resolved.get("s1"));
        assertEquals("转录派生标题", resolved.get("s2"));
        assertEquals("另一个标题", resolved.get("s3"));
    }

    @Test
    public void customTitleWinsOverBackfill() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Files.writeString(dir.resolve("session-titles.json"),
                "{\"s1\":{\"customTitle\":\"手动改名\"}}", StandardCharsets.UTF_8);

        Map<String, String> resolved = SessionTitleIndex.loadTitles(
                dir,
                Map.of("s1", "D:\\a"),
                project -> Map.of("s1", "转录派生标题"));

        assertEquals("手动改名", resolved.get("s1"));
    }

    @Test
    public void backfillLoaderFailuresDegradeToUnresolvedTitles() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        Map<String, String> resolved = SessionTitleIndex.loadTitles(
                dir,
                Map.of("s1", "D:\\gone"),
                project -> {
                    throw new IllegalStateException("index build exploded");
                });

        assertTrue(resolved.isEmpty());
    }

    @Test
    public void untitledSessionsDoNotPoisonTheCacheForLaterLoads() throws IOException {
        Path dir = Files.createTempDirectory("qwenmate-titles");
        // First load: loader knows nothing yet.
        assertTrue(SessionTitleIndex.loadTitles(
                dir, Map.of("s1", "D:\\a"), project -> Map.of()).isEmpty());
        // Second load with the same sources: the still-missing id forces a
        // recompute, so a now-available title is picked up.
        Map<String, String> resolved = SessionTitleIndex.loadTitles(
                dir, Map.of("s1", "D:\\a"), project -> Map.of("s1", "后来解析出的标题"));

        assertEquals("后来解析出的标题", resolved.get("s1"));
    }
}
