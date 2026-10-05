package com.qwenmate.session;

import com.qwenmate.provider.qwen.QwenHistoryReader;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.util.Collections;
import java.util.List;

/**
 * Centralizes provider-specific bridge routing for session operations.
 */
public class SessionProviderRouter {

    private static final Logger LOG = Logger.getInstance(SessionProviderRouter.class);

    private final QwenSDKBridge qwenSDKBridge;

    public SessionProviderRouter(QwenSDKBridge qwenSDKBridge) {
        this.qwenSDKBridge = qwenSDKBridge;
    }

    public JsonObject launchChannel(String provider, String channelId, String sessionId, String cwd) {
        return qwenSDKBridge.launchChannel(channelId, sessionId, cwd);
    }

    public void interruptChannel(String provider, String channelId) {
        qwenSDKBridge.interruptChannel(channelId);
    }

    public List<JsonObject> getSessionMessages(String provider, String sessionId, String cwd) {
        try {
            return new QwenHistoryReader().getSessionMessages(sessionId, cwd);
        } catch (Exception e) {
            LOG.warn("[Qwen] Failed to load session history for " + sessionId + ": " + e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Turn-aligned history page for providers whose transcripts live on disk.
     * Returns {@code null} for providers without a paginated history source
     * (callers degrade to a "not available" notice).
     */
    public JsonObject getSessionMessagesPage(String provider, String sessionId, String cwd, Integer beforeTurn, int turnLimit) {
        return new QwenHistoryReader().getSessionMessagesPage(sessionId, cwd, beforeTurn, turnLimit);
    }
}
