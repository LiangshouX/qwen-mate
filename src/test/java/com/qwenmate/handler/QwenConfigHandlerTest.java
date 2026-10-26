package com.qwenmate.handler;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.settings.QwenCliConfigReader;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * QwenConfigHandler default-model dispatch tests — the Java layer must forward
 * the picker selection to the CLI settings writer, echo the canonical result
 * shape, and refresh the model catalog only when the write succeeded.
 */
public class QwenConfigHandlerTest {

    private static final Path SETTINGS_PATH =
            Paths.get(System.getProperty("java.io.tmpdir"), "qwm-qwen-config-test", "settings.json");

    @Before
    public void pointAtTempSettingsFile() {
        QwenCliConfigReader.setSettingsPathOverrideForTests(SETTINGS_PATH);
    }

    @After
    public void resetSettingsOverride() {
        QwenCliConfigReader.setSettingsPathOverrideForTests(null);
    }

    @Test
    public void successForwardsSelectionAndRefreshesModelOptions() {
        List<String[]> calls = new ArrayList<>();
        QwenConfigHandler handler = new QwenConfigHandler(
                recordingContext(calls),
                (settingsPath, payloadJson) -> {
                    assertEquals(SETTINGS_PATH.toString(), settingsPath);
                    JsonObject payload = JsonParser.parseString(payloadJson).getAsJsonObject();
                    assertEquals("setDefaultModel", payload.get("op").getAsString());
                    assertEquals("m1", payload.get("modelId").getAsString());
                    assertEquals("mygw", payload.get("provider").getAsString());
                    return "{\"ok\":true,\"op\":\"setDefaultModel\",\"snapshot\":{}}";
                });

        handler.handleSetQwenDefaultModel("{\"modelId\":\"m1\",\"provider\":\"mygw\"}");

        assertEquals(2, calls.size());
        assertEquals("window.onQwenDefaultModelResult", calls.get(0)[0]);
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertTrue(result.get("success").getAsBoolean());
        assertEquals("m1", result.get("modelId").getAsString());
        assertEquals("window.updateQwenModelOptions", calls.get(1)[0]);
    }

    @Test
    public void writerFailureIsEchoedWithoutRefreshingOptions() {
        List<String[]> calls = new ArrayList<>();
        QwenConfigHandler handler = new QwenConfigHandler(
                recordingContext(calls),
                (settingsPath, payloadJson) ->
                        "{\"ok\":false,\"code\":\"model_not_found\",\"message\":\"模型不存在：ghost\"}");

        handler.handleSetQwenDefaultModel("{\"modelId\":\"ghost\",\"provider\":\"openai\"}");

        assertEquals(1, calls.size());
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertFalse(result.get("success").getAsBoolean());
        assertEquals("model_not_found", result.get("code").getAsString());
        assertEquals("模型不存在：ghost", result.get("error").getAsString());
    }

    @Test
    public void missingModelIdNeverReachesTheWriter() {
        List<String[]> calls = new ArrayList<>();
        AtomicInteger runnerCalls = new AtomicInteger();
        QwenConfigHandler handler = new QwenConfigHandler(
                recordingContext(calls),
                (settingsPath, payloadJson) -> {
                    runnerCalls.incrementAndGet();
                    return "{\"ok\":true}";
                });

        handler.handleSetQwenDefaultModel("{\"provider\":\"openai\"}");

        assertEquals(0, runnerCalls.get());
        assertEquals(1, calls.size());
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertFalse(result.get("success").getAsBoolean());
        assertEquals("modelId is required", result.get("error").getAsString());
    }

    @Test
    public void malformedWriterOutputMapsToBridgeError() {
        List<String[]> calls = new ArrayList<>();
        QwenConfigHandler handler = new QwenConfigHandler(
                recordingContext(calls),
                (settingsPath, payloadJson) -> "not-json-at-all");

        handler.handleSetQwenDefaultModel("{\"modelId\":\"m1\"}");

        assertEquals(1, calls.size());
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertFalse(result.get("success").getAsBoolean());
        assertEquals("bridge_error", result.get("code").getAsString());
    }

    private HandlerContext recordingContext(List<String[]> calls) {
        return new HandlerContext(
                null,
                null,
                null,
                new HandlerContext.JsCallback() {
                    @Override
                    public void callJavaScript(String functionName, String... args) {
                        calls.add(new String[] { functionName, args.length > 0 ? args[0] : "" });
                    }

                    @Override
                    public String escapeJs(String str) {
                        return str;
                    }
                });
    }
}
