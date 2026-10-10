package com.qwenmate.provider.qwen;

import com.qwenmate.session.QwenMateSession;
import com.qwenmate.provider.common.DaemonBridge;
import com.qwenmate.provider.common.MessageCallback;
import com.qwenmate.provider.common.SDKResult;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Sends Qwen requests through the long-running daemon (qwen.* NDJSON commands).
 */
class QwenDaemonRequestExecutor {

    private final Logger log;
    private final QwenSDKBridge bridge; // for processOutputLine + payload builder
    private final Gson gson = new Gson();

    QwenDaemonRequestExecutor(Logger log, QwenSDKBridge bridge) {
        this.log = log;
        this.bridge = bridge;
    }

    /**
     * Core send entry ({@code qwen.send}). Streams marker-protocol lines back through
     * {@code bridge.processOutputLine} (SDK-shaped tags).
     */
    CompletableFuture<SDKResult> sendMessageViaDaemon(
            DaemonBridge daemon,
            String channelId,
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort,
            MessageCallback callback
    ) {
        return sendStreamCommand(
                daemon,
                "qwen.send",
                message,
                sessionId,
                runtimeSessionEpoch,
                cwd,
                attachments,
                permissionMode,
                model,
                openedFiles,
                agentPrompt,
                streaming,
                disableThinking,
                reasoningEffort,
                callback
        );
    }

    /**
     * Attachment-first send entry ({@code qwen.sendWithAttachments}). Same streaming
     * shape as {@link #sendMessageViaDaemon}; used when the turn carries file payloads.
     */
    CompletableFuture<SDKResult> sendMessageWithAttachmentsViaDaemon(
            DaemonBridge daemon,
            String channelId,
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort,
            MessageCallback callback
    ) {
        return sendStreamCommand(
                daemon,
                "qwen.sendWithAttachments",
                message,
                sessionId,
                runtimeSessionEpoch,
                cwd,
                attachments,
                permissionMode,
                model,
                openedFiles,
                agentPrompt,
                streaming,
                disableThinking,
                reasoningEffort,
                callback
        );
    }

    /** Shared streaming send runner for {@code qwen.send} / {@code qwen.sendWithAttachments}. */
    private CompletableFuture<SDKResult> sendStreamCommand(
            DaemonBridge daemon,
            String command,
            String message,
            String sessionId,
            String runtimeSessionEpoch,
            String cwd,
            List<QwenMateSession.Attachment> attachments,
            String permissionMode,
            String model,
            JsonObject openedFiles,
            String agentPrompt,
            Boolean streaming,
            boolean disableThinking,
            String reasoningEffort,
            MessageCallback callback
    ) {
        return CompletableFuture.supplyAsync(() -> {
            SDKResult result = new SDKResult();
            StringBuilder assistantContent = new StringBuilder();
            AtomicBoolean hadSendError = new AtomicBoolean(false);
            AtomicReference<String> lastNodeError = new AtomicReference<>(null);
            AtomicBoolean wasAborted = new AtomicBoolean(false);
            long startTime = System.currentTimeMillis();

            try {
                JsonObject params = bridge.buildStdinPayloadForDaemon(
                        message,
                        sessionId,
                        runtimeSessionEpoch,
                        cwd,
                        attachments,
                        permissionMode,
                        model,
                        openedFiles,
                        agentPrompt,
                        streaming,
                        disableThinking,
                        reasoningEffort
                );

                params.add("env", new JsonObject()); // daemon will merge base env

                log.info("[QwenDaemonExecutor] Sending via daemon: " + command);

                CompletableFuture<Boolean> cmdFuture = daemon.sendCommand(
                        command,
                        params,
                        new DaemonBridge.DaemonOutputCallback() {
                            @Override
                            public void onLine(String line) {
                                if (line.startsWith("[UNCAUGHT_ERROR]")
                                        || line.startsWith("[UNHANDLED_REJECTION]")
                                        || line.startsWith("[COMMAND_ERROR]")
                                        || line.startsWith("[STARTUP_ERROR]")
                                        || line.startsWith("[ERROR]")) {
                                    log.warn("[Qwen Node ERROR] " + line);
                                    lastNodeError.set(line);
                                }
                                // Reuse QwenSDKBridge processing (SDK-shaped tags)
                                bridge.processOutputLine(
                                        line,
                                        callback,
                                        result,
                                        assistantContent,
                                        hadSendError,
                                        lastNodeError
                                );
                            }

                            @Override
                            public void onStderr(String text) {
                                if (text != null && text.contains("[SEND_ERROR]")) {
                                    bridge.processOutputLine(
                                            text,
                                            callback,
                                            result,
                                            assistantContent,
                                            hadSendError,
                                            lastNodeError
                                    );
                                    return;
                                }
                                log.debug("[QwenDaemon:stderr] " + text);
                            }

                            @Override
                            public void onError(String error) {
                                if (!hadSendError.get()) {
                                    result.success = false;
                                    result.error = error;
                                }
                            }

                            @Override
                            public void onAbort() {
                                wasAborted.set(true);
                            }

                            @Override
                            public void onComplete(boolean success) {
                            }
                        }
                );

                Boolean success;
                long waitStart = System.currentTimeMillis();
                long lastProgressLogAt = waitStart;
                while (true) {
                    try {
                        success = cmdFuture.get(30, TimeUnit.SECONDS);
                        break;
                    } catch (TimeoutException timeout) {
                        if (!daemon.isAlive()) {
                            throw new RuntimeException("Qwen daemon not alive", timeout);
                        }
                        long now = System.currentTimeMillis();
                        if (now - lastProgressLogAt >= 60_000) {
                            long elapsedSec = (now - waitStart) / 1000;
                            log.info("[QwenDaemonExecutor] still running (" + elapsedSec + "s)...");
                            lastProgressLogAt = now;
                        }
                    }
                }

                result.finalResult = assistantContent.toString();
                result.messageCount = result.messages.size();

                if (!hadSendError.get()) {
                    result.success = success != null && success;
                    if (result.success) {
                        callback.onComplete(result);
                    } else if (wasAborted.get()) {
                        long elapsed = System.currentTimeMillis() - startTime;
                        log.info("[QwenDaemonExecutor] aborted by user (" + elapsed + "ms)");
                        result.error = "User interrupted";
                        callback.onComplete(result);
                    } else {
                        String errorMsg = "Qwen daemon command failed";
                        String nodeErr = lastNodeError.get();
                        if (nodeErr != null) {
                            errorMsg += "\n\nDetails: " + nodeErr;
                        }
                        if (result.error == null) {
                            result.error = errorMsg;
                        }
                        callback.onError(result.error);
                    }
                } else {
                    // hadSendError is only set by processOutputLine after it has already
                    // invoked callback.onError, so re-notifying here would append a second
                    // error bubble for the same failure. Keep the recorded error for the
                    // returned SDKResult; the UI was torn down by that first onError.
                    log.debug("[QwenDaemonExecutor] send error already reported: " + result.error);
                }

                return result;
            } catch (Exception e) {
                if (!hadSendError.get()) {
                    result.success = false;
                    result.error = e.getMessage();
                    callback.onError(result.error);
                }
                return result;
            }
        });
    }

    /**
     * Warm the persistent Qwen runtime ({@code qwen.preconnect}) so the first real
     * turn reuses the established connection instead of paying cold-start cost.
     */
    CompletableFuture<JsonObject> preconnectViaDaemon(DaemonBridge daemon, JsonObject params) {
        return sendJsonCommand(daemon, "qwen.preconnect", params, 45);
    }

    /**
     * Push a permission mode into the live Qwen runtime ({@code qwen.setPermissionMode}).
     * Only emits {@code {id, done, success}} — resolved from onComplete/onError.
     */
    CompletableFuture<JsonObject> setPermissionModeViaDaemon(DaemonBridge daemon, JsonObject params) {
        return sendJsonCommand(daemon, "qwen.setPermissionMode", params, 10);
    }

    /**
     * Query the runtime context-window snapshot ({@code qwen.getContextUsage}).
     */
    CompletableFuture<JsonObject> getContextUsageViaDaemon(DaemonBridge daemon, JsonObject params) {
        return sendJsonCommand(daemon, "qwen.getContextUsage", params, 15);
    }

    /**
     * Generic NDJSON command runner: collects the last JSON line emitted by the daemon
     * and completes with it (or an error envelope on failure/timeout).
     */
    private CompletableFuture<JsonObject> sendJsonCommand(
            DaemonBridge daemon,
            String command,
            JsonObject params,
            long timeoutSeconds
    ) {
        AtomicReference<JsonObject> resultRef = new AtomicReference<>();
        CompletableFuture<JsonObject> resultFuture = new CompletableFuture<>();

        DaemonBridge.DaemonOutputCallback callback = new DaemonBridge.DaemonOutputCallback() {
            @Override
            public void onLine(String line) {
                try {
                    JsonObject parsed = gson.fromJson(line, JsonObject.class);
                    if (parsed != null) {
                        resultRef.set(parsed);
                    }
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onStderr(String text) { }

            @Override
            public void onError(String error) {
                if (!resultFuture.isDone()) {
                    JsonObject err = new JsonObject();
                    err.addProperty("success", false);
                    err.addProperty("error", error != null ? error : (command + " error"));
                    resultFuture.complete(err);
                }
            }

            @Override
            public void onComplete(boolean success) {
                if (resultFuture.isDone()) {
                    return;
                }
                JsonObject result = resultRef.get();
                if (result != null) {
                    resultFuture.complete(result);
                } else {
                    JsonObject err = new JsonObject();
                    err.addProperty("success", success);
                    if (!success) {
                        err.addProperty("error", command + " command failed");
                    }
                    resultFuture.complete(err);
                }
            }
        };

        try {
            log.info("[QwenDaemonExecutor] Sending via daemon: " + command);
            daemon.sendCommand(command, params, callback).exceptionally(ex -> {
                if (!resultFuture.isDone()) {
                    JsonObject err = new JsonObject();
                    err.addProperty("success", false);
                    err.addProperty("error", ex.getMessage() != null ? ex.getMessage() : "sendCommand failed");
                    resultFuture.complete(err);
                }
                return false;
            });
        } catch (Exception e) {
            JsonObject err = new JsonObject();
            err.addProperty("success", false);
            err.addProperty("error", e.getMessage() != null ? e.getMessage() : "exception");
            return CompletableFuture.completedFuture(err);
        }

        return resultFuture.orTimeout(timeoutSeconds, TimeUnit.SECONDS).exceptionally(ex -> {
            JsonObject err = new JsonObject();
            err.addProperty("success", false);
            err.addProperty("error", command + " timed out after " + timeoutSeconds + " seconds");
            return err;
        });
    }
}
