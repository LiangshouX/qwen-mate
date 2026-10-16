package com.qwenmate.handler;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;
import com.qwenmate.cache.SessionTitleIndex;
import com.qwenmate.cli.CliStatusDetector;
import com.qwenmate.cli.CliToolId;
import com.qwenmate.cli.CliToolStatus;
import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.usage.UsageDataStore;
import com.qwenmate.usage.UsageSnapshot;
import com.qwenmate.usage.UsageStatsAggregator;
import com.qwenmate.util.PlatformUtils;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
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
 *       carries all three time windows, the per-project / per-session
 *       dimensions, and the 12-month heatmap in one shot; {@code refresh}
 *       bypasses the short-lived snapshot cache.</li>
 *   <li>{@code get_usage_stats:{"sessionDaily":"<sessionId>"}} — rebuild ONE
 *       session's per-day token series from its transcript and push
 *       {@code window.onUsageSessionDaily(json)} ({@code {sessionId, daily}}).
 *       Fetched lazily because a usage record collapses a session onto its
 *       end date; only multi-day sessions ever ask for it.</li>
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
        JsonObject request = parseRequest(content);
        String sessionDaily = request.has("sessionDaily") && request.get("sessionDaily").isJsonPrimitive()
                ? request.get("sessionDaily").getAsString()
                : null;
        boolean refresh = request.has("refresh") && request.get("refresh").getAsBoolean();
        CompletableFuture
                .runAsync(() -> {
                    if (sessionDaily != null && !sessionDaily.isBlank()) {
                        pushSessionDaily(sessionDaily);
                    } else {
                        pushStats(refresh);
                    }
                }, AppExecutorUtil.getAppExecutorService())
                .exceptionally(ex -> {
                    LOG.error("[UsageStatsHandler] Unexpected error: " + ex.getMessage(), ex);
                    pushError(ex.getMessage() != null ? ex.getMessage() : "unknown error");
                    return null;
                });
        return true;
    }

    private static JsonObject parseRequest(String content) {
        if (content == null || content.isBlank()) {
            return new JsonObject();
        }
        try {
            return JsonParser.parseString(content).getAsJsonObject();
        } catch (RuntimeException e) {
            return new JsonObject();
        }
    }

    private void pushStats(boolean refresh) {
        try {
            Path qwenDir = Paths.get(PlatformUtils.getHomeDirectory(), ".qwen");
            UsageSnapshot snapshot = UsageDataStore.load(qwenDir, refresh);
            // sessionId -> project: lets the title resolver backfill only the
            // projects that actually hold still-untitled sessions.
            Map<String, String> sessionProjects = new LinkedHashMap<>();
            for (JsonObject record : snapshot.records) {
                if (!record.has("sessionId") || !record.has("project")) {
                    continue;
                }
                sessionProjects.put(
                        record.get("sessionId").getAsString(),
                        record.get("project").getAsString()
                );
            }
            Map<String, String> titles = SessionTitleIndex.loadTitles(
                    Paths.get(PlatformUtils.getHomeDirectory(), ".qwenmate"), sessionProjects);
            JsonObject payload = UsageStatsAggregator.buildPayload(
                    snapshot,
                    System.currentTimeMillis(),
                    currentCliVersion(),
                    MIN_SUPPORTED_VERSION,
                    titles
            );
            // The frontend shows the home dir's group as a full path (its
            // basename — "31770" — is not a meaningful project name).
            payload.addProperty("userHome", PlatformUtils.getHomeDirectory());
            // The IDE's effective working directory — the default project for
            // the session dimension's project-level filter.
            String currentProject = context.resolveEffectiveWorkingDirectory();
            if (currentProject != null && !currentProject.isBlank()) {
                payload.addProperty("currentProject", currentProject);
            }
            pushJson(payload);
        } catch (Exception e) {
            LOG.error("[UsageStatsHandler] Failed to build usage stats: " + e.getMessage(), e);
            pushError(e.getMessage() != null ? e.getMessage() : "unknown error");
        }
    }

    /** Rebuilds one session's per-day token series from its transcript. */
    private void pushSessionDaily(String sessionId) {
        try {
            Path qwenDir = Paths.get(PlatformUtils.getHomeDirectory(), ".qwen");
            JsonObject payload = new JsonObject();
            payload.addProperty("sessionId", sessionId);
            payload.add("daily", UsageDataStore.sessionDaily(qwenDir, sessionId));
            pushJson("window.onUsageSessionDaily", payload);
        } catch (Exception e) {
            LOG.error("[UsageStatsHandler] Failed to rebuild session daily: " + e.getMessage(), e);
            JsonObject payload = new JsonObject();
            payload.addProperty("sessionId", sessionId);
            payload.addProperty("error", e.getMessage() != null ? e.getMessage() : "unknown error");
            pushJson("window.onUsageSessionDaily", payload);
        }
    }

    private void pushError(String message) {
        JsonObject payload = new JsonObject();
        payload.addProperty("error", message);
        pushJson(payload);
    }

    private void pushJson(JsonObject payload) {
        pushJson("window.onUsageStats", payload);
    }

    private void pushJson(String jsCallback, JsonObject payload) {
        String json = gson.toJson(payload);
        ApplicationManager.getApplication().invokeLater(() -> {
            if (context.isDisposed()) {
                return;
            }
            callJavaScript(jsCallback, escapeJs(json));
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
