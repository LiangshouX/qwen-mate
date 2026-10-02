package com.qwenmate.session;

import com.qwenmate.provider.common.MarkerCliBridge;
import com.qwenmate.provider.qwen.QwenHistoryReader;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Centralizes provider-specific bridge routing for session operations.
 */
public class SessionProviderRouter {

    private static final Logger LOG = Logger.getInstance(SessionProviderRouter.class);

    /**
     * Canonical ids of the built-in CLI providers routed through
     * {@link MarkerCliBridge} — the keys of the map built by
     * {@link #registerCliBridges(MarkerCliBridge...)} for the bundled bridges.
     */
    private static final Set<String> CLI_PROVIDER_IDS = Set.of("dsh");

    /**
     * Whether {@code provider} is a headless CLI provider routed through the
     * CLI bridge map. Use this instead of repeating provider-id literals.
     */
    public static boolean isCliProvider(String provider) {
        return provider != null && CLI_PROVIDER_IDS.contains(provider);
    }

    private final QwenSDKBridge qwenSDKBridge;
    private final Map<String, MarkerCliBridge> cliBridges;

    public SessionProviderRouter(
            QwenSDKBridge qwenSDKBridge,
            Map<String, MarkerCliBridge> cliBridges
    ) {
        this.qwenSDKBridge = qwenSDKBridge;
        this.cliBridges = cliBridges != null
                ? Collections.unmodifiableMap(new LinkedHashMap<>(cliBridges))
                : Collections.emptyMap();
    }

    public static Map<String, MarkerCliBridge> registerCliBridges(MarkerCliBridge... bridges) {
        Map<String, MarkerCliBridge> map = new LinkedHashMap<>();
        if (bridges == null) {
            return map;
        }
        for (MarkerCliBridge bridge : bridges) {
            if (bridge != null) {
                map.put(bridge.providerId(), bridge);
            }
        }
        return map;
    }

    private MarkerCliBridge cli(String provider) {
        return provider != null ? cliBridges.get(provider) : null;
    }

    public JsonObject launchChannel(String provider, String channelId, String sessionId, String cwd) {
        MarkerCliBridge bridge = cli(provider);
        if (bridge != null) {
            return bridge.launchChannel(channelId, sessionId, cwd);
        }
        return qwenSDKBridge.launchChannel(channelId, sessionId, cwd);
    }

    public void interruptChannel(String provider, String channelId) {
        MarkerCliBridge bridge = cli(provider);
        if (bridge != null) {
            bridge.interruptChannel(channelId);
            return;
        }
        qwenSDKBridge.interruptChannel(channelId);
    }

    public List<JsonObject> getSessionMessages(String provider, String sessionId, String cwd) {
        MarkerCliBridge bridge = cli(provider);
        if (bridge != null) {
            return bridge.getSessionMessages(sessionId, cwd);
        }
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
        MarkerCliBridge bridge = cli(provider);
        if (bridge != null) {
            return null;
        }
        return new QwenHistoryReader().getSessionMessagesPage(sessionId, cwd, beforeTurn, turnLimit);
    }

    public Map<String, MarkerCliBridge> getCliBridges() {
        return cliBridges;
    }
}
