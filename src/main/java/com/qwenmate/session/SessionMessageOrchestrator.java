package com.qwenmate.session;

import com.qwenmate.handler.SettingsHandler;
import com.qwenmate.notifications.QwenMateNotifier;
import com.qwenmate.provider.common.SessionHistoryIncompleteException;
import com.qwenmate.provider.common.SessionHistoryNotFoundException;
import com.qwenmate.util.TokenUsageUtils;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Owns session-history loading and post-send message reconciliation.
 */
public class SessionMessageOrchestrator {

    private static final Logger LOG = Logger.getInstance(SessionMessageOrchestrator.class);

    public interface SessionHistoryAccess {
        List<JsonObject> getProviderSessionMessages(String provider, String sessionId, String cwd);

        /**
         * Turn-aligned page of a disk-backed session transcript. Returns null for
         * providers without a paginated history source so callers can degrade with a
         * "not available" notice instead of a fake success.
         */
        default JsonObject getProviderSessionMessagesPage(
                String provider, String sessionId, String cwd, Integer beforeTurn, int turnLimit) {
            return null;
        }
    }

    @FunctionalInterface
    public interface UsageDisplay {
        void show(int usedTokens, int maxTokens);
    }

    private final SessionState state;
    private final MessageParser messageParser;
    private final SessionCallbackFacade callbackFacade;
    private final SessionHistoryAccess historyAccess;
    private final UsageDisplay usageDisplay;

    /** Turns per disk-backed history page (mirrors the reference Claude paginator). */
    static final int HISTORY_TURN_PAGE_LIMIT = 30;

    /** Pagination metadata of the disk-backed transcript currently in state. */
    private volatile int historyFromTurn;
    private volatile int historyTotalTurns;
    private volatile boolean historyHasMore;

    public SessionMessageOrchestrator(
            Project project,
            SessionState state,
            MessageParser messageParser,
            SessionCallbackFacade callbackFacade,
            SessionHistoryAccess historyAccess
    ) {
        this(
                state,
                messageParser,
                callbackFacade,
                historyAccess,
                (usedTokens, maxTokens) -> {
                    if (project != null) {
                        QwenMateNotifier.setTokenUsage(project, usedTokens, maxTokens);
                    }
                    callbackFacade.notifyUsageUpdate(usedTokens, maxTokens);
                }
        );
    }

    SessionMessageOrchestrator(
            SessionState state,
            MessageParser messageParser,
            SessionCallbackFacade callbackFacade,
            SessionHistoryAccess historyAccess,
            UsageDisplay usageDisplay
    ) {
        this.state = state;
        this.messageParser = messageParser;
        this.callbackFacade = callbackFacade;
        this.historyAccess = historyAccess;
        this.usageDisplay = usageDisplay;
    }

    public CompletableFuture<Void> loadFromServer() {
        String requestedSessionId = state.getSessionId();
        if (requestedSessionId == null) {
            return CompletableFuture.completedFuture(null);
        }
        String requestedCwd = state.getCwd();
        String requestedProvider = state.getProvider();
        Object loadingToken = new Object();
        List<QwenMateSession.Message> messagesBeforeLoad;
        synchronized (state.getMessageStateLock()) {
            messagesBeforeLoad = state.getMessages();
            state.claimLoading(loadingToken);
            callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
        }

        return CompletableFuture.runAsync(() -> {
            try {
                LOG.info("Loading session from server: sessionId=" + requestedSessionId + ", cwd=" + requestedCwd);

                List<JsonObject> serverMessages = historyAccess.getProviderSessionMessages(
                        requestedProvider, requestedSessionId, requestedCwd);
                if (serverMessages == null) {
                    throw new IllegalStateException("Session history provider returned no response");
                }

                LOG.debug("Received " + serverMessages.size() + " messages from server");
                List<QwenMateSession.Message> loadedMessages = new ArrayList<>(serverMessages.size());
                for (JsonObject msg : serverMessages) {
                    QwenMateSession.Message message = messageParser.parseServerMessage(msg);
                    if (message != null) {
                        loadedMessages.add(message);
                    }
                }

                List<QwenMateSession.Message> callbackMessages;
                // Measure the freshly parsed history before taking the state lock:
                // the list is thread-local to this load, so its structural walk must
                // not extend the lock window that streaming callbacks contend on.
                Set<String> loadedStructure = MessageStructure.structuralBlockKeys(loadedMessages);
                synchronized (state.getMessageStateLock()) {
                    if (!ownsHistoryLoad(loadingToken, requestedSessionId, requestedCwd, requestedProvider)) {
                        LOG.info("Ignoring history result for a session that changed while loading");
                        return;
                    }
                    List<QwenMateSession.Message> currentMessages = state.getMessagesReference();
                    // A new row added during this read belongs to newer live work.
                    // Metadata patches keep the same row identities and remain valid.
                    if (!currentMessages.equals(messagesBeforeLoad)) {
                        return;
                    }
                    int liveHistoryBacked = countHistoryBackedMessages(currentMessages);
                    if (liveHistoryBacked > 0 && loadedMessages.size() < liveHistoryBacked) {
                        LOG.warn("Ignoring stale shorter history result: loaded="
                                + loadedMessages.size() + ", live=" + liveHistoryBacked);
                        return;
                    }
                    if (!historyPreservesCurrentStructure(loadedStructure, currentMessages)) {
                        LOG.warn("Ignoring history result that would remove live structural blocks");
                        return;
                    }

                    // Replace only after the complete response has been parsed and all
                    // ownership checks pass. A failed or partial read must never clear
                    // the live list first and leave the UI with a shorter transcript.
                    state.replaceMessages(loadedMessages);
                    state.setError(null);
                    callbackMessages = state.getMessagesSnapshot();
                    restoreTokenUsage(serverMessages);
                    callbackFacade.notifyMessageUpdate(callbackMessages);
                    seedHistoryPageInfoAfterFullLoad(requestedSessionId, loadedMessages, requestedProvider);
                }
            } catch (SessionHistoryNotFoundException e) {
                // A missing history file is an explicit stale-session signal, so unlike
                // the stale-result guards above it clears the live transcript.
                synchronized (state.getMessageStateLock()) {
                    if (!ownsHistoryLoad(loadingToken, requestedSessionId, requestedCwd, requestedProvider)) {
                        return;
                    }
                    state.setSessionId(null);
                    state.clearMessages();
                    state.setError(null);
                    callbackFacade.notifyMessageUpdate(state.getMessagesSnapshot());
                }
                LOG.warn("Session history is unavailable; cleared stale session ID: " + e.getMessage());
            } catch (SessionHistoryIncompleteException e) {
                synchronized (state.getMessageStateLock()) {
                    if (!ownsHistoryLoad(loadingToken, requestedSessionId, requestedCwd, requestedProvider)) {
                        return;
                    }
                    // An initial history open has no live transcript to keep. Let
                    // its caller offer a retry instead of reporting an empty success.
                    if (state.getMessagesReference().isEmpty()) {
                        throw new CompletionException(e);
                    }
                }
                LOG.info("Session history is still being written; keeping the live transcript: "
                        + e.getMessage());
            } catch (Exception e) {
                synchronized (state.getMessageStateLock()) {
                    if (!ownsHistoryLoad(loadingToken, requestedSessionId, requestedCwd, requestedProvider)) {
                        return;
                    }
                    state.setError(e.getMessage());
                }
                LOG.error("Error loading session: " + e.getMessage(), e);
                throw new CompletionException(e);
            } finally {
                synchronized (state.getMessageStateLock()) {
                    if (state.releaseLoading(loadingToken)) {
                        callbackFacade.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
                    }
                }
            }
        });
    }


    /**
     * Load an earlier page of disk-backed history and prepend it to the current session.
     * Called when the user requests older turns (bridge action {@code load_qwen_history_page}).
     *
     * <p>When the source reports {@code cursorReset} (the requested cursor no longer
     * matches the transcript, e.g. turns arrived after the client computed it) the
     * returned page is the latest one — the transcript is replaced, never prepended,
     * or every visible message would duplicate.</p>
     *
     * <p>The prepended transcript is pushed through the standard message-update
     * channel, whose transport keeps the frontend's {@code __messageBaseIndex}
     * incremental prefix merge consistent (tail updates when only the tail moved,
     * a full snapshot when the prefix changed).</p>
     *
     * @param sessionId  the session to page
     * @param cwd        working directory used to resolve the transcript
     * @param beforeTurn exclusive turn cursor (first turn of the page currently shown)
     * @return a future completing when the page was applied or an error was reported
     */
    public CompletableFuture<Void> loadEarlierClaudeHistoryPage(String sessionId, String cwd, Integer beforeTurn) {
        return CompletableFuture.runAsync(() -> {
            String requestedProvider = state.getProvider();
            try {
                JsonObject page = historyAccess.getProviderSessionMessagesPage(
                        requestedProvider, sessionId, cwd, beforeTurn, HISTORY_TURN_PAGE_LIMIT);
                if (page == null || !page.has("success") || !page.get("success").getAsBoolean()) {
                    String error = page != null && page.has("error") && !page.get("error").isJsonNull()
                            ? page.get("error").getAsString()
                            : "Earlier history pages are not available";
                    LOG.warn("Failed to load earlier history page: " + error);
                    callbackFacade.notifyQwenMateHistoryPageError(sessionId, error);
                    return;
                }

                List<QwenMateSession.Message> pageMessages = new ArrayList<>();
                if (page.has("messages") && page.get("messages").isJsonArray()) {
                    for (JsonElement element : page.getAsJsonArray("messages")) {
                        if (!element.isJsonObject()) {
                            continue;
                        }
                        QwenMateSession.Message message = messageParser.parseServerMessage(element.getAsJsonObject());
                        if (message != null) {
                            pageMessages.add(message);
                        }
                    }
                }

                boolean cursorReset = page.has("cursorReset") && page.get("cursorReset").getAsBoolean();
                int fromTurn = page.has("fromTurn") ? page.get("fromTurn").getAsInt() : 0;
                int totalTurns = page.has("totalTurns") ? page.get("totalTurns").getAsInt() : 0;
                boolean hasMore = page.has("hasMore") && page.get("hasMore").getAsBoolean();

                List<QwenMateSession.Message> callbackMessages;
                synchronized (state.getMessageStateLock()) {
                    if (!Objects.equals(sessionId, state.getSessionId())) {
                        LOG.info("Ignoring history page for a session that changed while loading");
                        return;
                    }
                    historyFromTurn = fromTurn;
                    historyTotalTurns = totalTurns;
                    historyHasMore = hasMore;
                    if (cursorReset) {
                        state.replaceMessages(pageMessages);
                        LOG.info("History cursor reset; replaced transcript with latest page: "
                                + pageMessages.size() + " messages, totalTurns=" + totalTurns);
                    } else {
                        state.prependMessages(pageMessages);
                        LOG.info("Prepended history page: " + pageMessages.size() + " messages"
                                + ", fromTurn=" + fromTurn + ", hasMore=" + hasMore);
                    }
                    callbackMessages = state.getMessagesSnapshot();
                }
                callbackFacade.notifyMessageUpdate(callbackMessages);
                callbackFacade.notifyQwenMateHistoryPageInfo(
                        sessionId, fromTurn, totalTurns, hasMore, cursorReset, extractSessionTitle(page));
            } catch (Exception e) {
                LOG.error("Failed to load earlier history page: " + e.getMessage(), e);
                callbackFacade.notifyQwenMateHistoryPageError(sessionId, e.getMessage());
            }
        });
    }

    /**
     * After a full transcript load nothing earlier remains on disk, so pagination
     * metadata is seeded at turn 0. Only disk-backed providers (qwen) have turn
     * metadata at all; CLI-routed providers keep their own history tooling.
     */
    private void seedHistoryPageInfoAfterFullLoad(
            String sessionId,
            List<QwenMateSession.Message> loadedMessages,
            String provider
    ) {
        if (SessionProviderRouter.isCliProvider(provider)) {
            return;
        }
        int totalTurns = 0;
        for (QwenMateSession.Message message : loadedMessages) {
            if (message.type == QwenMateSession.Message.Type.USER && !"[tool_result]".equals(message.content)) {
                totalTurns++;
            }
        }
        historyFromTurn = 0;
        historyTotalTurns = totalTurns;
        historyHasMore = false;
        callbackFacade.notifyQwenMateHistoryPageInfo(sessionId, 0, totalTurns, false, false, null);
    }

    private static String extractSessionTitle(JsonObject page) {
        if (page == null || !page.has("sessionTitle") || page.get("sessionTitle").isJsonNull()) {
            return null;
        }
        try {
            return page.get("sessionTitle").getAsString();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    /** Pagination metadata of the currently loaded disk-backed transcript. */
    public int getHistoryFromTurn() {
        return historyFromTurn;
    }

    /** Pagination metadata of the currently loaded disk-backed transcript. */
    public int getHistoryTotalTurns() {
        return historyTotalTurns;
    }

    /** Pagination metadata of the currently loaded disk-backed transcript. */
    public boolean hasMoreHistory() {
        return historyHasMore;
    }

    /**
     * Count the live messages a history read can legitimately reproduce.
     *
     * <p>The staleness guard compares the loaded history against the live list, but
     * the live list also carries rows a history read can never reproduce:
     * locally-synthesized rows (an ERROR bubble added by a failed turn, a SYSTEM
     * notice) and rows the history parser permanently filters (the
     * {@code "No response requested."} assistant placeholder, command-tag user
     * rows 鈥?both admitted by the live handlers). Counting any of them would make
     * the history permanently shorter than the live list, so the guard would
     * reject every later reload and a failed turn's error bubble would never
     * clear. Only rows {@link MessageParser#isHistoryReproducible} accepts are
     * counted.</p>
     *
     * @param messages live transcript
     * @return how many messages a history read could reproduce
     */
    private static int countHistoryBackedMessages(List<QwenMateSession.Message> messages) {
        int count = 0;
        for (QwenMateSession.Message message : messages) {
            if (MessageParser.isHistoryReproducible(message)) {
                count++;
            }
        }
        return count;
    }

    private boolean ownsHistoryLoad(Object token, String sessionId, String cwd, String provider) {
        return state.ownsLoading(token)
                && Objects.equals(sessionId, state.getSessionId())
                && Objects.equals(cwd, state.getCwd())
                && Objects.equals(provider, state.getProvider());
    }

    /**
     * Reject missing live structure, but allow persisted payloads to be normalized.
     * Serialized size cannot distinguish a truncated block from a valid shorter one.
     */
    private static boolean historyPreservesCurrentStructure(
            Set<String> loadedStructure,
            List<QwenMateSession.Message> currentMessages
    ) {
        return loadedStructure.containsAll(MessageStructure.structuralBlockKeys(currentMessages));
    }

    private void restoreTokenUsage(List<JsonObject> serverMessages) {
        try {
            JsonObject lastUsage = TokenUsageUtils.findLastUsageFromRawMessages(serverMessages, state.getProvider());
            if (lastUsage == null) {
                return;
            }

            int usedTokens = TokenUsageUtils.extractContextTokens(lastUsage, state.getProvider());
            int fallbackMaxTokens = SettingsHandler.getModelContextLimit(
                    state.getProvider(), state.getModel());
            int maxTokens = TokenUsageUtils.extractMaxTokens(lastUsage, fallbackMaxTokens);
            usageDisplay.show(usedTokens, maxTokens);
            LOG.debug("Restored token usage from history: " + usedTokens + " / " + maxTokens);
        } catch (Exception e) {
            LOG.warn("Failed to extract token usage from history: " + e.getMessage());
        }
    }

}
