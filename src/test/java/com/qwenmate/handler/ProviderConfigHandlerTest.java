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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * ProviderConfigHandler dispatch tests — the Java layer must forward ops to
 * the Node settings-writer service, echo requestId, map failures to the
 * canonical {ok:false} shape, and never leak the inbound payload (which can
 * carry a freshly typed API key) into callbacks or error messages.
 */
public class ProviderConfigHandlerTest {

    private static final Path SETTINGS_PATH =
            Paths.get(System.getProperty("java.io.tmpdir"), "qwm-provider-test", "settings.json");

    @Before
    public void pointAtTempSettingsFile() {
        QwenCliConfigReader.setSettingsPathOverrideForTests(SETTINGS_PATH);
    }

    @After
    public void resetSettingsOverride() {
        QwenCliConfigReader.setSettingsPathOverrideForTests(null);
    }

    @Test
    public void getProviderConfigPushesServiceResultToWebview() {
        List<String[]> calls = new ArrayList<>();
        ProviderConfigHandler handler = new ProviderConfigHandler(
                recordingContext(calls),
                (settingsPath, projectSettingsPath, payloadJson) -> {
                    assertEquals(SETTINGS_PATH.toString(), settingsPath);
                    assertTrue("snapshot op expected", payloadJson.contains("\"op\":\"snapshot\""));
                    return "{\"ok\":true,\"op\":\"snapshot\",\"snapshot\":{\"catalog\":[{\"id\":\"deepseek\"}]}}";
                });

        handler.handleGetProviderConfig();

        assertEquals(1, calls.size());
        assertEquals("window.updateProviderConfig", calls.get(0)[0]);
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertTrue(result.get("ok").getAsBoolean());
        assertEquals("deepseek",
                result.getAsJsonObject("snapshot").getAsJsonArray("catalog").get(0)
                        .getAsJsonObject().get("id").getAsString());
    }

    @Test
    public void mutatingOpEchoesRequestIdAndSnapshot() {
        List<String[]> calls = new ArrayList<>();
        ProviderConfigHandler handler = new ProviderConfigHandler(
                recordingContext(calls),
                (settingsPath, projectSettingsPath, payloadJson) -> {
                    assertTrue(payloadJson.contains("saveProvider"));
                    return "{\"ok\":true,\"op\":\"saveProvider\",\"snapshot\":{\"providers\":[]}}";
                });

        handler.handleProviderConfigOp(
                "{\"op\":\"saveProvider\",\"presetId\":\"deepseek\",\"apiKey\":\"sk-secret-input\",\"requestId\":\"r-42\"}");

        assertEquals(1, calls.size());
        assertEquals("window.providerConfigResult", calls.get(0)[0]);
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertTrue(result.get("ok").getAsBoolean());
        assertEquals("r-42", result.get("requestId").getAsString());
        assertFalse("inbound payload must never be echoed",
                calls.get(0)[1].contains("sk-secret-input"));
    }

    @Test
    public void serviceFailureMapsToCanonicalErrorShape() {
        List<String[]> calls = new ArrayList<>();
        ProviderConfigHandler handler = new ProviderConfigHandler(
                recordingContext(calls),
                (settingsPath, projectSettingsPath, payloadJson) -> {
                    throw new Exception("node exploded with sk-secret-input inside");
                });

        handler.handleProviderConfigOp("{\"op\":\"setEnvKey\",\"key\":\"K\",\"value\":\"sk-secret-input\",\"requestId\":\"r-7\"}");

        assertEquals(1, calls.size());
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertFalse(result.get("ok").getAsBoolean());
        assertEquals("bridge_error", result.get("code").getAsString());
        assertNotNull(result.get("message").getAsString());
        assertEquals("r-7", result.get("requestId").getAsString());
    }

    @Test
    public void malformedResultStillProducesCanonicalShape() {
        List<String[]> calls = new ArrayList<>();
        ProviderConfigHandler handler = new ProviderConfigHandler(
                recordingContext(calls),
                (settingsPath, projectSettingsPath, payloadJson) -> "not-json-at-all");

        handler.handleGetProviderConfig();

        assertEquals(1, calls.size());
        JsonObject result = JsonParser.parseString(calls.get(0)[1]).getAsJsonObject();
        assertFalse(result.get("ok").getAsBoolean());
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
