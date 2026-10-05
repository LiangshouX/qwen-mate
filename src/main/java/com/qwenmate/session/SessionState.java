package com.qwenmate.session;


import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Session state management.
 * Maintains all state information for a conversation session.
 */
public class SessionState {

    /**
     * Canonical whitelist of valid permission modes.
     * Shared across SessionHandler (payload validation) and QwenMateSession (mode resolution).
     */
    public static final Set<String> VALID_PERMISSION_MODES;
    static {
        Set<String> modes = new HashSet<>();
        // Canonical Qwen Code CLI approval modes.
        modes.add("plan");
        modes.add("default");
        modes.add("auto-edit");
        modes.add("auto");
        modes.add("yolo");
        // Legacy pre-QwenMate ids — accepted on input and migrated to the canonical set.
        modes.add("acceptEdits");
        modes.add("autoEdit");
        modes.add("bypassPermissions");
        VALID_PERMISSION_MODES = Collections.unmodifiableSet(modes);
    }

    /**
     * Migrate a legacy pre-QwenMate permission-mode id to its Qwen Code CLI
     * approval-mode equivalent. Unknown values pass through unchanged.
     */
    public static String migratePermissionMode(String mode) {
        if (mode == null) {
            return null;
        }
        switch (mode.trim()) {
            case "autoEdit":
            case "acceptEdits":
                return "auto-edit";
            case "bypassPermissions":
                return "yolo";
            default:
                return mode.trim();
        }
    }

    /**
     * Check whether the given mode string is a recognized permission mode.
     */
    public static boolean isValidPermissionMode(String mode) {
        return mode != null && VALID_PERMISSION_MODES.contains(mode.trim());
    }

    /**
     * Canonical whitelist of valid reasoning effort levels.
     */
    public static final Set<String> VALID_REASONING_EFFORTS;
    static {
        Set<String> efforts = new HashSet<>();
        efforts.add("low");
        efforts.add("medium");
        efforts.add("high");
        efforts.add("xhigh");
        efforts.add("max");
        VALID_REASONING_EFFORTS = Collections.unmodifiableSet(efforts);
    }

    /**
     * Check whether the given reasoning effort string is recognized.
     */
    public static boolean isValidReasoningEffort(String effort) {
        return effort != null && VALID_REASONING_EFFORTS.contains(effort.trim());
    }

    // Session identifiers
    private volatile String sessionId;
    private volatile String channelId;
    private volatile String runtimeSessionEpoch = UUID.randomUUID().toString();

    // State callbacks and history loads also run on provider and worker threads.
    private volatile boolean busy = false;
    private volatile boolean loading = false;
    private volatile String error = null;
    // Claims and releases share messageStateLock with history application.
    private volatile Object loadingOwner;

    // Message history is also updated by daemon reader and history-loader threads.
    // Every message callback and history replacement takes this lock so a transport
    // snapshot never traverses a list or raw tree while another thread is changing it.
    private final Object messageStateLock = new Object();
    private final List<QwenMateSession.Message> messages = new ArrayList<>();

    // Session metadata — cwd is written in handler thread before send(), read inside send();
    // the happens-before from CompletableFuture.runAsync guarantees visibility, so volatile is not required.
    private String summary = null;
    private long lastModifiedTime = System.currentTimeMillis();
    private String cwd = null;

    // Configuration fields below are volatile because set_mode / set_model / set_provider
    // and send_message may execute on different async handler threads with no other
    // happens-before guarantee between them.
    // Default to "default" (prompt on each tool call). "bypassPermissions" must be an
    // explicit, informed opt-in — see security remediation A: shipping bypass as the
    // out-of-the-box default removed the only confirmation gate for AI-issued commands.
    private volatile String permissionMode = "default";
    private volatile String model = "";
    private volatile String provider = "qwen";
    // Reasoning effort (thinking depth). Null means "do not override SDK/settings".
    private volatile String reasoningEffort = null;

    // Slash commands — volatile for cross-thread visibility (same reason as permissionMode/model/provider)
    private volatile List<String> slashCommands = new ArrayList<>();

    // PSI context collection toggle
    private boolean psiContextEnabled = true;

    // Getters
    public String getSessionId() {
        return sessionId;
    }

    public String getChannelId() {
        return channelId;
    }

    public boolean isBusy() {
        return busy;
    }

    public boolean isLoading() {
        return loading;
    }

    public String getError() {
        return error;
    }

    /**
     * Return a shallow list copy for ordinary read-only consumers.
     *
     * <p>Use {@code getMessagesSnapshot()} when the list is crossing an asynchronous
     * boundary. Provider callbacks own the message-state lock while enqueuing the
     * shallow list, so the coalescer can capture a consistent transport copy.</p>
     *
     * @return a defensive list copy
     */
    public List<QwenMateSession.Message> getMessages() {
        synchronized (messageStateLock) {
            return new ArrayList<>(messages);
        }
    }

    /**
     * Return an independent deep copy suitable for asynchronous transport.
     *
     * @return a stable message snapshot
     */
    List<QwenMateSession.Message> getMessagesSnapshot() {
        synchronized (messageStateLock) {
            return StreamMessageCoalescer.copyMessagesForTransport(messages);
        }
    }

    /**
     * Return the live message list for code that already owns the message-state lock.
     *
     * <p>Callers must hold {@link #getMessageStateLock()} for the entire read or write
     * operation. The list is intentionally exposed only for the provider handlers that
     * update individual message objects in place.</p>
     *
     * @return the live message list
     */
    public List<QwenMateSession.Message> getMessagesReference() {
        return messages;
    }

    /**
     * Return the lock that protects the message list and every nested raw message tree.
     *
     * @return the message-state lock
     */
    public Object getMessageStateLock() {
        return messageStateLock;
    }

    public String getSummary() {
        return summary;
    }

    public long getLastModifiedTime() {
        return lastModifiedTime;
    }

    public String getCwd() {
        return cwd;
    }

    public String getPermissionMode() {
        return permissionMode;
    }

    public String getModel() {
        return model;
    }

    public String getProvider() {
        return provider;
    }

    public String getReasoningEffort() {
        return reasoningEffort;
    }

    public String getRuntimeSessionEpoch() {
        return runtimeSessionEpoch;
    }

    public List<String> getSlashCommands() {
        return new ArrayList<>(slashCommands);
    }



    public boolean isPsiContextEnabled() {
        return psiContextEnabled;
    }

    // Setters
    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public void setChannelId(String channelId) {
        this.channelId = channelId;
    }

    public void setBusy(boolean busy) {
        this.busy = busy;
    }

    /**
     * Set the loading flag directly.
     *
     * <p>This is the unclaimed path: it takes ownership of the flag for whoever
     * called it, so a history load still in flight can no longer clear it when it
     * finishes. Asynchronous owners release it atomically through {@link #releaseLoading(Object)}.</p>
     *
     * @param loading the new loading state
     */
    public void setLoading(boolean loading) {
        synchronized (messageStateLock) {
            this.loading = loading;
            this.loadingOwner = null;
        }
    }

    /**
     * Claim the loading flag for an asynchronous operation.
     *
     * @param owner identifies the operation; compared by identity
     */
    public void claimLoading(Object owner) {
        synchronized (messageStateLock) {
            this.loading = true;
            this.loadingOwner = owner;
        }
    }

    /**
     * Return whether {@code owner} is the operation currently allowed to clear the
     * loading flag. An owner that was superseded must leave the flag alone.
     *
     * @param owner the operation asking
     * @return true when the flag still belongs to this owner
     */
    public boolean ownsLoading(Object owner) {
        return this.loadingOwner == owner;
    }

    /**
     * Release loading only if the asynchronous operation still owns it.
     *
     * @param owner the operation completing
     * @return true when this operation released the flag
     */
    public boolean releaseLoading(Object owner) {
        synchronized (messageStateLock) {
            if (!ownsLoading(owner)) {
                return false;
            }
            this.loadingOwner = null;
            this.loading = false;
            return true;
        }
    }

    public void setError(String error) {
        this.error = error;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public void setLastModifiedTime(long lastModifiedTime) {
        this.lastModifiedTime = lastModifiedTime;
    }

    public void setCwd(String cwd) {
        this.cwd = cwd;
    }

    public void setPermissionMode(String permissionMode) {
        if (permissionMode == null) {
            this.permissionMode = null;
            return;
        }
        String normalizedMode = migratePermissionMode(permissionMode);
        if (!VALID_PERMISSION_MODES.contains(normalizedMode)) {
            // Reject unrecognized modes silently to prevent injection of arbitrary strings
            return;
        }
        this.permissionMode = normalizedMode;
    }

    public void setModel(String model) {
        this.model = model == null ? null : model.trim();
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public void setReasoningEffort(String reasoningEffort) {
        if (reasoningEffort == null || reasoningEffort.trim().isEmpty()) {
            this.reasoningEffort = null;
            return;
        }
        String trimmed = reasoningEffort.trim();
        if (!isValidReasoningEffort(trimmed)) {
            return;
        }
        this.reasoningEffort = trimmed;
    }

    public void setRuntimeSessionEpoch(String runtimeSessionEpoch) {
        if (runtimeSessionEpoch == null || runtimeSessionEpoch.trim().isEmpty()) {
            this.runtimeSessionEpoch = UUID.randomUUID().toString();
            return;
        }
        this.runtimeSessionEpoch = runtimeSessionEpoch;
    }

    public String rotateRuntimeSessionEpoch() {
        String newEpoch = UUID.randomUUID().toString();
        this.runtimeSessionEpoch = newEpoch;
        return newEpoch;
    }

    public void setSlashCommands(List<String> slashCommands) {
        this.slashCommands = new ArrayList<>(slashCommands);
    }



    public void setPsiContextEnabled(boolean psiContextEnabled) {
        this.psiContextEnabled = psiContextEnabled;
    }

    /**
     * Add a message to the history.
     */
    public void addMessage(QwenMateSession.Message message) {
        synchronized (messageStateLock) {
            messages.add(message);
        }
    }

    /**
     * Replace the complete message history atomically.
     *
     * @param replacementMessages the already parsed message list
     */
    public void replaceMessages(List<QwenMateSession.Message> replacementMessages) {
        synchronized (messageStateLock) {
            messages.clear();
            messages.addAll(replacementMessages);
        }
    }

    /**
     * Prepend earlier history messages atomically.
     *
     * @param earlierMessages the already parsed, older messages
     */
    public void prependMessages(List<QwenMateSession.Message> earlierMessages) {
        synchronized (messageStateLock) {
            messages.addAll(0, earlierMessages);
        }
    }

    /**
     * Clear all messages.
     */
    public void clearMessages() {
        synchronized (messageStateLock) {
            messages.clear();
        }
    }

    /**
     * Update the last modified time to the current time.
     */
    public void updateLastModifiedTime() {
        this.lastModifiedTime = System.currentTimeMillis();
    }
}
