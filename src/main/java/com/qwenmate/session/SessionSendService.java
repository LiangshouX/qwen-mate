package com.qwenmate.session;

import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.util.PathUtils;
import com.qwenmate.notifications.QwenMateNotifier;
import com.qwenmate.provider.common.MarkerCliBridge;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.qwenmate.provider.common.MessageCallback;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Owns message-send orchestration while QwenMateSession remains the public session facade.
 */
public class SessionSendService {

    private static final Logger LOG = Logger.getInstance(SessionSendService.class);

    private final Project project;
    private final SessionState state;
    private final SessionCallbackFacade callbackFacade;
    private final QwenSDKBridge qwenSDKBridge;
    private final Map<String, MarkerCliBridge> cliBridges;
    private final SessionContextService contextService;

    public SessionSendService(
            Project project,
            SessionState state,
            SessionCallbackFacade callbackFacade,
            QwenSDKBridge qwenSDKBridge,
            Map<String, MarkerCliBridge> cliBridges,
            SessionContextService contextService
    ) {
        this.project = project;
        this.state = state;
        this.callbackFacade = callbackFacade;
        this.qwenSDKBridge = qwenSDKBridge;
        this.cliBridges = cliBridges != null ? cliBridges : Collections.emptyMap();
        this.contextService = contextService;
    }

    public void prepareContextCollector(EditorContextCollector contextCollector) {
        contextCollector.setPsiContextEnabled(state.isPsiContextEnabled());
        contextCollector.setAutoOpenFileEnabled(readAutoOpenFileEnabled());
    }

    public void updateSessionStateForSend(QwenMateSession.Message userMessage, String normalizedInput) {
        // The message lock covers only the list mutation and the transport copy it
        // feeds: enqueue's structural-signature walk requires the caller to hold this
        // lock. Summary and busy/loading state don't touch the message list, so they
        // stay outside it on the handler thread.
        synchronized (state.getMessageStateLock()) {
            state.addMessage(userMessage);
            callbackFacade.notifyMessageUpdate(state.getMessages());
        }

        if (state.getSummary() == null) {
            String baseSummary = (userMessage.content != null && !userMessage.content.isEmpty())
                    ? userMessage.content
                    : normalizedInput;
            String newSummary = baseSummary.length() > 45 ? baseSummary.substring(0, 45) + "..." : baseSummary;
            state.setSummary(newSummary);
            callbackFacade.notifySummaryReceived(newSummary);
        }

        state.updateLastModifiedTime();
        state.setError(null);
        state.setBusy(true);
        state.setLoading(true);
        QwenMateNotifier.setWaiting(project);
        callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
    }

    public CompletableFuture<Void> sendMessageToProvider(
            String channelId,
            String input,
            List<QwenMateSession.Attachment> attachments,
            JsonObject openedFilesJson,
            String externalAgentPrompt,
            List<String> fileTagPaths,
            String requestedPermissionMode,
            String requestedReasoningEffort,
            String requestedDshPreset
    ) {
        String agentPrompt = externalAgentPrompt;
        if (agentPrompt == null) {
            agentPrompt = getAgentPrompt();
            LOG.info("[Agent] Using agent from global setting (fallback)");
        } else {
            LOG.info("[Agent] Using agent from message (per-tab selection)");
        }

        String currentProvider = state.getProvider();
        String sessionModeBeforeSend = state.getPermissionMode();
        String normalizedRequestedMode = normalizeRequestedPermissionMode(requestedPermissionMode);
        String effectivePermissionMode = resolveEffectivePermissionMode(
                currentProvider,
                normalizedRequestedMode,
                sessionModeBeforeSend
        );

        LOG.info(
                "[ModeSync][Backend] provider=" + currentProvider
                        + ", requested=" + (normalizedRequestedMode != null ? normalizedRequestedMode : "(none)")
                        + ", session=" + (sessionModeBeforeSend != null ? sessionModeBeforeSend : "(none)")
                        + ", effective=" + effectivePermissionMode
        );

        String normalizedRequestedEffort = normalizeRequestedReasoningEffort(requestedReasoningEffort);

        if (SessionProviderRouter.isCliProvider(currentProvider) && cliBridges.containsKey(currentProvider)) {
            if ("dsh".equals(currentProvider) && requestedDshPreset != null) {
                state.setDshPreset(requestedDshPreset);
            }
            return sendToCliProvider(
                    currentProvider,
                    channelId,
                    input,
                    attachments,
                    openedFilesJson,
                    agentPrompt,
                    fileTagPaths,
                    normalizedRequestedEffort,
                    effectivePermissionMode
            );
        }

        return sendToQwen(
                channelId,
                input,
                attachments,
                openedFilesJson,
                agentPrompt,
                fileTagPaths,
                effectivePermissionMode,
                normalizedRequestedEffort
        );
    }

    public static String normalizeRequestedReasoningEffort(String effort) {
        if (effort == null) {
            return null;
        }
        String trimmed = effort.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (SessionState.isValidReasoningEffort(trimmed)) {
            return trimmed;
        }
        LOG.warn("[ReasoningEffort][Backend] Invalid requested reasoningEffort ignored: " + effort);
        return null;
    }

    public static String normalizeRequestedPermissionMode(String mode) {
        if (mode == null) {
            return null;
        }
        String trimmed = mode.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        String migrated = SessionState.migratePermissionMode(trimmed);
        if (SessionState.isValidPermissionMode(migrated)) {
            return migrated;
        }
        LOG.warn("[ModeSync][Backend] Invalid requested permissionMode ignored: " + mode);
        return null;
    }

    public static String resolveEffectivePermissionMode(String provider, String requestedMode, String sessionMode) {
        String resolvedMode = requestedMode;
        if (resolvedMode == null) {
            resolvedMode = normalizeRequestedPermissionMode(sessionMode);
        }
        if (resolvedMode == null) {
            resolvedMode = "default";
        }
        resolvedMode = SessionState.migratePermissionMode(resolvedMode);

        // Qwen natively supports the full CLI approval-mode set
        // (plan / default / auto-edit / auto / yolo). DSH exposes neither plan
        // mode nor a provider-native auto reviewer, so those two stay coerced
        // to default there (mirrors the Webview's reduced DSH mode list).
        boolean isProviderWithoutPlanOrAuto = SessionProviderRouter.isCliProvider(provider)
                && !"qwen".equals(provider);
        if (isProviderWithoutPlanOrAuto
                && ("plan".equals(resolvedMode) || "auto".equals(resolvedMode))) {
            return "default";
        }
        return resolvedMode;
    }

    private CompletableFuture<Void> sendToCliProvider(
            String provider,
            String channelId,
            String input,
            List<QwenMateSession.Attachment> attachments,
            JsonObject openedFilesJson,
            String agentPrompt,
            List<String> fileTagPaths,
            String requestedReasoningEffort,
            String permissionMode
    ) {
        MarkerCliBridge bridge = cliBridges.get(provider);
        if (bridge == null) {
            MessageCallback missingHandler = createCliMessageHandler(provider);
            missingHandler.onError("CLI provider not registered: " + provider);
            return CompletableFuture.completedFuture(null);
        }

        // CLI providers share the marker-stream handler so each stream owns a
        // dedicated assistant bubble and user echoes never re-append the send-time
        // user message.
        MessageCallback handler = createCliMessageHandler(provider);

        String contextAppend = contextService.buildContextAppend(openedFilesJson, fileTagPaths);
        String finalInput = (input != null ? input : "") + contextAppend;
        if (agentPrompt != null && !agentPrompt.isEmpty()) {
            finalInput = finalInput + "\n\n## Agent Role and Instructions\n\n" + agentPrompt;
            LOG.info("[Agent] 鉁?Appending agentPrompt to user message for " + provider
                    + " (length: " + agentPrompt.length() + " chars)");
        }

        String effort = normalizeCliReasoningEffort(
                requestedReasoningEffort != null ? requestedReasoningEffort : state.getReasoningEffort()
        );
        String modelForCli = normalizeCliModelForProvider(provider, state.getModel());
        String effectiveMode = permissionMode != null && !permissionMode.isBlank()
                ? permissionMode
                : "default";
        int attachmentCount = attachments != null ? attachments.size() : 0;

        LOG.info("[Lifecycle] sendToCli provider=" + provider
                + " sessionId=" + (state.getSessionId() != null ? state.getSessionId() : "(new)")
                + ", cwd=" + state.getCwd()
                + ", modelRaw=" + state.getModel()
                + ", modelCli=" + (modelForCli != null ? modelForCli : "(config-default)")
                + ", effort=" + effort
                + ", permissionMode=" + effectiveMode
                + ", attachments=" + attachmentCount);

        return bridge.sendMessage(
                channelId,
                finalInput,
                state.getSessionId(),
                state.getCwd(),
                modelForCli != null ? modelForCli : "",
                effort,
                attachments,
                effectiveMode,
                "dsh".equals(provider) ? state.getDshPreset() : null,
                handler
        ).thenApply(result -> null);
    }

    private CompletableFuture<Void> sendToQwen(
            String channelId,
            String input,
            List<QwenMateSession.Attachment> attachments,
            JsonObject openedFilesJson,
            String agentPrompt,
            List<String> fileTagPaths,
            String effectivePermissionMode,
            String requestedReasoningEffort
    ) {
        if (qwenSDKBridge == null) {
            LOG.error("[Lifecycle] sendToQwen called but QwenSDKBridge is null");
            callbackFacade.notifyStateChange(false, false, "Qwen bridge not available");
            return CompletableFuture.completedFuture(null);
        }
        QwenMessageHandler handler = new QwenMessageHandler(state, callbackFacade.getCallbackHandler());
        Boolean streaming = readStreamingEnabled();
        final String runtimeSessionEpoch = state.getRuntimeSessionEpoch();
        final String currentModel = state.getModel();
        String projectBase = project != null ? project.getBasePath() : null;
        String guardedCwd = PathUtils.guardWorkingDirectory(
                state.getCwd(), projectBase);
        if (guardedCwd == null) {
            guardedCwd = state.getCwd();
        } else if (state.getCwd() == null || !guardedCwd.equals(state.getCwd())) {
            LOG.warn("[Lifecycle] sendToQwen cwd guard: " + state.getCwd() + " -> " + guardedCwd);
            state.setCwd(guardedCwd);
        }
        LOG.info("[Lifecycle] sendToQwen sessionId=" + (state.getSessionId() != null ? state.getSessionId() : "(new)")
                + ", epoch=" + runtimeSessionEpoch
                + ", cwd=" + guardedCwd
                + ", model=" + currentModel
                + ", fileTags=" + (fileTagPaths != null ? fileTagPaths.size() : 0));

        return qwenSDKBridge.sendMessage(
                channelId,
                input,
                state.getSessionId(),
                runtimeSessionEpoch,
                guardedCwd,
                attachments,
                effectivePermissionMode,
                currentModel,
                openedFilesJson,
                agentPrompt,
                streaming,
                false,
                requestedReasoningEffort != null ? requestedReasoningEffort : state.getReasoningEffort(),
                handler
        ).thenApply(result -> null);
    }

    /**
     * Build the marker-stream callback for a CLI provider.
     * CLI marker streams share the Claude-template protocol surface, so they reuse
     * {@link QwenMessageHandler}, which owns a dedicated assistant bubble per stream.
     */
    MessageCallback createCliMessageHandler(String provider) {
        CallbackHandler callbacks = callbackFacade.getCallbackHandler();
        return new QwenMessageHandler(state, callbacks);
    }

    static String normalizeCliReasoningEffort(String effort) {
        if (effort == null) {
            return "medium";
        }
        String normalized = effort.trim().toLowerCase();
        if ("low".equals(normalized) || "medium".equals(normalized) || "high".equals(normalized)) {
            return normalized;
        }
        return "medium";
    }

    /**
     * Map UI model selection to CLI model flag. Returns null to omit the flag
     * (provider CLI uses its own default / config).
     */
    static String normalizeCliModelForProvider(String provider, String model) {
        if (model == null) {
            return null;
        }
        String trimmed = model.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        String lower = trimmed.toLowerCase();
        if ("__config_default__".equals(lower)
                || "auto".equals(lower)
                || "default".equals(lower)
                || "(default)".equals(lower)
                || "config-default".equals(lower)
                || "config_default".equals(lower)
                || "dsh-default".equals(lower)) {
            return null;
        }
        // Leftovers after a provider switch without model reset are ignored for CLI.
        if (lower.startsWith("claude-") || lower.startsWith("gpt-")) {
            LOG.warn("[" + provider + "] Ignoring non-provider model leftover for CLI: " + trimmed);
            return null;
        }
        return trimmed;
    }

    private boolean readAutoOpenFileEnabled() {
        try {
            String projectPath = project.getBasePath();
            if (projectPath != null) {
                QwenMateSettingsService settingsService = new QwenMateSettingsService();
                boolean autoOpenFileEnabled = settingsService.getAutoOpenFileEnabled(projectPath);
                LOG.info("[EditorContext] Auto open file enabled: " + autoOpenFileEnabled);
                return autoOpenFileEnabled;
            }
        } catch (Exception e) {
            LOG.warn("[EditorContext] Failed to read autoOpenFileEnabled setting: " + e.getMessage());
        }
        return false;
    }

    private Boolean readStreamingEnabled() {
        Boolean streaming = null;
        try {
            String projectPath = project.getBasePath();
            if (projectPath != null) {
                QwenMateSettingsService settingsService = new QwenMateSettingsService();
                streaming = settingsService.getStreamingEnabled(projectPath);
                LOG.info("[Streaming] Read streaming config: " + streaming);
            }
        } catch (Exception e) {
            LOG.warn("[Streaming] Failed to read streaming config: " + e.getMessage());
        }
        return streaming;
    }

    private String getAgentPrompt() {
        try {
            QwenMateSettingsService settingsService = new QwenMateSettingsService();
            String selectedAgentId = settingsService.getSelectedAgentId();
            LOG.info("[Agent] Checking selected agent ID: " + (selectedAgentId != null ? selectedAgentId : "null"));

            if (selectedAgentId != null && !selectedAgentId.isEmpty()) {
                JsonObject agent = settingsService.getAgent(selectedAgentId);
                if (agent != null && agent.has("prompt") && !agent.get("prompt").isJsonNull()) {
                    String agentPrompt = agent.get("prompt").getAsString();
                    String agentName = agent.has("name") ? agent.get("name").getAsString() : "Unknown";
                    LOG.info("[Agent] 鉁?Found agent: " + agentName);
                    LOG.info("[Agent] 鉁?Prompt length: " + agentPrompt.length() + " chars");
                    LOG.info("[Agent] 鉁?Prompt preview: "
                            + (agentPrompt.length() > 100 ? agentPrompt.substring(0, 100) + "..." : agentPrompt));
                    return agentPrompt;
                }
                LOG.info("[Agent] 鉁?Agent found but no prompt configured");
            } else {
                LOG.info("[Agent] 鉁?No agent selected");
            }
        } catch (Exception e) {
            LOG.warn("[Agent] 鉁?Failed to get agent prompt: " + e.getMessage());
        }
        return null;
    }
}
