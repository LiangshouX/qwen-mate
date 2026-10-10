package com.qwenmate.handler;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;
import com.qwenmate.cli.CliStatusDetector;
import com.qwenmate.cli.CliToolId;
import com.qwenmate.cli.CliToolStatus;
import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.usage.UsageDataStore;
import com.qwenmate.usage.UsageSnapshot;
import com.qwenmate.usage.UsageStatsAggregator;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.CompletableFuture;

/**
 * Frontend bridge for Settings → 用量统计 (usage statistics).
 *
 * <p>Messages:
 * <ul>
 *   <li>{@code get_usage_stats:} or
 *       {@code get_usage_stats:{"refresh":true}} — aggregate
 *       {@code ~/.qwen/usage_record.jsonl} plus live sessions rebuilt from
 *       transcripts, then push {@code window.onUsageStats(json)}. The payload
 *       carries all three time windows and the 12-month heatmap in one shot;
 *       {@code refresh} bypasses the short-lived snapshot cache.</li>
 * </ul>
 *
 * <p>All file IO and the CLI version probe run on a background executor; the
 * JS callback is marshalled to the EDT like the other settings handlers.
 */
public class UsageStatsHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(UsageStatsHandler.class);

    private static final String[] SUPPORTED_TYPES = {"get_usage_stats"};

    /**
     * Oldest Qwen Code version verified (against published npm tarballs) to
     * write {@code ~/.qwen/usage_record.jsonl} and {@code ~/.qwen/usage/*.jsonl}.
     * Older CLIs record nothing, so the settings page shows a version notice.
     */
    public static final String MIN_SUPPORTED_VERSION = "0.18.0";

    private static final long VERSION_TTL_MS = 5 * 60 * 1000;

    private final Gson gson = new Gson();

    private volatile String cliVersion;
    private volatile long cliVersionAtMs;

    public UsageStatsHandler(HandlerContext context) {
        super(context);
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES.clone();
    }

    @Override
    public boolean handle(String type, String content) {
        if (!"get_usage_stats".equals(type)) {
            return false;
        }
        boolean refresh = parseRefresh(content);
        CompletableFuture
                .runAsync(() -> pushStats(refresh), AppExecutorUtil.getAppExecutorService())
                .exceptionally(ex -> {
                    LOG.error("[UsageStatsHandler] Unexpected error: " + ex.getMessage(), ex);
                    pushError(ex.getMessage() != null ? ex.getMessage() : "unknown error");
                    return null;
                });
        return true;
    }

    private static boolean parseRefresh(String content) {
        if (content == null || content.isBlank()) {
            return false;
        }
        try {
            JsonObject json = JsonParser.parseString(content).getAsJsonObject();
            return json.has("refresh") && json.get("refresh").getAsBoolean();
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void pushStats(boolean refresh) {
        try {
            Path qwenDir = Paths.get(com.qwenmate.util.PlatformUtils.getHomeDirectory(), ".qwen");
            UsageSnapshot snapshot = UsageDataStore.load(qwenDir, refresh);
            JsonObject payload = UsageStatsAggregator.buildPayload(
                    snapshot,
                    System.currentTimeMillis(),
                    currentCliVersion(),
                    MIN_SUPPORTED_VERSION
            );
            pushJson(payload);
        } catch (Exception e) {
            LOG.error("[UsageStatsHandler] Failed to build usage stats: " + e.getMessage(), e);
            pushError(e.getMessage() != null ? e.getMessage() : "unknown error");
        }
    }

    private void pushError(String message) {
        JsonObject payload = new JsonObject();
        payload.addProperty("error", message);
        pushJson(payload);
    }

    private void pushJson(JsonObject payload) {
        String json = gson.toJson(payload);
        ApplicationManager.getApplication().invokeLater(() -> {
            if (context.isDisposed()) {
                return;
            }
            callJavaScript("window.onUsageStats", escapeJs(json));
        });
    }

    /** Detected Qwen Code CLI version, probed at most every {@link #VERSION_TTL_MS}. */
    private String currentCliVersion() {
        long now = System.currentTimeMillis();
        String cached = cliVersion;
        if (cached != null && now - cliVersionAtMs < VERSION_TTL_MS) {
            return cached;
        }
        try {
            CliToolStatus status = CliStatusDetector.detect(CliToolId.QWEN);
            cached = status != null ? status.getVersion() : null;
        } catch (RuntimeException e) {
            LOG.warn("[UsageStatsHandler] CLI version probe failed: " + e.getMessage());
            cached = cliVersion;
        }
        cliVersion = cached;
        cliVersionAtMs = now;
        return cached;
    }
}
