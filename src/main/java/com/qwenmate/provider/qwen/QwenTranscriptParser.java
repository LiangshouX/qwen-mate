package com.qwenmate.provider.qwen;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.qwenmate.util.UsageCostCalculator;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Parses Qwen Code session transcripts into the Claude-template message shape that
 * {@code QwenMessageHandler} builds from live streaming events.
 *
 * <p>Storage (qwen-code 0.20.x – 0.24.x): append-only JSONL under
 * {@code ~/.qwen/projects/<sanitized-cwd>/chats/<sessionId>.jsonl}. Each record looks like
 * {@code {uuid, parentUuid, sessionId, timestamp, type, cwd, version, model,
 * message: {role, parts}, usageMetadata, toolCallResult, systemPayload}} where
 * {@code parts} are Gemini-style ({@code text}, {@code text + thought},
 * {@code functionCall}, {@code functionResponse}, {@code inlineData}). Records may be
 * fragmented (several rows sharing one {@code uuid}); the active transcript is the
 * {@code parentUuid} chain that ends at the last conversation record.</p>
 *
 * <p>Conversion target (must stay identical to the live shapes produced by
 * {@code QwenMessageHandler} from ai-bridge markers):
 * <ul>
 *   <li>assistant record → one {@code {type:"assistant", message:{role:"assistant",
 *       content:[thinking|text|tool_use], usage}}} message</li>
 *   <li>user record → one {@code {type:"user", message:{role:"user",
 *       content:[text|image]}}} message (hook-context parts projected away)</li>
 *   <li>each functionResponse → one {@code {type:"user", message:{role:"user",
 *       content:[tool_result]}}} message</li>
 *   <li>system records carry no messages; their payloads feed session metadata</li>
 * </ul>
 *
 * <p>Every parse is lenient: malformed rows are skipped, torn tails are tolerated,
 * and dirty input can never surface as an unchecked exception.</p>
 */
public final class QwenTranscriptParser {

    /** Longest title kept for history lists (mirrors the reference implementation's lite reader). */
    public static final int TITLE_MAX_CHARS = 200;

    private static final String USER_PROMPT_SUBMIT_CONTEXT_OPEN = "<qwen:user-prompt-submit-context>";
    private static final String USER_PROMPT_SUBMIT_CONTEXT_CLOSE = "</qwen:user-prompt-submit-context>";

    private QwenTranscriptParser() {
    }

    /** Fully parsed session transcript plus its list metadata. */
    public static final class ParsedSession {
        /** Claude-template messages in transcript order (see class doc). */
        public final List<JsonObject> messages;
        /** Display title: custom title when recorded, otherwise the first user prompt. */
        public final String title;
        /** Custom title recorded in the transcript, or null. */
        public final String customTitle;
        /** Last model recorded in the transcript, or null. */
        public final String model;
        /** Session source type ("cli", "sdk-cli", …) or "" when the file records none. */
        public final String entrypoint;
        /** Working directory recorded on the transcript records, or null. */
        public final String cwd;
        /** Epoch millis of the first message, 0 when unknown. */
        public final long firstTimestamp;
        /** Epoch millis of the last message, 0 when unknown. */
        public final long lastTimestamp;

        ParsedSession(
                List<JsonObject> messages,
                String title,
                String customTitle,
                String model,
                String entrypoint,
                String cwd,
                long firstTimestamp,
                long lastTimestamp
        ) {
            this.messages = messages;
            this.title = title;
            this.customTitle = customTitle;
            this.model = model;
            this.entrypoint = entrypoint;
            this.cwd = cwd;
            this.firstTimestamp = firstTimestamp;
            this.lastTimestamp = lastTimestamp;
        }
    }

    /**
     * Parse one session file. Returns an empty session for missing or unreadable
     * content; only genuine IO failures on the file itself propagate.
     *
     * @param file the session JSONL file
     * @return the parsed transcript, never null
     * @throws IOException when the file cannot be read
     */
    public static ParsedSession parse(Path file) throws IOException {
        return parse(file, false);
    }

    /**
     * Parse one session file, optionally keeping sidechain records (subagent
     * transcripts store only sidechain rows).
     *
     * @param file            the session JSONL file
     * @param includeSidechain keep {@code isSidechain} records instead of dropping them
     * @return the parsed transcript, never null
     * @throws IOException when the file cannot be read
     */
    public static ParsedSession parse(Path file, boolean includeSidechain) throws IOException {
        return parseLines(readLinesLenient(file), includeSidechain);
    }

    /**
     * Parse already-read JSONL lines. Package-private test seam shared by every
     * caller so the conversion rules live in exactly one place.
     */
    static ParsedSession parseLines(List<String> lines) {
        return parseLines(lines, false);
    }

    /**
     * Parse already-read JSONL lines, optionally keeping sidechain records.
     */
    static ParsedSession parseLines(List<String> lines, boolean includeSidechain) {
        List<JsonObject> conversationRecords = new ArrayList<>();
        // Parent links of every record (including system rows): the active chain
        // traverses system records even though they produce no messages.
        Map<String, String> parentByUuid = new LinkedHashMap<>();
        String customTitle = null;
        String model = null;
        String entrypoint = null;
        String cwd = null;
        boolean chainable = true;

        if (lines != null) {
            for (String line : lines) {
                if (line == null || line.isBlank()) {
                    continue;
                }
                JsonObject record = tryParseRecord(line);
                if (record == null) {
                    continue;
                }
                if (isSidechain(record) && !includeSidechain) {
                    continue;
                }
                String uuid = getString(record, "uuid");
                if (uuid != null && !uuid.isBlank()) {
                    parentByUuid.putIfAbsent(uuid, getString(record, "parentUuid"));
                }
                String type = getString(record, "type");
                if ("system".equals(type)) {
                    String payloadTitle = extractCustomTitle(record);
                    if (payloadTitle != null && !payloadTitle.isBlank()) {
                        customTitle = payloadTitle;
                    }
                    String payloadModel = extractSessionModel(record);
                    if (payloadModel != null && !payloadModel.isBlank()) {
                        model = payloadModel;
                    }
                    String payloadEntrypoint = extractSessionSource(record);
                    if (payloadEntrypoint != null && !payloadEntrypoint.isBlank()) {
                        entrypoint = payloadEntrypoint;
                    }
                    continue;
                }
                if (!"user".equals(type) && !"assistant".equals(type) && !"tool_result".equals(type)) {
                    continue;
                }
                if (cwd == null) {
                    cwd = getString(record, "cwd");
                }
                String recordModel = getString(record, "model");
                if (recordModel != null && !recordModel.isBlank()) {
                    model = recordModel;
                }
                if (uuid == null || uuid.isBlank()) {
                    chainable = false;
                }
                conversationRecords.add(record);
            }
        }

        List<JsonObject> ordered = chainable
                ? resolveChain(conversationRecords, parentByUuid)
                : conversationRecords;

        List<JsonObject> messages = new ArrayList<>();
        for (JsonObject record : ordered) {
            messages.addAll(convertRecord(record));
        }

        long firstTimestamp = 0L;
        long lastTimestamp = 0L;
        for (JsonObject message : messages) {
            long timestamp = parseTimestampMillis(getString(message, "timestamp"));
            if (timestamp > 0) {
                if (firstTimestamp <= 0) {
                    firstTimestamp = timestamp;
                }
                lastTimestamp = timestamp;
            }
        }

        String title = customTitle != null && !customTitle.isBlank()
                ? truncateTitle(customTitle)
                : deriveTitle(messages);
        String resolvedEntrypoint = entrypoint != null ? entrypoint : "";
        return new ParsedSession(
                messages, title, customTitle, model, resolvedEntrypoint, cwd, firstTimestamp, lastTimestamp);
    }

    /**
     * Aggregate fragmented records (shared uuid) and walk the {@code parentUuid}
     * chain from the transcript leaf. The walk follows links through system
     * records (attribution snapshots, telemetry) that produce no messages but are
     * part of the chain. A broken chain keeps the recovered prefix; a file without
     * any chainable record falls back to file order.
     */
    private static List<JsonObject> resolveChain(
            List<JsonObject> conversationRecords,
            Map<String, String> parentByUuid
    ) {
        Map<String, List<JsonObject>> fragmentsByUuid = new LinkedHashMap<>();
        for (JsonObject record : conversationRecords) {
            String uuid = getString(record, "uuid");
            if (uuid == null || uuid.isBlank()) {
                // Defensive: callers only route fully-chainable lists here.
                return conversationRecords;
            }
            fragmentsByUuid.computeIfAbsent(uuid, key -> new ArrayList<>()).add(record);
        }
        if (fragmentsByUuid.isEmpty()) {
            return conversationRecords;
        }

        Map<String, JsonObject> aggregatedByUuid = new LinkedHashMap<>();
        for (Map.Entry<String, List<JsonObject>> entry : fragmentsByUuid.entrySet()) {
            aggregatedByUuid.put(entry.getKey(), aggregateFragments(entry.getValue()));
        }

        String leaf = null;
        for (String uuid : fragmentsByUuid.keySet()) {
            leaf = uuid;
        }
        Deque<String> chain = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        String current = leaf;
        while (current != null && visited.add(current)) {
            JsonObject record = aggregatedByUuid.get(current);
            if (record != null) {
                chain.addFirst(current);
            }
            current = parentByUuid.get(current);
        }

        List<JsonObject> ordered = new ArrayList<>(chain.size());
        for (String uuid : chain) {
            ordered.add(aggregatedByUuid.get(uuid));
        }
        return ordered;
    }

    /**
     * Merge transcript fragments that share one uuid into a single record:
     * parts concatenate, later usage/metadata wins (same rules as the qwen-code
     * transcript reader).
     */
    private static JsonObject aggregateFragments(List<JsonObject> fragments) {
        if (fragments.size() == 1) {
            return fragments.get(0);
        }
        JsonObject merged = fragments.get(0).deepCopy();
        for (int i = 1; i < fragments.size(); i++) {
            JsonObject fragment = fragments.get(i);
            JsonObject mergedMessage = getObject(merged, "message");
            JsonObject fragmentMessage = getObject(fragment, "message");
            if (fragmentMessage != null && fragmentMessage.has("parts") && fragmentMessage.get("parts").isJsonArray()) {
                if (mergedMessage == null) {
                    mergedMessage = new JsonObject();
                    merged.add("message", mergedMessage);
                }
                JsonArray mergedParts = mergedMessage.has("parts") && mergedMessage.get("parts").isJsonArray()
                        ? mergedMessage.getAsJsonArray("parts")
                        : new JsonArray();
                for (JsonElement part : fragmentMessage.getAsJsonArray("parts").deepCopy()) {
                    mergedParts.add(part);
                }
                mergedMessage.add("parts", mergedParts);
            }
            if (fragment.has("usageMetadata") && !fragment.get("usageMetadata").isJsonNull()) {
                merged.add("usageMetadata", fragment.get("usageMetadata").deepCopy());
            }
            if (fragment.has("toolCallResult") && !merged.has("toolCallResult")) {
                merged.add("toolCallResult", fragment.get("toolCallResult").deepCopy());
            }
            if (!merged.has("model") && fragment.has("model")) {
                merged.add("model", fragment.get("model").deepCopy());
            }
            String mergedTimestamp = getString(merged, "timestamp");
            String fragmentTimestamp = getString(fragment, "timestamp");
            if (fragmentTimestamp != null
                    && (mergedTimestamp == null || fragmentTimestamp.compareTo(mergedTimestamp) > 0)) {
                merged.addProperty("timestamp", fragmentTimestamp);
            }
        }
        return merged;
    }

    /**
     * Convert one transcript record into zero or more Claude-template messages.
     * Sidechain filtering happens in {@link #parseLines}; subagent transcripts
     * rely on it here.
     */
    static List<JsonObject> convertRecord(JsonObject record) {
        List<JsonObject> out = new ArrayList<>();
        if (record == null) {
            return out;
        }
        String type = getString(record, "type");
        JsonObject message = getObject(record, "message");
        if ("assistant".equals(type)) {
            JsonObject raw = buildAssistantRaw(record, message);
            if (raw != null) {
                out.add(raw);
            }
            return out;
        }
        if (!"user".equals(type) && !"tool_result".equals(type)) {
            return out;
        }

        String uuid = getString(record, "uuid");
        String timestamp = getString(record, "timestamp");
        JsonObject toolCallResult = getObject(record, "toolCallResult");
        boolean isErrorResult = toolCallResult != null && isErrorStatus(getString(toolCallResult, "status"));

        List<JsonObject> toolResults = new ArrayList<>();
        for (JsonElement blockElement : extractBlocks(record, message)) {
            JsonObject block = blockElement.getAsJsonObject();
            String blockType = getString(block, "type");
            if ("tool_result".equals(blockType)) {
                // Mirrors QwenMessageHandler.handleToolResult exactly: a bare
                // {content:[tool_result]} message with no role field.
                JsonObject raw = envelope("user", uuid, timestamp);
                JsonObject inner = new JsonObject();
                JsonArray content = new JsonArray();
                JsonObject toolResult = block.deepCopy();
                if (!toolResult.has("is_error")) {
                    toolResult.addProperty("is_error", isErrorResult);
                }
                content.add(toolResult);
                inner.add("content", content);
                raw.add("message", inner);
                if (toolCallResult != null) {
                    raw.add("toolUseResult", toolCallResult.deepCopy());
                }
                toolResults.add(raw);
            }
        }

        JsonArray visible = visibleBlocks(record, message);
        if (visible.size() > 0) {
            JsonObject raw = envelope("user", uuid, timestamp);
            String sessionId = getString(record, "sessionId");
            if (sessionId != null && !sessionId.isBlank()) {
                raw.addProperty("session_id", sessionId);
            }
            raw.add("parent_tool_use_id", JsonNull.INSTANCE);
            JsonObject inner = new JsonObject();
            inner.addProperty("role", "user");
            inner.add("content", visible);
            raw.add("message", inner);
            out.add(raw);
        }
        out.addAll(toolResults);
        return out;
    }

    /** Build the assistant raw message (blocks + usage) or null when it carries nothing. */
    private static JsonObject buildAssistantRaw(JsonObject record, JsonObject message) {
        JsonArray blocks = extractBlocks(record, message).deepCopy();
        JsonObject usage = normalizeUsage(record);
        if (blocks.isEmpty() && usage == null) {
            return null;
        }
        JsonObject raw = envelope("assistant", getString(record, "uuid"), getString(record, "timestamp"));
        JsonObject inner = new JsonObject();
        inner.addProperty("role", "assistant");
        inner.add("content", blocks);
        if (usage != null) {
            inner.add("usage", usage.deepCopy());
            raw.add("turnUsage", usage);
            Double turnCostUsd = UsageCostCalculator.calculateTurnCostUsd("qwen", usage, getString(record, "model"));
            if (turnCostUsd != null) {
                raw.addProperty("turnCostUsd", turnCostUsd);
            }
        }
        raw.add("message", inner);
        return raw;
    }

    /** Common raw envelope fields shared by every converted message. */
    private static JsonObject envelope(String type, String uuid, String timestamp) {
        JsonObject raw = new JsonObject();
        raw.addProperty("type", type);
        if (uuid != null && !uuid.isBlank()) {
            raw.addProperty("uuid", uuid);
        }
        if (timestamp != null && !timestamp.isBlank()) {
            raw.addProperty("timestamp", timestamp);
        }
        return raw;
    }

    /**
     * Normalize the transcript's usage metadata to the canonical snake_case shape
     * that {@code QwenSDKBridge.normalizeUsageToSnakeCase} produces for live
     * {@code [USAGE]} events (input_tokens / output_tokens / thought_tokens /
     * cached_read_tokens / total_tokens).
     */
    static JsonObject normalizeUsage(JsonObject record) {
        JsonObject usageMetadata = getObject(record, "usageMetadata");
        if (usageMetadata == null) {
            return null;
        }
        JsonObject mapped = new JsonObject();
        mapPositiveInt(usageMetadata, mapped, "input_tokens", "promptTokenCount", "promptTokens", "prompt_tokens");
        mapPositiveInt(usageMetadata, mapped, "output_tokens", "candidatesTokenCount", "completionTokenCount",
                "outputTokens", "output_tokens");
        mapPositiveInt(usageMetadata, mapped, "thought_tokens", "thoughtsTokenCount", "thoughtsTokens",
                "thoughtTokens", "reasoningTokens");
        mapPositiveInt(usageMetadata, mapped, "cached_read_tokens", "cachedContentTokenCount", "cachedTokens",
                "cachedReadTokens");
        mapPositiveInt(usageMetadata, mapped, "cached_write_tokens", "cachedWriteTokens");
        mapPositiveInt(usageMetadata, mapped, "total_tokens", "totalTokenCount", "totalTokens", "total_tokens");
        if (mapped.size() == 0) {
            return QwenSDKBridge.normalizeUsageToSnakeCase(usageMetadata.deepCopy());
        }
        JsonObject canonical = QwenSDKBridge.normalizeUsageToSnakeCase(mapped);
        return canonical != null ? canonical : mapped;
    }

    private static void mapPositiveInt(JsonObject source, JsonObject target, String targetKey, String... sourceKeys) {
        for (String sourceKey : sourceKeys) {
            if (!source.has(sourceKey) || source.get(sourceKey).isJsonNull()) {
                continue;
            }
            try {
                int value = source.get(sourceKey).getAsInt();
                if (value > 0) {
                    target.addProperty(targetKey, value);
                    return;
                }
            } catch (RuntimeException ignored) {
                // Non-numeric metadata is skipped like any other dirty field.
            }
        }
    }

    /**
     * Extract Claude-template content blocks from a record. Supports both the
     * Gemini {@code message.parts} layout and already-SDK-shaped
     * {@code message.content} payloads (format variants across qwen-code versions).
     */
    static JsonArray extractBlocks(JsonObject record, JsonObject message) {
        JsonArray blocks = new JsonArray();
        if (message != null && message.has("parts") && message.get("parts").isJsonArray()) {
            JsonArray parts = message.getAsJsonArray("parts");
            if (record != null && "user".equals(getString(record, "type"))) {
                parts = projectUserParts(record, parts);
            }
            for (JsonElement partElement : parts) {
                convertPart(partElement, record, blocks);
            }
            return blocks;
        }
        JsonElement content = message != null && message.has("content")
                ? message.get("content")
                : (record != null && record.has("content") ? record.get("content") : null);
        if (content == null || content.isJsonNull()) {
            return blocks;
        }
        if (content.isJsonPrimitive()) {
            addTextBlock(blocks, content.getAsString());
            return blocks;
        }
        if (content.isJsonArray()) {
            for (JsonElement element : content.getAsJsonArray()) {
                if (element.isJsonObject()) {
                    blocks.add(element.getAsJsonObject().deepCopy());
                } else if (element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
                    addTextBlock(blocks, element.getAsString());
                }
            }
        }
        return blocks;
    }

    /**
     * Select the user-visible projection of a prompt record (mirrors qwen-code's
     * {@code projectUserTranscriptForDisplay}): when hook provenance carries an
     * authoritative {@code displayText}, model-facing text parts (including the
     * {@code <qwen:user-prompt-submit-context>} wrapper) are replaced by it; a
     * trailing hook-context part alone is dropped; legacy records keep their parts.
     */
    static JsonArray projectUserParts(JsonObject record, JsonArray parts) {
        if (parts == null || parts.size() == 0) {
            return parts != null ? parts : new JsonArray();
        }
        boolean hasFinalHookContextPart = parts.size() > 1 && isUserPromptSubmitContextPart(lastPart(parts));
        JsonObject payload = getObject(record, "systemPayload");
        boolean isUserPromptPayload = payload != null
                && (payload.has("hookContext") || hasFinalHookContextPart);
        String displayText = null;
        if (isUserPromptPayload && payload.has("displayText") && payload.get("displayText").isJsonPrimitive()) {
            displayText = payload.get("displayText").getAsString();
        }
        if (displayText != null) {
            JsonArray projected = new JsonArray();
            JsonObject textPart = new JsonObject();
            textPart.addProperty("text", displayText);
            projected.add(textPart);
            for (JsonElement part : parts) {
                if (!part.isJsonObject() || !(part.getAsJsonObject().has("text")
                        && part.getAsJsonObject().get("text").isJsonPrimitive())) {
                    projected.add(part.deepCopy());
                }
            }
            return projected;
        }
        if (payload == null && hasFinalHookContextPart) {
            JsonArray projected = new JsonArray();
            for (int i = 0; i < parts.size() - 1; i++) {
                projected.add(parts.get(i).deepCopy());
            }
            return projected;
        }
        return parts;
    }

    private static JsonElement lastPart(JsonArray parts) {
        return parts.get(parts.size() - 1);
    }

    private static boolean isUserPromptSubmitContextPart(JsonElement part) {
        if (part == null || !part.isJsonObject()) {
            return false;
        }
        JsonObject partObject = part.getAsJsonObject();
        if (!partObject.has("text") || !partObject.get("text").isJsonPrimitive()) {
            return false;
        }
        String text = partObject.get("text").getAsString().trim();
        String prefix = USER_PROMPT_SUBMIT_CONTEXT_OPEN + "\n";
        String suffix = "\n" + USER_PROMPT_SUBMIT_CONTEXT_CLOSE;
        return text.startsWith(prefix) && text.endsWith(suffix);
    }

    /** Blocks shown for a user message: everything except tool results. */
    private static JsonArray visibleBlocks(JsonObject record, JsonObject message) {
        JsonArray visible = new JsonArray();
        for (JsonElement block : extractBlocks(record, message)) {
            if (!"tool_result".equals(getString(block.getAsJsonObject(), "type"))) {
                visible.add(block);
            }
        }
        return visible;
    }

    /** Convert one Gemini-style part into zero or more Claude-template blocks. */
    private static void convertPart(JsonElement partElement, JsonObject record, JsonArray blocks) {
        if (partElement == null || partElement.isJsonNull()) {
            return;
        }
        if (partElement.isJsonPrimitive()) {
            // Only string primitives are legitimate text parts; numbers/booleans are dirty data.
            if (partElement.getAsJsonPrimitive().isString()) {
                addTextBlock(blocks, partElement.getAsString());
            }
            return;
        }
        if (!partElement.isJsonObject()) {
            return;
        }
        JsonObject part = partElement.getAsJsonObject();
        if (part.has("functionCall") && part.get("functionCall").isJsonObject()) {
            JsonObject functionCall = part.getAsJsonObject("functionCall");
            JsonObject toolUse = new JsonObject();
            toolUse.addProperty("type", "tool_use");
            String id = getString(functionCall, "id");
            if (id != null && !id.isBlank()) {
                toolUse.addProperty("id", id);
            }
            String name = getString(functionCall, "name");
            toolUse.addProperty("name", name != null ? name : "");
            JsonElement args = functionCall.get("args");
            toolUse.add("input", args != null && !args.isJsonNull() ? args.deepCopy() : new JsonObject());
            blocks.add(toolUse);
            return;
        }
        if (part.has("functionResponse") && part.get("functionResponse").isJsonObject()) {
            JsonObject functionResponse = part.getAsJsonObject("functionResponse");
            JsonObject toolResult = new JsonObject();
            toolResult.addProperty("type", "tool_result");
            String id = getString(functionResponse, "id");
            if (id == null || id.isBlank()) {
                id = getString(functionResponse, "name");
            }
            if (id != null && !id.isBlank()) {
                toolResult.addProperty("tool_use_id", id);
            }
            toolResult.addProperty("content", stringifyResponse(functionResponse.get("response")));
            blocks.add(toolResult);
            return;
        }
        if (part.has("inlineData") && part.get("inlineData").isJsonObject()) {
            JsonObject inlineData = part.getAsJsonObject("inlineData");
            String mimeType = getString(inlineData, "mimeType");
            String data = getString(inlineData, "data");
            if (data != null && !data.isBlank()) {
                JsonObject image = new JsonObject();
                image.addProperty("type", "image");
                image.addProperty("src", "data:" + (mimeType != null ? mimeType : "image/png") + ";base64," + data);
                image.addProperty("mediaType", mimeType != null ? mimeType : "image/png");
                blocks.add(image);
            }
            return;
        }
        if (part.has("text") && part.get("text").isJsonPrimitive()) {
            String text = part.get("text").getAsString();
            if (isThought(part)) {
                JsonObject thinking = new JsonObject();
                thinking.addProperty("type", "thinking");
                thinking.addProperty("thinking", text != null ? text : "");
                blocks.add(thinking);
            } else {
                addTextBlock(blocks, text);
            }
        }
    }

    private static boolean isThought(JsonObject part) {
        if (!part.has("thought") || part.get("thought").isJsonNull()) {
            return false;
        }
        try {
            return part.get("thought").getAsBoolean();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static void addTextBlock(JsonArray blocks, String text) {
        JsonObject block = new JsonObject();
        block.addProperty("type", "text");
        block.addProperty("text", text != null ? text : "");
        blocks.add(block);
    }

    /** Tool results serialize like the live bridge: strings pass through, objects stringify. */
    private static String stringifyResponse(JsonElement response) {
        if (response == null || response.isJsonNull()) {
            return "";
        }
        if (response.isJsonPrimitive() && response.getAsJsonPrimitive().isString()) {
            return response.getAsString();
        }
        return response.toString();
    }

    /** Derive the list title from the first visible user prompt. */
    static String deriveTitle(List<JsonObject> messages) {
        if (messages == null) {
            return null;
        }
        for (JsonObject message : messages) {
            if (!"user".equals(getString(message, "type"))) {
                continue;
            }
            JsonObject inner = getObject(message, "message");
            if (inner == null || !inner.has("content") || !inner.get("content").isJsonArray()) {
                continue;
            }
            StringBuilder text = new StringBuilder();
            for (JsonElement element : inner.getAsJsonArray("content")) {
                if (element.isJsonObject() && "text".equals(getString(element.getAsJsonObject(), "type"))) {
                    String part = getString(element.getAsJsonObject(), "text");
                    if (part != null && !part.trim().isEmpty()) {
                        if (text.length() > 0) {
                            text.append(' ');
                        }
                        text.append(part.trim());
                    }
                }
            }
            if (text.length() == 0) {
                continue;
            }
            return truncateTitle(text.toString().replace('\n', ' '));
        }
        return null;
    }

    static String truncateTitle(String title) {
        if (title == null) {
            return null;
        }
        String trimmed = title.trim();
        if (trimmed.length() <= TITLE_MAX_CHARS) {
            return trimmed;
        }
        return trimmed.substring(0, TITLE_MAX_CHARS).trim() + "…";
    }

    private static String extractCustomTitle(JsonObject record) {
        if (!"custom_title".equals(getString(record, "subtype"))) {
            return null;
        }
        JsonObject payload = getObject(record, "systemPayload");
        return payload != null ? getString(payload, "customTitle") : null;
    }

    private static String extractSessionModel(JsonObject record) {
        if (!"session_model".equals(getString(record, "subtype"))) {
            return null;
        }
        JsonObject payload = getObject(record, "systemPayload");
        return payload != null ? getString(payload, "modelId") : null;
    }

    private static String extractSessionSource(JsonObject record) {
        if (!"session_source".equals(getString(record, "subtype"))) {
            return null;
        }
        JsonObject payload = getObject(record, "systemPayload");
        return payload != null ? getString(payload, "sourceType") : null;
    }

    private static boolean isErrorStatus(String status) {
        return status != null && (status.equalsIgnoreCase("error") || status.equalsIgnoreCase("failed"));
    }

    private static boolean isSidechain(JsonObject record) {
        if (record == null || !record.has("isSidechain") || record.get("isSidechain").isJsonNull()) {
            return false;
        }
        try {
            return record.get("isSidechain").getAsBoolean();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    /** Parse one JSONL line into an object record, or null for anything unusable. */
    private static JsonObject tryParseRecord(String line) {
        try {
            JsonElement parsed = JsonParser.parseString(line);
            return parsed.isJsonObject() ? parsed.getAsJsonObject() : null;
        } catch (RuntimeException ignored) {
            // Torn tail or dirty data: skip the line, keep the rest.
            return null;
        }
    }

    private static String getString(JsonObject object, String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
            return null;
        }
        JsonElement element = object.get(key);
        return element.isJsonPrimitive() ? element.getAsString() : null;
    }

    private static JsonObject getObject(JsonObject object, String key) {
        if (object == null || !object.has(key) || !object.get(key).isJsonObject()) {
            return null;
        }
        return object.getAsJsonObject(key);
    }

    /** Tolerant ISO-8601 → epoch-millis conversion; 0 when unparseable. */
    static long parseTimestampMillis(String timestamp) {
        if (timestamp == null || timestamp.isBlank()) {
            return 0L;
        }
        try {
            return Long.parseLong(timestamp.trim());
        } catch (NumberFormatException ignored) {
            // Not epoch-millis; fall through to ISO parsing.
        }
        try {
            return Instant.parse(timestamp.trim()).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            return 0L;
        }
    }

    /**
     * Read all lines with a UTF-8 decoder that replaces malformed bytes instead of
     * throwing, so a mid-append write cannot fail the whole session read.
     */
    private static List<String> readLinesLenient(Path file) throws IOException {
        List<String> lines = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                Files.newInputStream(file),
                StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPLACE)
                        .onUnmappableCharacter(CodingErrorAction.REPLACE)))) {
            String line;
            while ((line = reader.readLine()) != null) {
                lines.add(line);
            }
        }
        return lines;
    }
}
