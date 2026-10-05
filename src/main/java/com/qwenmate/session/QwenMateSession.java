package com.qwenmate.session;

import com.qwenmate.permission.PermissionManager;
import com.qwenmate.permission.PermissionRequest;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Session management for Claude conversations.
 * Maintains state and message history for a single chat session.
 */
public class QwenMateSession {

    private static final Logger LOG = Logger.getInstance(QwenMateSession.class);

    private final Project project;
    /** Start time of the latest submitted turn, retained across Webview rebuilds. */
    private volatile long lastTurnStartedAtMillis;

    /**
     * Flag set when the user manually interrupts the current turn (clicks Stop).
     * Checked by {@link com.qwenmate.ui.toolwindow.QwenMateChatWindow#onStreamEnded()}
     * to suppress the task-completion notification sound for manual stops.
     * Reset to {@code false} at the start of each new {@link #send} call.
     */
    private volatile boolean manuallyInterrupted = false;

    // Session state manager
    private final com.qwenmate.session.SessionState state;

    // Message processors
    private final com.qwenmate.session.MessageParser messageParser;

    // Context collector
    private final com.qwenmate.session.EditorContextCollector contextCollector;
    private final SessionContextService contextService;
    private final QwenSDKBridge qwenSDKBridge;
    private final SessionProviderRouter providerRouter;
    private final SessionSendService sendService;
    private final SessionMessageOrchestrator messageOrchestrator;

    // Callback facade
    private final SessionCallbackFacade callbackFacade;

    // Permission manager
    private final PermissionManager permissionManager = new PermissionManager();

    /**
     * Represents a single message in the conversation.
     */
    public static class Message {
        public enum Type {
            USER, ASSISTANT, SYSTEM, ERROR
        }

        public Type type;
        // Provider callbacks and history reloads share SessionState's message lock;
        // transport snapshots are captured while that lock is held before any async
        // serialization begins.
        public volatile String content;
        public long timestamp;
        public volatile JsonObject raw; // Raw message data from SDK

        public Message(Type type, String content) {
            this.type = type;
            this.content = content;
            this.timestamp = System.currentTimeMillis();
        }

        public Message(Type type, String content, JsonObject raw) {
            this(type, content);
            this.raw = raw;
        }
    }

    /**
     * Callback interface for session events.
     */
    public interface SessionCallback {
        void onMessageUpdate(List<Message> messages);

        void onStateChange(boolean busy, boolean loading, String error);

        default void onStatusMessage(String message) {
        }

        void onSessionIdReceived(String sessionId);

        void onPermissionRequested(PermissionRequest request);

        void onThinkingStatusChanged(boolean isThinking);

        void onSlashCommandsReceived(List<String> slashCommands);

        void onNodeLog(String log);

        void onSummaryReceived(String summary);

        // Streaming callback methods (with default implementations for backward compatibility)
        default void onStreamStart() {
        }

        default void onStreamEnd() {
        }

        default void onContentDelta(String delta) {
        }

        default void onThinkingDelta(String delta) {
        }

        /**
         * Called when a block reset signal is received during streaming.
         * This indicates a new assistant message has started within the stream
         * (e.g., after a tool_use loop iteration), so the frontend can record
         * the boundary while retaining cumulative streaming content for reconciliation.
         */
        default void onBlockReset() {
        }

        default void onUsageUpdate(int usedTokens, int maxTokens) {
        }

        default void onUserMessageUuidPatched(String content, String uuid) {
        }

        /**
         * Called when a Qwen Code task_* SDK system event is received
         * (task_started / task_progress / task_notification).
         *
         * <p>Async subagents (Agent/Task tool invoked with run_in_background:true) run
         * in a background sidechain whose detailed
         * messages never enter the main SDK stream. The main stream only carries these
         * lightweight system events, which carry the agent's lifecycle signals: launch,
         * per-tool progress, and terminal completion (with result + usage). Forwarding
         * them to the frontend lets the subagent list reflect real running/completed
         * state instead of being stuck on the launch summary.</p>
         */
        default void onTaskEvent(String eventJson) {
        }

        /**
         * Called when Claude history page metadata is available (for pagination).
         * @param sessionId the session ID
         * @param fromTurn the first turn index in the current page
         * @param totalTurns total number of turns in the session
         * @param hasMore whether there are more pages to load
         * @param cursorReset true when the server rejected the client cursor and
         *        returned the latest page instead; the client must treat the
         *        current transcript as replaced, not prepended
         * @param sessionTitle CLI-derived session title (customTitle/aiTitle/
         *        summary/lastPrompt/firstPrompt chain) carried with the page, or
         *        null when the transcript has none; lets the header stay stable
         *        when the loaded page does not include the session's first prompt
         */
        default void onQwenMateHistoryPageInfo(String sessionId, int fromTurn, int totalTurns, boolean hasMore, boolean cursorReset, String sessionTitle) {
        }

        /**
         * Called when an earlier Claude history page fails to load.
         * @param sessionId the session ID, or null when unknown
         * @param message human-readable error description
         */
        default void onQwenMateHistoryPageError(String sessionId, String message) {
        }
    }

    public QwenMateSession(
            Project project,
            QwenSDKBridge qwenSDKBridge
    ) {
        this.project = project;

        // Initialize managers
        this.state = new com.qwenmate.session.SessionState();
        this.messageParser = new com.qwenmate.session.MessageParser();
        this.contextCollector = new com.qwenmate.session.EditorContextCollector(project);
        this.callbackFacade = new SessionCallbackFacade(project);
        this.contextService = new SessionContextService(project);
        this.qwenSDKBridge = qwenSDKBridge;
        this.providerRouter = new SessionProviderRouter(qwenSDKBridge);
        this.sendService = new SessionSendService(
                project,
                state,
                callbackFacade,
                qwenSDKBridge,
                contextService);
        this.messageOrchestrator = new SessionMessageOrchestrator(
                project,
                state,
                messageParser,
                callbackFacade,
                new SessionMessageOrchestrator.SessionHistoryAccess() {
                    @Override
                    public List<JsonObject> getProviderSessionMessages(String provider, String sessionId, String cwd) {
                        return providerRouter.getSessionMessages(provider, sessionId, cwd);
                    }

                    @Override
                    public JsonObject getProviderSessionMessagesPage(
                            String provider, String sessionId, String cwd, Integer beforeTurn, int turnLimit) {
                        return providerRouter.getSessionMessagesPage(provider, sessionId, cwd, beforeTurn, turnLimit);
                    }
                }
        );

        // Set up permission manager callback
        permissionManager.setOnPermissionRequestedCallback(request -> {
            callbackFacade.notifyPermissionRequested(request);
        });
    }

    public void setCallback(SessionCallback callback) {
        callbackFacade.setCallback(callback);
    }

    public com.qwenmate.session.EditorContextCollector getContextCollector() {
        return contextCollector;
    }

    public SessionMessageOrchestrator getOrchestrator() {
        return messageOrchestrator;
    }

    // Getters - delegated to SessionState
    public String getSessionId() {
        return state.getSessionId();
    }

    public String getChannelId() {
        return state.getChannelId();
    }

    public boolean isBusy() {
        return state.isBusy();
    }

    public boolean isLoading() {
        return state.isLoading();
    }

    public String getError() {
        return state.getError();
    }

    /**
     * Returns whether the current (or most recent) turn was manually interrupted
     * by the user clicking Stop. Used to suppress the task-completion sound.
     *
     * @return {@code true} if the user manually interrupted the current turn
     */
    public boolean isManuallyInterrupted() {
        return manuallyInterrupted;
    }

    public List<Message> getMessages() {
        return state.getMessages();
    }

    /**
     * Return a deep snapshot that can safely cross asynchronous transport boundaries.
     *
     * @return an independent message snapshot
     */
    public List<Message> getMessagesSnapshot() {
        return state.getMessagesSnapshot();
    }

    /**
     * 鎻愪緵搴曞眰浼氳瘽鐘舵€佽闂紝鐢ㄤ簬鍘嗗彶鎭㈠绛夐渶瑕佺洿鎺ラ噸寤轰細璇濆唴瀛樻€佺殑鍦烘櫙銆?     */
    public SessionState getState() {
        return state;
    }

    public String getSummary() {
        return state.getSummary();
    }

    public long getLastModifiedTime() {
        return state.getLastModifiedTime();
    }

    /**
     * Set session ID and working directory (used for session restoration).
     */
    public void setSessionInfo(String sessionId, String cwd) {
        state.setSessionId(sessionId);
        if (sessionId != null && !sessionId.trim().isEmpty()) {
            callbackFacade.notifySessionIdReceived(sessionId);
        }
        if (cwd != null) {
            setCwd(cwd);
        } else {
            state.setCwd(null);
        }
    }

    /**
     * Get the current working directory.
     */
    public String getCwd() {
        return state.getCwd();
    }

    /**
     * Set the working directory.
     */
    public void setCwd(String cwd) {
        state.setCwd(cwd);
        LOG.info("Working directory updated to: " + cwd);
    }

    /**
     * Launch Claude agent.
     * Reuses existing channelId if available, otherwise creates a new one.
     */
    public CompletableFuture<String> launchClaude() {
        if (state.getChannelId() != null) {
            return CompletableFuture.completedFuture(state.getChannelId());
        }

        state.setError(null);
        state.setChannelId(UUID.randomUUID().toString());

        return CompletableFuture.supplyAsync(() -> {
                    try {
                        // Validate and clean invalid sessionId (e.g., path instead of UUID)
                        String currentSessionId = state.getSessionId();
                        if (currentSessionId != null && (currentSessionId.contains("/") || currentSessionId.contains("\\"))) {
                            LOG.warn("sessionId looks like a path, resetting: " + currentSessionId);
                            state.setSessionId(null);
                            currentSessionId = null;
                        }

                        // Select SDK based on provider
                        String currentProvider = state.getProvider();
                        String currentChannelId = state.getChannelId();
                        String currentCwd = state.getCwd();
                        JsonObject result = providerRouter.launchChannel(
                                currentProvider,
                                currentChannelId,
                                currentSessionId,
                                currentCwd
                        );

                        // Check if sessionId exists and is not null
                        if (result.has("sessionId") && !result.get("sessionId").isJsonNull()) {
                            String newSessionId = result.get("sessionId").getAsString();
                            // Validate sessionId format (should be UUID format)
                            if (!newSessionId.contains("/") && !newSessionId.contains("\\")) {
                                state.setSessionId(newSessionId);
                                callbackFacade.notifySessionIdReceived(newSessionId);
                            } else {
                                LOG.warn("Ignoring invalid sessionId: " + newSessionId);
                            }
                        }

                        return currentChannelId;
                    } catch (Exception e) {
                        state.setError(e.getMessage());
                        state.setChannelId(null);
                        callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
                        throw new RuntimeException("Failed to launch: " + e.getMessage(), e);
                    }
                }).orTimeout(com.qwenmate.config.TimeoutConfig.QUICK_OPERATION_TIMEOUT,
                        com.qwenmate.config.TimeoutConfig.QUICK_OPERATION_UNIT)
                .exceptionally(ex -> {
                    if (ex instanceof java.util.concurrent.TimeoutException) {
                        String timeoutMsg = "Channel launch timed out (" +
                                com.qwenmate.config.TimeoutConfig.QUICK_OPERATION_TIMEOUT + "s), please retry";
                        LOG.warn(timeoutMsg);
                        state.setError(timeoutMsg);
                        state.setChannelId(null);
                        callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
                        throw new RuntimeException(timeoutMsg);
                    }
                    throw new RuntimeException(ex.getCause());
                });
    }

    /**
     * Send a message using global agent settings.
     *
     * @deprecated Use {@link #send(String, String)} with explicit agent prompt instead.
     */
    @Deprecated
    public CompletableFuture<Void> send(String input) {
        return send(input, (List<Attachment>) null, null);
    }

    /**
     * Send a message with a specific agent prompt.
     * Used for per-tab independent agent selection.
     */
    public CompletableFuture<Void> send(String input, String agentPrompt) {
        return send(input, null, agentPrompt, null, null);
    }

    /**
     * Send a message with a specific agent prompt and file tags.
     * Used for CLI context injection.
     */
    public CompletableFuture<Void> send(String input, String agentPrompt, List<String> fileTagPaths) {
        return send(input, null, agentPrompt, fileTagPaths, null);
    }

    /**
     * Send a message with a specific agent prompt, file tags and requested permission mode.
     * requestedPermissionMode priority: payload > sessionMode > default.
     */
    public CompletableFuture<Void> send(String input, String agentPrompt, List<String> fileTagPaths, String requestedPermissionMode) {
        return send(input, null, agentPrompt, fileTagPaths, requestedPermissionMode, null);
    }

    /**
     * Send a message with a specific agent prompt, file tags, requested permission mode,
     * and requested reasoning effort.
     */
    public CompletableFuture<Void> send(
            String input,
            String agentPrompt,
            List<String> fileTagPaths,
            String requestedPermissionMode,
            String requestedReasoningEffort
    ) {
        return send(input, null, agentPrompt, fileTagPaths, requestedPermissionMode,
                requestedReasoningEffort);
    }

    /**
     * Send a message with attachments using global agent settings.
     *
     * @deprecated Use {@link #send(String, List, String)} with explicit agent prompt instead.
     */
    @Deprecated
    public CompletableFuture<Void> send(String input, List<Attachment> attachments) {
        return send(input, attachments, null, null, null);
    }

    /**
     * Send a message with attachments and a specific agent prompt.
     * Used for per-tab independent agent selection.
     *
     * @param input       User input text
     * @param attachments List of attachments (nullable)
     * @param agentPrompt Agent prompt (falls back to global setting if null)
     */
    public CompletableFuture<Void> send(String input, List<Attachment> attachments, String agentPrompt) {
        return send(input, attachments, agentPrompt, null, null);
    }

    /**
     * Send a message with attachments, agent prompt, and file tags.
     * Used for CLI context injection.
     *
     * @param input        User input text
     * @param attachments  List of attachments (nullable)
     * @param agentPrompt  Agent prompt (falls back to global setting if null)
     * @param fileTagPaths File tag paths for CLI context injection
     */
    public CompletableFuture<Void> send(String input, List<Attachment> attachments, String agentPrompt, List<String> fileTagPaths) {
        return send(input, attachments, agentPrompt, fileTagPaths, null);
    }

    /**
     * Send a message with attachments, agent prompt, file tags, and a requested permission mode.
     * The effective mode is resolved with priority:
     * Priority: requestedPermissionMode > sessionMode > default.
     */
    public CompletableFuture<Void> send(
            String input,
            List<Attachment> attachments,
            String agentPrompt,
            List<String> fileTagPaths,
            String requestedPermissionMode
    ) {
        return send(input, attachments, agentPrompt, fileTagPaths, requestedPermissionMode, null);
    }

    /**
     * Send a message with attachments, agent prompt, file tags, requested permission mode,
     * and requested reasoning effort.
     * The effective mode is resolved with priority:
     * Priority: requestedPermissionMode > sessionMode > default.
     */
    public CompletableFuture<Void> send(
            String input,
            List<Attachment> attachments,
            String agentPrompt,
            List<String> fileTagPaths,
            String requestedPermissionMode,
            String requestedReasoningEffort
    ) {
        lastTurnStartedAtMillis = System.currentTimeMillis();
        // Reset the manual-interrupt flag at the start of a new turn so that
        // a fresh send is not mistaken for a user-initiated stop.
        manuallyInterrupted = false;
        String normalizedInput = (input != null) ? input.trim() : "";
        Message userMessage = contextService.buildUserMessage(normalizedInput, attachments);
        sendService.updateSessionStateForSend(userMessage, normalizedInput);

        final String finalAgentPrompt = agentPrompt;
        final List<String> finalFileTagPaths = fileTagPaths;
        final String finalRequestedPermissionMode = requestedPermissionMode;
        final String finalRequestedReasoningEffort = requestedReasoningEffort;

        return launchClaude().thenCompose(chId -> {
            sendService.prepareContextCollector(contextCollector);

            return contextCollector.collectContext().thenCompose(openedFilesJson ->
                    sendService.sendMessageToProvider(
                            chId,
                            userMessage.content,
                            attachments,
                            openedFilesJson,
                            finalAgentPrompt,
                            finalFileTagPaths,
                            finalRequestedPermissionMode,
                            finalRequestedReasoningEffort
                    )
            );
        }).exceptionally(ex -> {
            state.setError(ex.getMessage());
            state.setBusy(false);
            state.setLoading(false);
            callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
            return null;
        });
    }


    /**
     * Interrupt the current execution.
     */
    public CompletableFuture<Void> interrupt() {
        // Mark this turn as manually interrupted so the stream-end handler
        // suppresses the task-completion notification sound.
        manuallyInterrupted = true;

        String provider = state.getProvider();
        String channelId = state.getChannelId();
        if (channelId == null) {
            return CompletableFuture.completedFuture(null);
        }

        return CompletableFuture.runAsync(() -> {
            try {
                providerRouter.interruptChannel(provider, channelId);
                if (!isCurrentChannel(provider, channelId)) {
                    return;
                }
                state.setError(null);  // Clear previous error state
                state.setBusy(false);
                state.setLoading(false);  // Also reset loading state

                // Note: We intentionally don't call notifyStreamEnd() here because:
                // 1. The frontend's interruptSession() already cleans up streaming state directly
                // 2. Calling notifyStreamEnd() would trigger flushStreamMessageUpdates(),
                //    which might restore previous messages via lastMessagesSnapshot, interfering with clearMessages
                // 3. State reset is notified via callbackFacade.notifyStateChange()

                callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
            } catch (Exception e) {
                if (isCurrentChannel(provider, channelId)) {
                    state.setError(e.getMessage());
                    state.setLoading(false);  // Also reset loading on error
                    callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
                }
                throw new CompletionException(e);
            }
        });
    }

    private boolean isCurrentChannel(String provider, String channelId) {
        return Objects.equals(provider, state.getProvider())
                && Objects.equals(channelId, state.getChannelId());
    }

    /**
     * Restart the Claude agent.
     */
    public CompletableFuture<Void> restart() {
        return interrupt().thenCompose(v -> {
            state.setChannelId(null);
            state.setBusy(false);
            callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
            return launchClaude().thenApply(chId -> null);
        });
    }

    /**
     * Load message history from the server.
     */
    public CompletableFuture<Void> loadFromServer() {
        return messageOrchestrator.loadFromServer();
    }

    /**
     * Represents a file attachment (e.g., image).
     */
    public static class Attachment {
        public String fileName;
        public String mediaType;
        public String data; // Base64 encoded data

        public Attachment(String fileName, String mediaType, String data) {
            this.fileName = fileName;
            this.mediaType = mediaType;
            this.data = data;
        }
    }

    /**
     * Get the permission manager.
     */
    public PermissionManager getPermissionManager() {
        return permissionManager;
    }

    /**
     * Set the permission mode.
     * Maps frontend permission mode strings to PermissionManager enum values.
     */
    public void setPermissionMode(String mode) {
        String normalizedMode = mode != null ? mode.trim() : null;
        if ("autoEdit".equals(normalizedMode)) {
            normalizedMode = "acceptEdits";
        }
        state.setPermissionMode(normalizedMode);

        // Sync PermissionManager mode with frontend mode:
        // - "default" -> DEFAULT (ask every time)
        // - "auto" -> DEFAULT (the provider reviewer decides first; residual requests still ask)
        // - "acceptEdits" (legacy "autoEdit") -> ACCEPT_EDITS (agent mode, auto-accept file edits)
        // - "bypassPermissions" -> ALLOW_ALL (full auto, bypass all permission checks)
        // - "plan" -> DENY_ALL (plan mode, read-only tool policy)
        PermissionManager.PermissionMode pmMode;
        if ("bypassPermissions".equals(normalizedMode)) {
            pmMode = PermissionManager.PermissionMode.ALLOW_ALL;
            LOG.info("Permission mode set to ALLOW_ALL for mode: " + normalizedMode);
        } else if ("acceptEdits".equals(normalizedMode)) {
            pmMode = PermissionManager.PermissionMode.ACCEPT_EDITS;
            LOG.info("Permission mode set to ACCEPT_EDITS for mode: " + normalizedMode);
        } else if ("plan".equals(normalizedMode)) {
            pmMode = PermissionManager.PermissionMode.DENY_ALL;
            LOG.info("Permission mode set to DENY_ALL for mode: " + normalizedMode);
        } else {
            // Default asks directly; native auto reaches Java only when the provider reviewer escalates.
            pmMode = PermissionManager.PermissionMode.DEFAULT;
            LOG.info("Permission mode set to DEFAULT for mode: " + normalizedMode);
        }

        permissionManager.setPermissionMode(pmMode);
    }

    /**
     * Get the permission mode.
     */
    public String getPermissionMode() {
        return state.getPermissionMode();
    }

    /**
     * Set the model.
     */
    public void setModel(String model) {
        state.setModel(model);
        LOG.info("Model updated to: " + model);
    }

    /**
     * Get the model.
     */
    public String getModel() {
        return state.getModel();
    }

    /**
     * Returns the start time of the latest submitted turn, or {@code 0} when
     * no turn has been submitted yet.
     */
    public long getLastTurnStartedAtMillis() {
        return lastTurnStartedAtMillis;
    }

    /**
     * Set the AI provider.
     */
    public void setProvider(String provider) {
        state.setProvider(provider);
        LOG.info("Provider updated to: " + provider);
    }

    /**
     * Get the AI provider.
     */
    public String getProvider() {
        return state.getProvider();
    }

    /**
     * Get the current runtime session epoch.
     */
    public String getRuntimeSessionEpoch() {
        return state.getRuntimeSessionEpoch();
    }

    /**
     * Rotate the runtime session epoch.
     */
    public String rotateRuntimeSessionEpoch() {
        String epoch = state.rotateRuntimeSessionEpoch();
        LOG.info("[Lifecycle] Rotated runtime session epoch to: " + epoch);
        return epoch;
    }

    /**
     * Set the reasoning effort level.
     */
    public void setReasoningEffort(String effort) {
        state.setReasoningEffort(effort);
        LOG.info("Reasoning effort updated to: " + effort);
    }

    /**
     * Get the reasoning effort level.
     */
    public String getReasoningEffort() {
        return state.getReasoningEffort();
    }

    /**
     * Get the list of available slash commands.
     */
    public List<String> getSlashCommands() {
        return state.getSlashCommands();
    }


    /**
     * Create a permission request (called by the SDK).
     */
    public PermissionRequest createPermissionRequest(String toolName, Map<String, Object> inputs, JsonObject suggestions, Project project) {
        return permissionManager.createRequest(state.getChannelId(), toolName, inputs, suggestions, project);
    }

    /**
     * Handle a permission decision.
     */
    public void handlePermissionDecision(String channelId, boolean allow, boolean remember, String rejectMessage) {
        permissionManager.handlePermissionDecision(channelId, allow, remember, rejectMessage);
    }

    /**
     * Handle an "always allow" permission decision.
     */
    public void handlePermissionDecisionAlways(String channelId, boolean allow) {
        permissionManager.handlePermissionDecisionAlways(channelId, allow);
    }
}
