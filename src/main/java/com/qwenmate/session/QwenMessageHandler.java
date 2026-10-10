package com.qwenmate.session;

import com.qwenmate.handler.provider.ModelProviderHandler;
import com.qwenmate.provider.common.MessageCallback;
import com.qwenmate.provider.common.SDKResult;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.qwenmate.session.QwenMateSession.Message;
import com.qwenmate.util.TokenUsageUtils;
import com.qwenmate.util.UsageCostCalculator;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.util.ArrayList;
import java.util.List;

/**
 * Qwen message callback handler (Claude-template protocol surface).
 *
 * Grows toward QwenMessageHandler event types without reusing Claude-specific
 * Anthropic assumptions wholesale (handler strategy A).
 *
 * Protocol tags from ai-bridge Qwen ACP normalizer:
 *   message_start / message_end / stream_start / stream_end / block_reset
 *   content_delta / content / thinking / thinking_delta
 *   assistant / user / result / session_id / tool_use / tool_result / usage
 */
public class QwenMessageHandler implements MessageCallback {
    private static final Logger LOG = Logger.getInstance(QwenMessageHandler.class);

    private final SessionState state;
    private final CallbackHandler callbackHandler;
    private final Gson gson = new Gson();
    /** Same merger as Claude: preserves mid-turn tool_use when final text snapshots arrive. */
    private final MessageMerger messageMerger = new MessageMerger();

    private final StringBuilder assistantContent = new StringBuilder();
    private Message currentAssistantMessage = null;
    /**
     * Assistant bubble owned by the active stream. After {@code stream_start} we only
     * attach content to this message — never to a completed previous-turn assistant
     * (which would silently glue two answers together when the send-time user message
     * is missing from state).
     */
    private Message assistantMessageForCurrentStream = null;

    private boolean isStreaming = false;
    private boolean streamEndedThisTurn = false;
    private boolean isThinking = false;

    /** Wall-clock anchor of the current turn (set on message_start) for [Qwen][Timing] logs. */
    private long turnStartMillis = 0;
    private boolean firstDeltaLogged = false;

    private String elapsed() {
        if (turnStartMillis <= 0) {
            return "(no turn start)";
        }
        return (System.currentTimeMillis() - turnStartMillis) + "ms";
    }

    public QwenMessageHandler(SessionState state, CallbackHandler callbackHandler) {
        this.state = state;
        this.callbackHandler = callbackHandler;
    }

    @Override
    public void onMessage(String type, String content) {
        synchronized (state.getMessageStateLock()) {
            LOG.debug("QwenMessageHandler.onMessage: type=" + type);

            switch (type) {
                case "assistant":
                case "message":
                    handleAssistantMessage(content);
                    break;
                case "user":
                    handleUserMessage(content);
                    break;
                case "result":
                    handleResultMessage(content);
                    break;
                case "session_id":
                case "thread_id":
                    handleSessionId(content);
                    break;
                case "slash_commands":
                    handleSlashCommands(content);
                    break;
                case "stream_start":
                    handleStreamStart();
                    break;
                case "stream_end":
                    handleStreamEnd();
                    break;
                case "block_reset":
                    handleBlockReset();
                    break;
                case "content_delta":
                case "content":
                    handleContentDelta(content);
                    break;
                case "thinking":
                    handleThinking();
                    break;
                case "thinking_delta":
                    handleThinkingDelta(content);
                    break;
                case "tool_use":
                    handleToolUse(content);
                    break;
                case "tool_result":
                    handleToolResult(content);
                    break;
                case "usage":
                    handleUsage(content);
                    break;
                case "status":
                    if (content != null && !content.trim().isEmpty()) {
                        callbackHandler.notifyStatusMessage(content);
                    }
                    break;
                case "message_start":
                    // lifecycle marker; stream_start drives UI
                    turnStartMillis = System.currentTimeMillis();
                    firstDeltaLogged = false;
                    break;
                case "message_end":
                    handleMessageEnd();
                    break;
                default:
                    LOG.debug("QwenMessageHandler: Unhandled message type: " + type);
            }
        }
    }

    @Override
    public void onError(String error) {
        synchronized (state.getMessageStateLock()) {
            isStreaming = false;
            streamEndedThisTurn = false;
            if (isThinking) {
                isThinking = false;
                callbackHandler.notifyThinkingStatusChanged(false);
            }
            state.setError(error);
            state.setBusy(false);
            state.setLoading(false);

            // One failure can reach onError more than once ([SEND_ERROR], the Node
            // success envelope, the executor tail all report the same text). Teardown
            // must run every time, but only the first report becomes a bubble.
            if (!isDuplicateTrailingError(error)) {
                state.addMessage(new Message(Message.Type.ERROR, error));
            }

            // Always end stream so tool cards / loading state finalize
            callbackHandler.notifyStreamEnd();
            callbackHandler.notifyMessageUpdate(state.getMessages());
            resetStreamingAccumulator();
            callbackHandler.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
        }
    }

    /**
     * True when the last message is an ERROR carrying the same text — the duplicate
     * reports of one failure. Distinct errors (or an error after other messages) still render.
     */
    private boolean isDuplicateTrailingError(String error) {
        if (error == null) {
            return false;
        }
        List<Message> messages = state.getMessagesReference();
        if (messages.isEmpty()) {
            return false;
        }
        Message last = messages.get(messages.size() - 1);
        return last.type == Message.Type.ERROR && error.equals(last.content);
    }

    @Override
    public void onComplete(SDKResult result) {
        synchronized (state.getMessageStateLock()) {
            boolean streamEndedBeforeComplete = streamEndedThisTurn;
            boolean wasStreaming = isStreaming;

            LOG.info("[Qwen][Timing] complete at " + elapsed()
                    + " (streamEndSeen=" + streamEndedBeforeComplete + ", wasStreaming=" + wasStreaming + ")");

            isStreaming = false;
            streamEndedThisTurn = false;
            if (isThinking) {
                isThinking = false;
                callbackHandler.notifyThinkingStatusChanged(false);
            }
            state.setBusy(false);
            state.setLoading(false);
            state.updateLastModifiedTime();

            if (wasStreaming && !streamEndedBeforeComplete) {
                LOG.warn("Qwen onComplete called without prior stream_end; forcing stream cleanup");
                callbackHandler.notifyMessageUpdate(state.getMessages());
                callbackHandler.notifyStreamEnd();
            }

            resetStreamingAccumulator();
            callbackHandler.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
        }
    }

    // ===== Private handlers =====

    private void handleAssistantMessage(String jsonContent) {
        try {
            JsonObject msgJson = gson.fromJson(jsonContent, JsonObject.class);
            if (msgJson == null) {
                return;
            }

            Message parsed = parseAssistantMessage(msgJson);
            if (parsed == null) {
                return;
            }

            Message target = resolveAssistantMessageForStream();
            // Preserve any usage already stamped by [USAGE] — final [MESSAGE] from the
            // normalizer historically had no usage and wiped the context-ring snapshot.
            JsonObject priorUsage = extractUsageFromAssistantRaw(target.raw);
            // Always merge into existing raw. Qwen finishSuccess emits:
            //   1) ledger flush: tool_use (+ tool_result as separate user msgs)
            //   2) final [MESSAGE] with only thinking/text
            // The old branch only merged when the *incoming* payload had tool_use,
            // so step (2) replaced raw entirely and wiped tool cards + StatusPanel
            // "编辑 +N -M". History reload rebuilds tools from chat_history.jsonl,
            // which is why reopening the session showed edits again.
            if (target.raw != null) {
                target.raw = messageMerger.mergeAssistantMessage(target.raw, msgJson);
            } else {
                target.raw = parsed.raw;
            }
            // Prefer usage from the incoming message (finishSuccess now attaches it);
            // otherwise restore prior snapshot so the next usage refresh still works.
            JsonObject incomingUsage = extractUsageFromAssistantRaw(target.raw);
            if (incomingUsage == null && priorUsage != null) {
                restoreUsageOnAssistantRaw(target.raw, priorUsage);
            }
            if (parsed.content != null && !parsed.content.isEmpty()) {
                if (!isStreaming || parsed.content.length() >= assistantContent.length()) {
                    target.content = parsed.content;
                    assistantContent.setLength(0);
                    assistantContent.append(parsed.content);
                }
            }
            // Structural changes (tool_use) must refresh UI even during streaming
            callbackHandler.notifyMessageUpdate(state.getMessages());
        } catch (Exception e) {
            LOG.warn("Failed to parse Qwen assistant message: " + e.getMessage());
        }
    }

    private void handleUserMessage(String jsonContent) {
        try {
            JsonObject msgJson = gson.fromJson(jsonContent, JsonObject.class);
            if (msgJson == null) {
                return;
            }

            if (hasToolResult(msgJson)) {
                Message toolResultMessage = new Message(Message.Type.USER, "[tool_result]", msgJson);
                state.addMessage(toolResultMessage);
                callbackHandler.notifyMessageUpdate(state.getMessages());
                return;
            }

            // Live user text is owned by SessionSendService at send-time. ACP/user echoes
            // must NOT addMessage again — that re-appends the user's first message after
            // the assistant and glues turns in the UI. Mirror Claude: patch existing only.
            String userText = extractText(msgJson);
            if (userText == null || userText.isEmpty()) {
                LOG.debug("Qwen user message has no text; skipping");
                return;
            }

            List<Message> messages = state.getMessagesReference();
            for (int i = messages.size() - 1; i >= 0; i--) {
                Message msg = messages.get(i);
                if (msg.type != Message.Type.USER) {
                    continue;
                }
                if (userText.equals(msg.content)) {
                    if (msg.raw == null) {
                        msg.raw = msgJson;
                    }
                    LOG.debug("Qwen user message matched existing send-time bubble; not duplicating");
                    callbackHandler.notifyMessageUpdate(state.getMessages());
                    return;
                }
            }
            // No matching send-time bubble (edge path). Still avoid inventing a trailing
            // user after an assistant mid-conversation — the webview optimistic path
            // owns display until SessionSendService persists the message.
            LOG.debug("Qwen user message with no matching state entry; not adding to avoid duplicate bubble");
        } catch (Exception e) {
            LOG.warn("Failed to parse Qwen user message: " + e.getMessage());
        }
    }

    private void handleResultMessage(String jsonContent) {
        if (jsonContent == null || !jsonContent.startsWith("{")) {
            return;
        }
        try {
            JsonObject resultJson = gson.fromJson(jsonContent, JsonObject.class);
            if (resultJson != null && resultJson.has("usage") && currentAssistantMessage != null) {
                if (currentAssistantMessage.raw == null) {
                    currentAssistantMessage.raw = new JsonObject();
                }
                currentAssistantMessage.raw.add("turnUsage", resultJson.get("usage").deepCopy());
                Double turnCostUsd = UsageCostCalculator.calculateTurnCostUsd(
                        "qwen", resultJson.get("usage").getAsJsonObject(), state.getModel());
                if (turnCostUsd != null) {
                    currentAssistantMessage.raw.addProperty("turnCostUsd", turnCostUsd);
                }
                callbackHandler.notifyMessageUpdate(state.getMessages());
            }
        } catch (Exception e) {
            LOG.debug("Qwen result parse skipped: " + e.getMessage());
        }
    }

    private void handleSessionId(String id) {
        if (id != null && !id.trim().isEmpty()) {
            state.setSessionId(id.trim());
            callbackHandler.notifySessionIdReceived(id.trim());
            LOG.info("Captured Qwen session ID: " + id.trim());
        }
    }

    /**
     * Runtime slash-command names the CLI registered for the current mode.
     * Forwarded so the suggestion palette can drop commands this mode rejects
     * ("not supported in this mode") and surface ones the static table missed.
     */
    private void handleSlashCommands(String jsonContent) {
        if (jsonContent == null || jsonContent.isEmpty()) {
            return;
        }
        try {
            JsonArray names = gson.fromJson(jsonContent, JsonArray.class);
            if (names == null || names.size() == 0) {
                return;
            }
            List<String> commands = new ArrayList<>(names.size());
            for (JsonElement element : names) {
                if (element.isJsonPrimitive()) {
                    String name = element.getAsString();
                    if (name != null && !name.isEmpty()) {
                        commands.add(name);
                    }
                }
            }
            if (commands.isEmpty()) {
                return;
            }
            state.setSlashCommands(commands);
            callbackHandler.notifySlashCommandsReceived(commands);
            LOG.debug("Qwen runtime slash commands: " + commands.size());
        } catch (Exception e) {
            LOG.debug("Qwen slash command parse skipped: " + e.getMessage());
        }
    }

    private void handleStreamStart() {
        isStreaming = true;
        streamEndedThisTurn = false;
        resetStreamingAccumulator();
        LOG.info("[Qwen][Timing] stream_start at " + elapsed());
        callbackHandler.notifyStreamStart();
    }

    private void handleStreamEnd() {
        streamEndedThisTurn = true;
        isStreaming = false;
        LOG.info("[Qwen][Timing] stream_end at " + elapsed()
                + " (busy=false loading=false pushed to UI on this callback)");
        if (isThinking) {
            isThinking = false;
            callbackHandler.notifyThinkingStatusChanged(false);
        }
        // Re-push context usage at end of turn so the ring is not left at 0% when
        // mid-turn [USAGE] raced with MESSAGE overwrite or coalesced updateMessages.
        pushContextUsageFromCurrentAssistant();
        callbackHandler.notifyMessageUpdate(state.getMessages());
        callbackHandler.notifyStreamEnd();
        state.setBusy(false);
        state.setLoading(false);
        state.updateLastModifiedTime();
        callbackHandler.notifyStateChange(state.isBusy(), state.isLoading(), state.getError());
    }

    private void handleBlockReset() {
        // New structural segment after tools — clear delta accumulator for next text block
        assistantContent.setLength(0);
        currentAssistantMessage = null;
        try {
            callbackHandler.notifyBlockReset();
        } catch (Exception e) {
            LOG.debug("notifyBlockReset not available or failed: " + e.getMessage());
        }
    }

    private void handleContentDelta(String content) {
        if (content == null || content.isEmpty()) {
            return;
        }
        if (!firstDeltaLogged) {
            firstDeltaLogged = true;
            LOG.info("[Qwen][Timing] first_content_delta at " + elapsed());
        }
        if (isThinking) {
            isThinking = false;
            callbackHandler.notifyThinkingStatusChanged(false);
        }
        assistantContent.append(content);

        Message target = resolveAssistantMessageForStream();
        target.content = assistantContent.toString();
        callbackHandler.notifyContentDelta(content);
        if (!isStreaming) {
            callbackHandler.notifyMessageUpdate(state.getMessages());
        }
    }

    private void handleThinking() {
        if (!isThinking) {
            isThinking = true;
            callbackHandler.notifyThinkingStatusChanged(true);
        }
    }

    private void handleThinkingDelta(String content) {
        if (content == null || content.isEmpty()) {
            return;
        }
        if (!isThinking) {
            isThinking = true;
            callbackHandler.notifyThinkingStatusChanged(true);
        }
        ensureAssistantRaw();
        appendThinkingToRaw(content);
        try {
            callbackHandler.notifyThinkingDelta(content);
        } catch (Exception e) {
            LOG.debug("notifyThinkingDelta failed: " + e.getMessage());
        }
        callbackHandler.notifyMessageUpdate(state.getMessages());
    }

    private void handleToolUse(String content) {
        if (content == null || content.isEmpty()) {
            return;
        }
        try {
            JsonObject parsed = gson.fromJson(content, JsonObject.class);
            if (parsed == null) {
                return;
            }
            // Attach tool_use block(s) to the active assistant bubble so the tool card
            // renders inside the assistant message (matches QwenMessageHandler model).
            ensureAssistantRaw();
            int appended = 0;
            for (JsonObject block : extractToolUseBlocks(parsed)) {
                appendToolUseToRaw(block);
                appended++;
            }
            if (appended > 0) {
                callbackHandler.notifyMessageUpdate(state.getMessages());
            }
        } catch (Exception e) {
            LOG.warn("Failed to parse Qwen tool_use: " + e.getMessage());
        }
    }

    private void handleToolResult(String content) {
        if (content == null || !content.startsWith("{")) {
            return;
        }
        try {
            JsonObject toolResultBlock = gson.fromJson(content, JsonObject.class);
            String toolUseId = toolResultBlock.has("tool_use_id")
                    ? toolResultBlock.get("tool_use_id").getAsString()
                    : null;
            if (toolUseId == null) {
                return;
            }

            JsonArray contentArray = new JsonArray();
            contentArray.add(toolResultBlock);
            JsonObject messageObj = new JsonObject();
            messageObj.add("content", contentArray);
            JsonObject rawUser = new JsonObject();
            rawUser.addProperty("type", "user");
            rawUser.add("message", messageObj);

            Message toolResultMessage = new Message(Message.Type.USER, "[tool_result]", rawUser);
            state.addMessage(toolResultMessage);
            callbackHandler.notifyMessageUpdate(state.getMessages());
        } catch (Exception e) {
            LOG.warn("Failed to parse Qwen tool_result: " + e.getMessage());
        }
    }

    private void handleUsage(String content) {
        if (content == null || content.isEmpty()) {
            return;
        }
        try {
            JsonObject usage = gson.fromJson(content, JsonObject.class);
            if (usage == null) {
                return;
            }
            ensureAssistantRaw();
            // Prefer snake_case for stored message.usage (OpenAI shape); camelCase ACP is fallback input.
            JsonObject canonical = QwenSDKBridge.normalizeUsageToSnakeCase(usage);
            JsonObject storedUsage = canonical != null ? canonical : usage;
            JsonObject message = currentAssistantMessage.raw.has("message")
                    && currentAssistantMessage.raw.get("message").isJsonObject()
                    ? currentAssistantMessage.raw.getAsJsonObject("message")
                    : new JsonObject();
            message.add("usage", storedUsage);
            currentAssistantMessage.raw.add("message", message);

            int used = QwenSDKBridge.extractUsedTokens(storedUsage);
            if (used > 0) {
                int maxTokens = TokenUsageUtils.extractMaxTokens(storedUsage,
                        ModelProviderHandler.getModelContextLimit(state.getModel()));
                LOG.info("Qwen [USAGE] context ring: used=" + used + " max=" + maxTokens
                        + " model=" + state.getModel());
                callbackHandler.notifyUsageUpdate(used, maxTokens);
            } else {
                LOG.warn("Qwen [USAGE] received but extractUsedTokens=0 payload=" + content);
            }
            callbackHandler.notifyMessageUpdate(state.getMessages());
        } catch (Exception e) {
            LOG.debug("Qwen usage parse skipped: " + e.getMessage());
        }
    }

    private void handleMessageEnd() {
        if (isThinking) {
            isThinking = false;
            callbackHandler.notifyThinkingStatusChanged(false);
        }
    }

    private Message parseAssistantMessage(JsonObject msg) {
        String text = extractText(msg);
        Message m = new Message(Message.Type.ASSISTANT, text != null ? text : "");
        m.raw = msg;
        return m;
    }

    private String extractText(JsonObject msg) {
        if (msg == null) {
            return "";
        }
        try {
            if (msg.has("message") && msg.get("message").isJsonObject()) {
                JsonObject message = msg.getAsJsonObject("message");
                if (message.has("content")) {
                    JsonElement c = message.get("content");
                    if (c.isJsonArray()) {
                        StringBuilder sb = new StringBuilder();
                        for (JsonElement el : c.getAsJsonArray()) {
                            if (el.isJsonObject()) {
                                JsonObject b = el.getAsJsonObject();
                                if (b.has("text")) {
                                    sb.append(b.get("text").getAsString());
                                }
                            }
                        }
                        return sb.toString();
                    } else if (c.isJsonPrimitive()) {
                        return c.getAsString();
                    }
                }
            }
            if (msg.has("content") && msg.get("content").isJsonPrimitive()) {
                return msg.get("content").getAsString();
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private boolean hasToolResult(JsonObject msg) {
        try {
            if (msg != null && msg.has("message") && msg.get("message").isJsonObject()) {
                JsonObject message = msg.getAsJsonObject("message");
                if (message.has("content") && message.get("content").isJsonArray()) {
                    for (JsonElement el : message.getAsJsonArray("content")) {
                        if (el.isJsonObject() && el.getAsJsonObject().has("type")) {
                            if ("tool_result".equals(el.getAsJsonObject().get("type").getAsString())) {
                                return true;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    /** Collect tool_use blocks from either a bare block or a message wrapper. */
    private List<JsonObject> extractToolUseBlocks(JsonObject parsed) {
        List<JsonObject> blocks = new ArrayList<>();
        if (parsed.has("type") && "tool_use".equals(parsed.get("type").getAsString())) {
            blocks.add(parsed);
            return blocks;
        }
        if (parsed.has("message") && parsed.get("message").isJsonObject()) {
            JsonObject message = parsed.getAsJsonObject("message");
            if (message.has("content") && message.get("content").isJsonArray()) {
                for (JsonElement el : message.getAsJsonArray("content")) {
                    if (el.isJsonObject() && el.getAsJsonObject().has("type")
                            && "tool_use".equals(el.getAsJsonObject().get("type").getAsString())) {
                        blocks.add(el.getAsJsonObject());
                    }
                }
            }
        }
        return blocks;
    }

    private void ensureAssistantRaw() {
        Message target = resolveAssistantMessageForStream();
        if (target.raw == null) {
            JsonObject raw = new JsonObject();
            raw.addProperty("type", "assistant");
            JsonObject messageObj = new JsonObject();
            messageObj.add("content", new JsonArray());
            raw.add("message", messageObj);
            target.raw = raw;
        }
    }

    /** usage object from assistant raw.message.usage, or null. */
    private static JsonObject extractUsageFromAssistantRaw(JsonObject raw) {
        if (raw == null) {
            return null;
        }
        try {
            if (raw.has("message") && raw.get("message").isJsonObject()) {
                JsonObject message = raw.getAsJsonObject("message");
                if (message.has("usage") && message.get("usage").isJsonObject()) {
                    return message.getAsJsonObject("usage");
                }
            }
            if (raw.has("usage") && raw.get("usage").isJsonObject()) {
                return raw.getAsJsonObject("usage");
            }
        } catch (Exception ignored) {
            // ignore
        }
        return null;
    }

    private static void restoreUsageOnAssistantRaw(JsonObject raw, JsonObject usage) {
        if (raw == null || usage == null) {
            return;
        }
        JsonObject message = raw.has("message") && raw.get("message").isJsonObject()
                ? raw.getAsJsonObject("message")
                : new JsonObject();
        message.add("usage", usage.deepCopy());
        raw.add("message", message);
    }

    private void pushContextUsageFromCurrentAssistant() {
        Message target = assistantMessageForCurrentStream != null
                ? assistantMessageForCurrentStream
                : currentAssistantMessage;
        if (target == null) {
            return;
        }
        JsonObject usage = extractUsageFromAssistantRaw(target.raw);
        if (usage == null) {
            return;
        }
        int used = QwenSDKBridge.extractUsedTokens(usage);
        if (used <= 0) {
            return;
        }
        int maxTokens = TokenUsageUtils.extractMaxTokens(usage,
                ModelProviderHandler.getModelContextLimit(state.getModel()));
        LOG.info("Qwen stream_end context ring push: used=" + used + " max=" + maxTokens);
        callbackHandler.notifyUsageUpdate(used, maxTokens);
    }

    /**
     * Resolve the assistant bubble for the current stream. Always creates a new
     * message on the first call after {@code stream_start} instead of reusing a
     * completed previous-turn assistant (see {@link #assistantMessageForCurrentStream}).
     */
    private Message resolveAssistantMessageForStream() {
        if (currentAssistantMessage != null) {
            return currentAssistantMessage;
        }
        if (assistantMessageForCurrentStream != null) {
            currentAssistantMessage = assistantMessageForCurrentStream;
            return currentAssistantMessage;
        }
        Message created = new Message(Message.Type.ASSISTANT, assistantContent.toString());
        state.addMessage(created);
        currentAssistantMessage = created;
        assistantMessageForCurrentStream = created;
        return created;
    }

    private void appendThinkingToRaw(String delta) {
        ensureAssistantRaw();
        JsonObject raw = currentAssistantMessage.raw;
        JsonObject message = raw.has("message") && raw.get("message").isJsonObject()
                ? raw.getAsJsonObject("message")
                : new JsonObject();
        JsonArray content = message.has("content") && message.get("content").isJsonArray()
                ? message.getAsJsonArray("content")
                : new JsonArray();

        JsonObject thinkingBlock = null;
        for (int i = content.size() - 1; i >= 0; i--) {
            JsonElement el = content.get(i);
            if (el.isJsonObject() && el.getAsJsonObject().has("type")
                    && "thinking".equals(el.getAsJsonObject().get("type").getAsString())) {
                thinkingBlock = el.getAsJsonObject();
                break;
            }
        }
        if (thinkingBlock == null) {
            thinkingBlock = new JsonObject();
            thinkingBlock.addProperty("type", "thinking");
            thinkingBlock.addProperty("thinking", delta);
            content.add(thinkingBlock);
        } else {
            String prev = thinkingBlock.has("thinking") ? thinkingBlock.get("thinking").getAsString() : "";
            thinkingBlock.addProperty("thinking", prev + delta);
        }
        message.add("content", content);
        raw.add("message", message);
    }

    private void appendToolUseToRaw(JsonObject toolUseBlock) {
        ensureAssistantRaw();
        JsonObject raw = currentAssistantMessage.raw;
        JsonObject message = raw.has("message") && raw.get("message").isJsonObject()
                ? raw.getAsJsonObject("message")
                : new JsonObject();
        JsonArray content = message.has("content") && message.get("content").isJsonArray()
                ? message.getAsJsonArray("content")
                : new JsonArray();
        content.add(toolUseBlock.deepCopy());
        message.add("content", content);
        raw.add("message", message);
    }

    private void resetStreamingAccumulator() {
        assistantContent.setLength(0);
        currentAssistantMessage = null;
        assistantMessageForCurrentStream = null;
    }
}
