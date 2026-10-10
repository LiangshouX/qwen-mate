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
        return payload;
    }

    /** Window aggregate: headline counters, token split, models, skills, daily buckets. */
    static JsonObject windowStats(List<JsonObject> records, long startMs, long endMs, ZoneId zone) {
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
