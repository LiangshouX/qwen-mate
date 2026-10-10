package com.qwenmate.usage;

import java.util.List;

/**
 * Immutable snapshot of the merged usage-record dataset:
 * persisted {@code ~/.qwen/usage_record.jsonl} sessions plus live sessions
 * rebuilt from {@code ~/.qwen/projects/<proj>/chats/<sessionId>.jsonl} transcripts (sessions
 * that have not been flushed to the usage file yet, e.g. still-open windows).
 *
 * <p>Mirrors qwen-code's {@code loadUsageHistoryWithLive()}: transcripts of
 * sessions already present in the usage file are skipped, and a transcript is
 * only considered when its mtime is within {@link #LIVE_REBUILD_WINDOW_MS}.
 */
public final class UsageSnapshot {

    /** Live rebuild window used by qwen-code (LIVE_REBUILD_WINDOW_DAYS = 35). */
    public static final long LIVE_REBUILD_WINDOW_MS = 35L * 24 * 60 * 60 * 1000;

    /** Merged records, already deduplicated per session (last line wins). */
    public final List<com.google.gson.JsonObject> records;

    /** Whether {@code usage_record.jsonl} exists on disk. */
    public final boolean dataFileExists;

    /** Absolute path of {@code usage_record.jsonl}. */
    public final String dataFile;

    /** Number of v1 lines read from {@code usage_record.jsonl}. */
    public final int rawRecordCount;

    /** Sessions contributed by transcript (live) rebuild. */
    public final int liveSessionCount;

    public UsageSnapshot(
            List<com.google.gson.JsonObject> records,
            boolean dataFileExists,
            String dataFile,
            int rawRecordCount,
            int liveSessionCount
    ) {
        this.records = records;
        this.dataFileExists = dataFileExists;
        this.dataFile = dataFile;
        this.rawRecordCount = rawRecordCount;
        this.liveSessionCount = liveSessionCount;
    }
}
