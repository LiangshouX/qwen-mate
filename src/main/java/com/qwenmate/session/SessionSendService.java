package com.qwenmate.session;

import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.util.PathUtils;
import com.qwenmate.notifications.QwenMateNotifier;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.util.List;
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
    private final SessionContextService contextService;

    public SessionSendService(
            Project project,
            SessionState state,
            SessionCallbackFacade callbackFacade,
            QwenSDKBridge qwenSDKBridge,
            SessionContextService contextService
    ) {
        this.project = project;
        this.state = state;
        this.callbackFacade = callbackFacade;
        this.qwenSDKBridge = qwenSDKBridge;
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
            String requestedReasoningEffort
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

    public static String resolveEffectivePermissionMode(String requestedMode, String sessionMode) {
        String resolvedMode = requestedMode;
        if (resolvedMode == null) {
            resolvedMode = normalizeRequestedPermissionMode(sessionMode);
        }
        if (resolvedMode == null) {
            resolvedMode = "default";
        }
        return SessionState.migratePermissionMode(resolvedMode);
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
