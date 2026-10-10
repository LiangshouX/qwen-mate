package com.qwenmate.usage;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Tests for the usage-statistics aggregation (Settings → 用量统计).
 *
 * <p>The semantics under test are the ones Qwen Code Desktop renders:
 * last-line-wins session dedup, calendar-day "today" vs rolling 7d/30d
 * windows filtered by record end timestamp, totalTokens = input + output
 * (thoughts excluded), cache ratio = cached / input, zero-filled daily
 * buckets, and the Monday-anchored 12-month heatmap.
 */
public class UsageStatsAggregatorTest {

    private static final ZoneId ZONE = ZoneId.systemDefault();
    /** Local noon so window boundaries (midnight) are never hit by rounding. */
    private static final long NOW = LocalDate.of(2026, 10, 9)
            .atTime(LocalTime.NOON).atZone(ZONE).toInstant().toEpochMilli();

    private static long at(LocalDate date, int hour) {
        return date.atTime(hour, 0).atZone(ZONE).toInstant().toEpochMilli();
    }

    private static JsonObject model(long requests, long in, long out, long cached, long think, long total) {
        JsonObject m = new JsonObject();
        m.addProperty("requests", requests);
        m.addProperty("inputTokens", in);
        m.addProperty("outputTokens", out);
        m.addProperty("cachedTokens", cached);
        m.addProperty("thoughtsTokens", think);
        m.addProperty("totalTokens", total);
        m.addProperty("totalLatencyMs", 1000L);
        return m;
    }

    private static JsonObject record(String sessionId, long timestamp, String modelName, JsonObject model) {
        JsonObject r = new JsonObject();
        r.addProperty("version", 1);
        r.addProperty("sessionId", sessionId);
        r.addProperty("timestamp", timestamp);
        r.addProperty("startTime", timestamp - 60_000);
        r.addProperty("project", "/tmp/proj");

        JsonObject models = new JsonObject();
        models.add(modelName, model);
        r.add("models", models);

        JsonObject tools = new JsonObject();
        tools.addProperty("totalCalls", 5);
        tools.addProperty("totalSuccess", 4);
        tools.addProperty("totalFail", 1);
        r.add("tools", tools);

        JsonObject files = new JsonObject();
        files.addProperty("linesAdded", 742);
        files.addProperty("linesRemoved", 11);
        r.add("files", files);

        JsonObject skill = new JsonObject();
        skill.addProperty("count", 2);
        skill.addProperty("success", 2);
        skill.addProperty("fail", 0);
        JsonObject byName = new JsonObject();
        byName.add("qc-helper", skill);
        JsonObject skills = new JsonObject();
        skills.addProperty("totalCalls", 2);
        skills.addProperty("totalSuccess", 2);
        skills.addProperty("totalFail", 0);
        skills.add("byName", byName);
        r.add("skills", skills);
        return r;
    }

    private static JsonObject payload(List<JsonObject> records) {
        UsageSnapshot snapshot = new UsageSnapshot(records, true, "/tmp/usage_record.jsonl", records.size(), 0);
        return UsageStatsAggregator.buildPayload(snapshot, NOW, "0.25.0", "0.18.0");
    }

    private static JsonObject window(JsonObject payload, String key) {
        return payload.getAsJsonObject("windows").getAsJsonObject(key);
    }

    @Test
    public void dedupKeepsLastLinePerSession() {
        JsonObject first = record("s1", at(LocalDate.of(2026, 10, 9), 8), "m", model(1, 1, 1, 0, 0, 2));
        JsonObject second = record("s1", at(LocalDate.of(2026, 10, 9), 9), "m", model(2, 2, 2, 0, 0, 4));
        JsonObject other = record("s2", at(LocalDate.of(2026, 10, 9), 9), "m", model(3, 3, 3, 0, 0, 6));

        List<JsonObject> deduped = UsageStatsAggregator.dedupLastWins(Arrays.asList(first, other, second));

        assertEquals(2, deduped.size());
        JsonObject s1 = deduped.stream()
                .filter(r -> r.get("sessionId").getAsString().equals("s1"))
                .findFirst().orElseThrow();
        assertEquals(at(LocalDate.of(2026, 10, 9), 9), s1.get("timestamp").getAsLong());
        // s1 contributes only its last segment (2 requests) alongside s2 (3) → 5 total,
        // not 6 from counting the stale first segment too.
        assertEquals(5, window(payload(deduped), "today").get("requests").getAsLong());
    }

    @Test
    public void todayIsCalendarDayWhileSevenDaysIsRolling() {
        JsonObject yesterday = record("old", at(LocalDate.of(2026, 10, 8), 23), "m",
                model(10, 1000, 100, 800, 50, 1100));
        JsonObject today = record("now", at(LocalDate.of(2026, 10, 9), 10), "m",
                model(2, 200, 20, 160, 10, 220));

        JsonObject p = payload(Arrays.asList(yesterday, today));

        assertEquals(1, window(p, "today").get("sessions").getAsLong());
        assertEquals(2, window(p, "today").get("requests").getAsLong());
        assertEquals(2, window(p, "d7").get("sessions").getAsLong());
        assertEquals(12, window(p, "d7").get("requests").getAsLong());
        // Rolling window starts 7*24h before noon Oct 9 → Oct 2 noon.
        assertTrue(window(p, "d7").get("daily").getAsJsonArray().size() >= 7);
    }

    @Test
    public void aggregatesTokensCountersModelsAndSkills() {
        JsonObject r = record("s1", at(LocalDate.of(2026, 10, 9), 10), "model-a",
                model(10, 1000, 100, 800, 50, 1100));
        r.getAsJsonObject("models").add("model-b", model(4, 400, 60, 100, 0, 460));

        JsonObject today = window(payload(List.of(r)), "today");

        assertEquals(1, today.get("sessions").getAsLong());
        assertEquals(14, today.get("requests").getAsLong());
        assertEquals(5, today.get("toolCalls").getAsLong());
        assertEquals(753, today.get("changes").getAsLong());
        assertEquals(1400, today.get("inputTokens").getAsLong());
        assertEquals(160, today.get("outputTokens").getAsLong());
        assertEquals(900, today.get("cachedTokens").getAsLong());
        assertEquals(50, today.get("thoughtsTokens").getAsLong());
        assertEquals(1560, today.get("totalTokens").getAsLong());
        // cache ratio = cached / input = 900 / 1400
        assertEquals(64.3, today.get("cachePct").getAsDouble(), 0.05);

        JsonArray models = today.getAsJsonArray("models");
        assertEquals(2, models.size());
        JsonObject top = models.get(0).getAsJsonObject();
        assertEquals("model-a", top.get("name").getAsString());
        assertEquals(1100, top.get("totalTokens").getAsLong());
        assertEquals(70.5, top.get("sharePct").getAsDouble(), 0.1);
        assertEquals(80.0, top.get("cachePct").getAsDouble(), 0.05);

        JsonArray skills = today.getAsJsonArray("skills");
        assertEquals(1, skills.size());
        assertEquals("qc-helper", skills.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals(2, skills.get(0).getAsJsonObject().get("count").getAsLong());
    }

    @Test
    public void dailyBucketsAreZeroFilledAndOrdered() {
        JsonObject first = record("a", at(LocalDate.of(2026, 10, 3), 10), "m", model(1, 10, 0, 0, 0, 10));
        JsonObject second = record("b", at(LocalDate.of(2026, 10, 9), 11), "m", model(1, 20, 0, 0, 0, 20));

        JsonArray daily = window(payload(Arrays.asList(first, second)), "d7").getAsJsonArray("daily");

        // Oct 2 noon → Oct 9 noon covers 8 local dates; Oct 2 is a partial day.
        assertEquals(8, daily.size());
        assertEquals("2026-10-02", daily.get(0).getAsJsonObject().get("date").getAsString());
        assertEquals("2026-10-09", daily.get(daily.size() - 1).getAsJsonObject().get("date").getAsString());
        assertEquals(0, daily.get(0).getAsJsonObject().get("tokens").getAsLong());
        assertEquals(10, daily.get(1).getAsJsonObject().get("tokens").getAsLong());
        assertEquals(0, daily.get(2).getAsJsonObject().get("tokens").getAsLong());
        assertEquals(20, daily.get(7).getAsJsonObject().get("tokens").getAsLong());

        long sessionSum = 0;
        for (int i = 0; i < daily.size(); i++) {
            sessionSum += daily.get(i).getAsJsonObject().get("sessions").getAsLong();
        }
        assertEquals(2, sessionSum);
    }

    @Test
    public void heatmapStartsOnMondayAndSpansTwelveMonths() {
        JsonObject old = record("old", at(LocalDate.of(2026, 8, 3), 9), "m", model(1, 100, 0, 0, 0, 100));
        JsonObject recent = record("new", at(LocalDate.of(2026, 10, 9), 9), "m", model(1, 50, 0, 0, 0, 50));

        JsonObject heatmap = payload(Arrays.asList(old, recent)).getAsJsonObject("heatmap");

        LocalDate start = LocalDate.parse(heatmap.get("start").getAsString());
        assertEquals(java.time.DayOfWeek.MONDAY, start.getDayOfWeek());
        // 12 months back from Oct 2026 → first day is 2025-11-01, backed to Monday.
        assertTrue(!start.isAfter(LocalDate.of(2025, 11, 3)));
        assertTrue(!start.isBefore(LocalDate.of(2025, 9, 1)));
        assertEquals("2026-10-09", heatmap.get("today").getAsString());

        JsonObject days = heatmap.getAsJsonObject("days");
        assertEquals(100, days.get("2026-08-03").getAsLong());
        assertEquals(50, days.get("2026-10-09").getAsLong());
        assertEquals(100, heatmap.get("maxDayTokens").getAsLong());
    }

    @Test
    public void payloadReportsUnsupportedWhenDataFileIsMissing() {
        UsageSnapshot snapshot = new UsageSnapshot(List.of(), false, "/tmp/usage_record.jsonl", 0, 0);
        JsonObject p = UsageStatsAggregator.buildPayload(snapshot, NOW, null, "0.16.0");

        assertFalse(p.get("supported").getAsBoolean());
        assertFalse(p.get("dataFileExists").getAsBoolean());
        assertEquals("0.16.0", p.get("minSupportedVersion").getAsString());
        assertEquals(0, window(p, "today").get("sessions").getAsLong());
    }

    @Test
    public void parseRecordRejectsGarbageAndOtherSchemaVersions() {
        assertNull(UsageDataStore.parseRecord(""));
        assertNull(UsageDataStore.parseRecord("not json"));
        assertNull(UsageDataStore.parseRecord("{\"version\":2,\"sessionId\":\"x\",\"timestamp\":1}"));
        assertNull(UsageDataStore.parseRecord("{\"sessionId\":\"x\"}"));
        assertNotNull(UsageDataStore.parseRecord(
                "{\"version\":1,\"sessionId\":\"x\",\"timestamp\":123}"));
    }

    @Test
    public void transcriptTelemetryRebuildMatchesPersistedFields() throws IOException {
        Path chat = Files.createTempFile("usage-live", ".jsonl");
        try {
            Files.write(chat, Arrays.asList(
                    "{\"timestamp\":\"2026-10-09T02:00:00.000Z\",\"type\":\"system\",\"cwd\":\"D:\\\\proj\","
                            + "\"version\":\"0.25.0\",\"subtype\":\"ui_telemetry\",\"systemPayload\":{\"uiEvent\":{"
                            + "\"event.name\":\"qwen-code.api_response\",\"model\":\"mimo-v2.6-flash\","
                            + "\"duration_ms\":1000,\"input_token_count\":100,\"output_token_count\":10,"
                            + "\"cached_content_token_count\":80,\"thoughts_token_count\":5,"
                            + "\"total_token_count\":110}}}",
                    "{\"timestamp\":\"2026-10-09T02:00:01.000Z\",\"type\":\"system\","
                            + "\"subtype\":\"ui_telemetry\",\"systemPayload\":{\"uiEvent\":{"
                            + "\"event.name\":\"qwen-code.tool_call\",\"function_name\":\"edit\","
                            + "\"duration_ms\":50,\"success\":true,"
                            + "\"metadata\":{\"model_added_lines\":7,\"model_removed_lines\":3,"
                            + "\"user_added_lines\":1,\"user_removed_lines\":0}}}}",
                    "{\"timestamp\":\"2026-10-09T02:00:02.000Z\",\"type\":\"user\"}"),
                    StandardCharsets.UTF_8);

            JsonObject rebuilt = UsageDataStore.parseTranscript(chat, "live-session");

            assertNotNull(rebuilt);
            assertEquals("live-session", rebuilt.get("sessionId").getAsString());
            assertEquals("D:\\proj", rebuilt.get("project").getAsString());
            assertEquals(2000, rebuilt.get("durationMs").getAsLong());

            JsonObject model = rebuilt.getAsJsonObject("models").getAsJsonObject("mimo-v2.6-flash");
            assertEquals(1, model.get("requests").getAsLong());
            assertEquals(100, model.get("inputTokens").getAsLong());
            assertEquals(110, model.get("totalTokens").getAsLong());
            assertEquals(1000, model.get("totalLatencyMs").getAsLong());

            JsonObject tools = rebuilt.getAsJsonObject("tools");
            assertEquals(1, tools.get("totalCalls").getAsLong());
            assertEquals(1, tools.get("totalSuccess").getAsLong());
            assertEquals(50,
                    tools.getAsJsonObject("byName").getAsJsonObject("edit").get("totalDurationMs").getAsLong());

            JsonObject files = rebuilt.getAsJsonObject("files");
            assertEquals(8, files.get("linesAdded").getAsLong());
            assertEquals(3, files.get("linesRemoved").getAsLong());
        } finally {
            Files.deleteIfExists(chat);
        }
    }

    @Test
    public void transcriptWithoutTelemetryYieldsNoRecord() throws IOException {
        Path chat = Files.createTempFile("usage-empty", ".jsonl");
        try {
            Files.write(chat, List.of("{\"timestamp\":\"2026-10-09T02:00:00.000Z\",\"type\":\"user\"}"),
                    StandardCharsets.UTF_8);
            assertNull(UsageDataStore.parseTranscript(chat, "no-events"));
        } finally {
            Files.deleteIfExists(chat);
        }
    }

    @Test
    public void supportedPayloadCarriesCliVersionMetadata() {
        JsonObject p = payload(List.of(record("s", NOW, "m", model(1, 1, 0, 0, 0, 1))));
        assertTrue(p.get("supported").getAsBoolean());
        assertEquals("0.25.0", p.get("cliVersion").getAsString());
        assertEquals("0.18.0", p.get("minSupportedVersion").getAsString());
        assertEquals(NOW, p.get("latestRecordMs").getAsLong());
        assertEquals("/tmp/usage_record.jsonl", p.get("dataFile").getAsString());
    }
}
