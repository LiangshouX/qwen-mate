package com.qwenmate.usage;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the usage-statistics payload consumed by the settings page
 * (Settings → 用量统计).
 *
 * <p>Aggregation semantics mirror qwen-code's own {@code aggregateUsage()},
 * which is what Qwen Code Desktop renders:
 * <ul>
 *   <li>records are deduplicated per sessionId (last line wins);</li>
 *   <li>a window filters by the record's end {@code timestamp}: "today" is the
 *       local calendar day, "7d"/"30d" are rolling windows from now;</li>
 *   <li>{@code totalTokens} sums per-model {@code totalTokens} (= input +
 *       output, thoughts excluded — matching the CLI's
 *       {@code metricsToUsageRecord()});</li>
 *   <li>the "输入" card shows {@code inputTokens} (which already includes cache
 *       reads), "输出" shows output + thoughts, and the cache ratio is
 *       {@code cached / input};</li>
 *   <li>daily charts bucket each record by the local date of its end
 *       timestamp, so a rolling window's first day is a partial day — the same
 *       shape Desktop's line chart shows.</li>
 * </ul>
 */
public final class UsageStatsAggregator {

    public static final String WINDOW_TODAY = "today";
    public static final String WINDOW_7D = "d7";
    public static final String WINDOW_30D = "d30";

    /** Heatmap covers this many calendar months (the current one included). */
    public static final int HEATMAP_MONTHS = 12;

    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final long DAY_MS = 24L * 60 * 60 * 1000;
    private static final int TOP_SKILLS = 10;

    private UsageStatsAggregator() {
    }

    /**
     * Deduplicates records per sessionId keeping the last occurrence in file
     * order — identical to qwen-code's {@code dedupBySessionId()} (Map.set
     * semantics while iterating in order).
     */
    public static List<JsonObject> dedupLastWins(List<JsonObject> records) {
        Map<String, JsonObject> bySession = new LinkedHashMap<>();
        for (JsonObject record : records) {
            if (record == null || !record.has("sessionId")) {
                continue;
            }
            bySession.put(record.get("sessionId").getAsString(), record);
        }
        return new ArrayList<>(bySession.values());
    }

    /**
     * Builds the full payload: metadata, the three time windows, and the
     * 12-month daily heatmap.
     *
     * @param snapshot          merged dataset (already deduplicated)
     * @param nowMs             evaluation time (injectable for tests)
     * @param cliVersion        detected Qwen Code CLI version, may be null
     * @param minSupportedVersion minimum version that records usage data
     */
    public static JsonObject buildPayload(
            UsageSnapshot snapshot,
            long nowMs,
            String cliVersion,
            String minSupportedVersion
    ) {
        return buildPayload(snapshot, nowMs, cliVersion, minSupportedVersion, Map.of());
    }

    /**
     * Dimension-aware variant: additionally groups each window by project
     * (full stats per group, including the daily series the charts need) and
     * by session (slim stats; the per-day series for a selected session is
     * rebuilt from its transcript on demand). Session groups carry a
     * {@code title} when {@code sessionTitles} provides one — the same title
     * chain the history panel renders; sessions without one fall back to a
     * truncated id on the frontend.
     *
     * @param sessionTitles sessionId → display title (see SessionTitleIndex)
     */
    public static JsonObject buildPayload(
            UsageSnapshot snapshot,
            long nowMs,
            String cliVersion,
            String minSupportedVersion,
            Map<String, String> sessionTitles
    ) {
        ZoneId zone = ZoneId.systemDefault();
        List<JsonObject> records = snapshot.records;

        JsonObject payload = new JsonObject();
        payload.addProperty("generatedAtMs", nowMs);
        payload.addProperty("supported", snapshot.dataFileExists && !records.isEmpty());
        payload.addProperty("dataFileExists", snapshot.dataFileExists);
        payload.addProperty("dataFile", snapshot.dataFile);
        payload.addProperty("recordCount", snapshot.rawRecordCount);
        payload.addProperty("sessionCount", records.size());
        payload.addProperty("liveSessionCount", snapshot.liveSessionCount);
        payload.addProperty("cliVersion", cliVersion == null ? "" : cliVersion);
        payload.addProperty("minSupportedVersion", minSupportedVersion);

        long earliest = 0;
        long latest = 0;
        for (JsonObject record : records) {
            long ts = longField(record, "timestamp");
            if (earliest == 0 || (ts > 0 && ts < earliest)) {
                earliest = ts;
            }
            if (ts > latest) {
                latest = ts;
            }
        }
        payload.addProperty("earliestRecordMs", earliest);
        payload.addProperty("latestRecordMs", latest);

        long todayStartMs = startOfDayMs(nowMs, zone);
        JsonObject windows = new JsonObject();
        windows.add(WINDOW_TODAY, windowStats(records, todayStartMs, nowMs, zone));
        windows.add(WINDOW_7D, windowStats(records, nowMs - 7 * DAY_MS, nowMs, zone));
        windows.add(WINDOW_30D, windowStats(records, nowMs - 30 * DAY_MS, nowMs, zone));
        payload.add("windows", windows);

        payload.add("heatmap", heatmapStats(records, nowMs, zone));

        JsonObject dimensions = new JsonObject();
        JsonObject projects = new JsonObject();
        projects.add(WINDOW_TODAY, projectGroups(records, todayStartMs, nowMs, zone));
        projects.add(WINDOW_7D, projectGroups(records, nowMs - 7 * DAY_MS, nowMs, zone));
        projects.add(WINDOW_30D, projectGroups(records, nowMs - 30 * DAY_MS, nowMs, zone));
        dimensions.add("projects", projects);
        JsonObject sessions = new JsonObject();
        sessions.add(WINDOW_TODAY, sessionGroups(records, todayStartMs, nowMs, zone, sessionTitles));
        sessions.add(WINDOW_7D, sessionGroups(records, nowMs - 7 * DAY_MS, nowMs, zone, sessionTitles));
        sessions.add(WINDOW_30D, sessionGroups(records, nowMs - 30 * DAY_MS, nowMs, zone, sessionTitles));
        dimensions.add("sessions", sessions);
        payload.add("dimensions", dimensions);
        return payload;
    }

    /** Window aggregate: headline counters, token split, models, skills, daily buckets. */
    static JsonObject windowStats(List<JsonObject> records, long startMs, long endMs, ZoneId zone) {
        return windowStats(records, startMs, endMs, zone, true);
    }

    /**
     * Window aggregate with an optional daily series. Group rows pass
     * {@code withDaily=false}: a session's own tokens all land on one bucket
     * anyway, and dropping the zero-filled series keeps a 30-day window's
     * session list from bloating the payload.
     */
    static JsonObject windowStats(List<JsonObject> records, long startMs, long endMs,
                                  ZoneId zone, boolean withDaily) {
        long sessions = 0;
        long requests = 0;
        long toolCalls = 0;
        long linesAdded = 0;
        long linesRemoved = 0;
        long input = 0;
        long output = 0;
        long cached = 0;
        long thoughts = 0;
        long total = 0;

        Map<String, long[]> models = new LinkedHashMap<>();  // [requests, in, out, cache, think, total]
        Map<String, Long> skills = new LinkedHashMap<>();
        Map<String, long[]> daily = new LinkedHashMap<>();   // date -> [tokens, sessions]

        for (JsonObject record : records) {
            long ts = longField(record, "timestamp");
            if (ts < startMs || ts > endMs) {
                continue;
            }
            sessions++;

            long recordTotal = 0;
            JsonObject modelsJson = record.getAsJsonObject("models");
            if (modelsJson != null) {
                for (Map.Entry<String, com.google.gson.JsonElement> entry : modelsJson.entrySet()) {
                    if (!entry.getValue().isJsonObject()) {
                        continue;
                    }
                    JsonObject m = entry.getValue().getAsJsonObject();
                    long mReq = longField(m, "requests");
                    long mIn = longField(m, "inputTokens");
                    long mOut = longField(m, "outputTokens");
                    long mCache = longField(m, "cachedTokens");
                    long mThink = longField(m, "thoughtsTokens");
                    long mTotal = m.has("totalTokens")
                            ? longField(m, "totalTokens") : mIn + mOut;

                    requests += mReq;
                    input += mIn;
                    output += mOut;
                    cached += mCache;
                    thoughts += mThink;
                    total += mTotal;
                    recordTotal += mTotal;

                    long[] agg = models.computeIfAbsent(entry.getKey(), k -> new long[6]);
                    agg[0] += mReq;
                    agg[1] += mIn;
                    agg[2] += mOut;
                    agg[3] += mCache;
                    agg[4] += mThink;
                    agg[5] += mTotal;
                }
            }

            JsonObject tools = record.getAsJsonObject("tools");
            if (tools != null) {
                toolCalls += longField(tools, "totalCalls");
            }
            JsonObject files = record.getAsJsonObject("files");
            if (files != null) {
                linesAdded += longField(files, "linesAdded");
                linesRemoved += longField(files, "linesRemoved");
            }
            JsonObject skillsJson = record.getAsJsonObject("skills");
            if (skillsJson != null && skillsJson.has("byName") && skillsJson.get("byName").isJsonObject()) {
                for (Map.Entry<String, com.google.gson.JsonElement> entry :
                        skillsJson.getAsJsonObject("byName").entrySet()) {
                    if (!entry.getValue().isJsonObject()) {
                        continue;
                    }
                    long count = longField(entry.getValue().getAsJsonObject(), "count");
                    skills.merge(entry.getKey(), count, Long::sum);
                }
            }

            String day = Instant.ofEpochMilli(ts).atZone(zone).toLocalDate().format(ISO_DATE);
            long[] bucket = daily.computeIfAbsent(day, k -> new long[2]);
            bucket[0] += recordTotal;
            bucket[1]++;
        }

        JsonObject stats = new JsonObject();
        stats.addProperty("startMs", startMs);
        stats.addProperty("endMs", endMs);
        stats.addProperty("sessions", sessions);
        stats.addProperty("requests", requests);
        stats.addProperty("toolCalls", toolCalls);
        stats.addProperty("changes", linesAdded + linesRemoved);
        stats.addProperty("linesAdded", linesAdded);
        stats.addProperty("linesRemoved", linesRemoved);
        stats.addProperty("inputTokens", input);
        stats.addProperty("outputTokens", output);
        stats.addProperty("cachedTokens", cached);
        stats.addProperty("thoughtsTokens", thoughts);
        stats.addProperty("totalTokens", total);
        stats.addProperty("cachePct", input > 0 ? round1(cached * 100.0 / input) : 0);

        // Models ranked by token share (the Desktop "模型份额" list).
        List<Map.Entry<String, long[]>> ranked = new ArrayList<>(models.entrySet());
        ranked.sort((a, b) -> Long.compare(b.getValue()[5], a.getValue()[5]));
        JsonArray modelArray = new JsonArray();
        for (Map.Entry<String, long[]> entry : ranked) {
            long[] m = entry.getValue();
            JsonObject model = new JsonObject();
            model.addProperty("name", entry.getKey());
            model.addProperty("requests", m[0]);
            model.addProperty("inputTokens", m[1]);
            model.addProperty("outputTokens", m[2]);
            model.addProperty("cachedTokens", m[3]);
            model.addProperty("thoughtsTokens", m[4]);
            model.addProperty("totalTokens", m[5]);
            model.addProperty("sharePct", total > 0 ? round1(m[5] * 100.0 / total) : 0);
            model.addProperty("cachePct", m[1] > 0 ? round1(m[3] * 100.0 / m[1]) : 0);
            modelArray.add(model);
        }
        stats.add("models", modelArray);

        List<Map.Entry<String, Long>> rankedSkills = new ArrayList<>(skills.entrySet());
        rankedSkills.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        JsonArray skillArray = new JsonArray();
        for (Map.Entry<String, Long> entry : rankedSkills) {
            if (skillArray.size() >= TOP_SKILLS) {
                break;
            }
            JsonObject skill = new JsonObject();
            skill.addProperty("name", entry.getKey());
            skill.addProperty("count", entry.getValue());
            skillArray.add(skill);
        }
        stats.add("skills", skillArray);

        // Zero-filled daily buckets so charts keep a continuous x axis.
        JsonArray dailyArray = new JsonArray();
        if (withDaily) {
            LocalDate cursor = Instant.ofEpochMilli(startMs).atZone(zone).toLocalDate();
            LocalDate last = Instant.ofEpochMilli(endMs).atZone(zone).toLocalDate();
            while (!cursor.isAfter(last)) {
                String key = cursor.format(ISO_DATE);
                long[] bucket = daily.getOrDefault(key, new long[2]);
                JsonObject day = new JsonObject();
                day.addProperty("date", key);
                day.addProperty("tokens", bucket[0]);
                day.addProperty("sessions", bucket[1]);
                dailyArray.add(day);
                cursor = cursor.plusDays(1);
            }
        }
        stats.add("daily", dailyArray);
        return stats;
    }

    /**
     * 12-month heatmap: {@code start} is the Monday of the week containing the
     * first day of the month 11 months ago (so month labels line up like the
     * Desktop heatmap), {@code today} marks the last real cell, {@code days}
     * is a sparse date → tokens map, and {@code cachePct} is a sparse
     * date → daily cache ratio (cached / input, 0-100) for the hover tooltip.
     */
    static JsonObject heatmapStats(List<JsonObject> records, long nowMs, ZoneId zone) {
        LocalDate today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate();
        LocalDate firstDay = today.withDayOfMonth(1).minusMonths(HEATMAP_MONTHS - 1L);
        LocalDate start = firstDay.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        long startMs = start.atStartOfDay(zone).toInstant().toEpochMilli();

        Map<String, long[]> days = new LinkedHashMap<>();   // date -> [tokens, input, cached]
        for (JsonObject record : records) {
            long ts = longField(record, "timestamp");
            if (ts < startMs || ts > nowMs) {
                continue;
            }
            long tokens = 0;
            long input = 0;
            long cached = 0;
            JsonObject modelsJson = record.getAsJsonObject("models");
            if (modelsJson != null) {
                for (Map.Entry<String, com.google.gson.JsonElement> entry : modelsJson.entrySet()) {
                    if (!entry.getValue().isJsonObject()) {
                        continue;
                    }
                    JsonObject m = entry.getValue().getAsJsonObject();
                    tokens += m.has("totalTokens")
                            ? longField(m, "totalTokens")
                            : longField(m, "inputTokens") + longField(m, "outputTokens");
                    input += longField(m, "inputTokens");
                    cached += longField(m, "cachedTokens");
                }
            }
            String day = Instant.ofEpochMilli(ts).atZone(zone).toLocalDate().format(ISO_DATE);
            long[] bucket = days.computeIfAbsent(day, k -> new long[3]);
            bucket[0] += tokens;
            bucket[1] += input;
            bucket[2] += cached;
        }

        JsonObject heatmap = new JsonObject();
        heatmap.addProperty("start", start.format(ISO_DATE));
        heatmap.addProperty("today", today.format(ISO_DATE));
        JsonObject daysJson = new JsonObject();
        JsonObject cacheJson = new JsonObject();
        long max = 0;
        for (Map.Entry<String, long[]> entry : days.entrySet()) {
            long[] value = entry.getValue();
            daysJson.addProperty(entry.getKey(), value[0]);
            max = Math.max(max, value[0]);
            // Days with no input tokens have no meaningful ratio — omit them.
            if (value[1] > 0) {
                cacheJson.addProperty(entry.getKey(), round1(value[2] * 100.0 / value[1]));
            }
        }
        heatmap.add("days", daysJson);
        heatmap.add("cachePct", cacheJson);
        heatmap.addProperty("maxDayTokens", max);
        return heatmap;
    }

    /**
     * Per-project groups of one window, ranked by token share — the same
     * shape qwen-code's {@code aggregateUsage()} exposes as {@code projects}.
     * Each group is a full window-stats object (daily series included, the
     * project detail view charts it) plus the raw {@code project} path; the
     * frontend derives the display name from it.
     */
    static JsonArray projectGroups(List<JsonObject> records, long startMs, long endMs, ZoneId zone) {
        Map<String, List<JsonObject>> byProject = new LinkedHashMap<>();
        for (JsonObject record : records) {
            long ts = longField(record, "timestamp");
            if (ts < startMs || ts > endMs) {
                continue;
            }
            String project = record.has("project") && record.get("project").isJsonPrimitive()
                    ? record.get("project").getAsString()
                    : "";
            byProject.computeIfAbsent(project, k -> new ArrayList<>()).add(record);
        }

        List<JsonObject> groups = new ArrayList<>();
        for (Map.Entry<String, List<JsonObject>> entry : byProject.entrySet()) {
            JsonObject stats = windowStats(entry.getValue(), startMs, endMs, zone);
            stats.addProperty("project", entry.getKey());
            groups.add(stats);
        }
        groups.sort((a, b) -> Long.compare(b.get("totalTokens").getAsLong(), a.get("totalTokens").getAsLong()));
        JsonArray array = new JsonArray();
        for (JsonObject group : groups) {
            array.add(group);
        }
        return array;
    }

    /**
     * Per-session rows of one window, most recent first. Rows are slim — the
     * zero-filled daily series is dropped (a session record buckets onto a
     * single day anyway) and the per-day line chart is fetched on demand from
     * the transcript when the user selects a session that spans days.
     * {@code title} is only present when the history-panel title chain
     * resolved one; the frontend falls back to a truncated session id.
     */
    static JsonArray sessionGroups(List<JsonObject> records, long startMs, long endMs,
                                   ZoneId zone, Map<String, String> sessionTitles) {
        List<JsonObject> rows = new ArrayList<>();
        for (JsonObject record : records) {
            long ts = longField(record, "timestamp");
            if (ts < startMs || ts > endMs) {
                continue;
            }
            JsonObject row = windowStats(List.of(record), ts, ts, zone, false);
            String sessionId = record.has("sessionId") ? record.get("sessionId").getAsString() : "";
            row.addProperty("sessionId", sessionId);
            row.addProperty("startTimeMs", longField(record, "startTime"));
            row.addProperty("timestampMs", ts);
            String project = record.has("project") && record.get("project").isJsonPrimitive()
                    ? record.get("project").getAsString()
                    : "";
            row.addProperty("project", project);
            String title = sessionTitles.get(sessionId);
            if (title != null && !title.isBlank()) {
                row.addProperty("title", title);
            }
            rows.add(row);
        }
        rows.sort((a, b) -> Long.compare(b.get("timestampMs").getAsLong(), a.get("timestampMs").getAsLong()));
        JsonArray array = new JsonArray();
        for (JsonObject row : rows) {
            array.add(row);
        }
        return array;
    }

    private static long startOfDayMs(long nowMs, ZoneId zone) {
        return Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
                .atStartOfDay(zone).toInstant().toEpochMilli();
    }

    private static long longField(JsonObject obj, String key) {
        if (obj != null && obj.has(key) && obj.get(key).isJsonPrimitive()) {
            try {
                return obj.get(key).getAsLong();
            } catch (RuntimeException e) {
                return 0;
            }
        }
        return 0;
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
