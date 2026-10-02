package com.qwenmate.handler.history;

import com.qwenmate.handler.core.HandlerContext;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.project.Project;
import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class SubagentHistoryServiceStatusTest {

    @Test
    public void returnsEmptyStatusesWithRequestMetadata() throws Exception {
        CapturingJsCallback callback = new CapturingJsCallback();
        SubagentHistoryService service = new SubagentHistoryService(createContext(callback));

        JsonObject request = new JsonObject();
        request.addProperty("sessionId", "019fa70f-0653-73e2-a613-1fb0a9e83a2b");
        request.addProperty("provider", "qwen");
        request.addProperty("requestId", "019fa70f-0653-73e2-a613-1fb0a9e83a2b:1");
        JsonArray agents = new JsonArray();
        JsonObject agent = new JsonObject();
        agent.addProperty("toolUseId", "call-123");
        agents.add(agent);
        request.add("agents", agents);

        service.handleLoadSubagentStatuses(request.toString());

        assertTrue(callback.await());
        assertEquals("onSubagentStatusesLoaded", callback.functionName);
        JsonObject payload = decodePayload(callback.payload);
        assertEquals("019fa70f-0653-73e2-a613-1fb0a9e83a2b:1", payload.get("requestId").getAsString());
        assertTrue(payload.getAsJsonArray("statuses").isEmpty());
        assertTrue(payload.get("success").getAsBoolean());
        assertFalse(payload.has("messages"));
    }

    @Test
    public void returnsEmptyMessagesForRemovedProviderSubagentSession() throws Exception {
        CapturingJsCallback callback = new CapturingJsCallback();
        SubagentHistoryService service = new SubagentHistoryService(createContext(callback));

        JsonObject request = new JsonObject();
        request.addProperty("sessionId", "session-1");
        request.addProperty("provider", "qwen");
        request.addProperty("toolUseId", "call-123");
        request.addProperty("agentPath", "/root/audit_ui");

        service.handleLoadSubagentSession(request.toString());

        assertTrue(callback.await());
        assertEquals("onSubagentHistoryLoaded", callback.functionName);
        JsonObject payload = decodePayload(callback.payload);
        assertTrue(payload.getAsJsonArray("messages").isEmpty());
        assertTrue(payload.get("completed").getAsBoolean());
    }

    /**
     * The service hands JS-escaped JSON to the webview callback; decode it back
     * to a parseable JSON document before asserting on its fields.
     */
    private static JsonObject decodePayload(String escapedPayload) {
        return JsonParser.parseString(escapedPayload.replace("\\\"", "\"")).getAsJsonObject();
    }

    private static HandlerContext createContext(CapturingJsCallback callback) {
        Project project = (Project) Proxy.newProxyInstance(
                SubagentHistoryServiceStatusTest.class.getClassLoader(),
                new Class<?>[]{Project.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getBasePath" -> "D:\\Projects\\test";
                    case "getName" -> "test-project";
                    case "isDisposed" -> false;
                    case "toString" -> "test-project";
                    case "hashCode" -> 1;
                    case "equals" -> proxy == args[0];
                    default -> defaultValue(method.getReturnType());
                }
        );
        return new HandlerContext(project, null, null, callback);
    }

    private static Object defaultValue(Class<?> returnType) {
        if (!returnType.isPrimitive()) {
            return null;
        }
        if (boolean.class.equals(returnType)) {
            return false;
        }
        if (int.class.equals(returnType)) {
            return 0;
        }
        if (long.class.equals(returnType)) {
            return 0L;
        }
        if (double.class.equals(returnType)) {
            return 0D;
        }
        if (float.class.equals(returnType)) {
            return 0F;
        }
        if (short.class.equals(returnType)) {
            return (short) 0;
        }
        if (byte.class.equals(returnType)) {
            return (byte) 0;
        }
        if (char.class.equals(returnType)) {
            return (char) 0;
        }
        return null;
    }

    private static final class CapturingJsCallback implements HandlerContext.JsCallback {
        private final CountDownLatch latch = new CountDownLatch(1);
        private volatile String functionName;
        private volatile String payload;

        @Override
        public void callJavaScript(String name, String... args) {
            functionName = name;
            payload = args.length > 0 ? args[0] : "";
            latch.countDown();
        }

        @Override
        public String escapeJs(String str) {
            return str;
        }

        private boolean await() throws InterruptedException {
            return latch.await(5, TimeUnit.SECONDS);
        }
    }
}
