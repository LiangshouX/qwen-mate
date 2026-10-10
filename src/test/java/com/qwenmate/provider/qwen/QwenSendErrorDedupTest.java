package com.qwenmate.provider.qwen;

import com.qwenmate.provider.common.MessageCallback;
import com.qwenmate.provider.common.SDKResult;
import com.qwenmate.session.CallbackHandler;
import com.qwenmate.session.QwenMateSession;
import com.qwenmate.session.QwenMessageHandler;
import com.qwenmate.session.SessionState;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * One send failure must surface as exactly one error bubble.
 *
 * The same failure reaches onError from three sources — the [SEND_ERROR] marker,
 * the Node {"success":false} envelope, and the daemon executor tail — each of which
 * used to append its own ERROR message ("连打三条"). Locks both layers: the bridge
 * stops re-reporting what [SEND_ERROR] already reported, and the handler collapses
 * any same-text repeat that still arrives.
 */
public class QwenSendErrorDedupTest {

    private static final String ERROR_TEXT =
            "The command \"/rename\" is not supported in this mode.";

    private static final class RecordingCallback implements MessageCallback {
        private final List<String> errors = new ArrayList<>();

        @Override
        public void onMessage(String type, String content) {
            // not under test
        }

        @Override
        public void onError(String error) {
            errors.add(error);
        }

        @Override
        public void onComplete(SDKResult result) {
            // not under test
        }
    }

    /** Feeds the marker lines in order through one shared hadSendError, like the daemon does. */
    private static RecordingCallback process(String... lines) {
        RecordingCallback callback = new RecordingCallback();
        QwenSDKBridge bridge = new QwenSDKBridge();
        AtomicBoolean hadSendError = new AtomicBoolean(false);
        AtomicReference<String> lastNodeError = new AtomicReference<>("");
        SDKResult result = new SDKResult();
        for (String line : lines) {
            bridge.processOutputLine(
                    line,
                    callback,
                    result,
                    new StringBuilder(),
                    hadSendError,
                    lastNodeError
            );
        }
        return callback;
    }

    /** [SEND_ERROR] marker line; Gson escapes the quotes inside the error text. */
    private static String sendErrorMarker(String errorText) {
        JsonObject payload = new JsonObject();
        payload.addProperty("error", errorText);
        return "[SEND_ERROR] " + payload;
    }

    /** The Node tail line: {"success":false,"error":...}. */
    private static String failureEnvelope(String errorText) {
        JsonObject payload = new JsonObject();
        payload.addProperty("success", false);
        payload.addProperty("error", errorText);
        return payload.toString();
    }

    @Test
    public void sendErrorMarkerPlusFailureEnvelopeReportsOnce() {
        // Real failing turn: [SEND_ERROR] first, then the {"success":false} tail.
        RecordingCallback callback = process(
                sendErrorMarker(ERROR_TEXT),
                failureEnvelope(ERROR_TEXT)
        );

        assertEquals(1, callback.errors.size());
        assertEquals(ERROR_TEXT, callback.errors.get(0));
    }

    @Test
    public void failureEnvelopeAloneStillReports() {
        // No marker (e.g. daemon-level failure) — the envelope must not be swallowed.
        RecordingCallback callback = process(failureEnvelope("daemon exploded"));

        assertEquals(1, callback.errors.size());
        assertEquals("daemon exploded", callback.errors.get(0));
    }

    @Test
    public void successEnvelopeNeverReports() {
        RecordingCallback callback = process(
                sendErrorMarker(ERROR_TEXT),
                "{\"success\":true,\"sessionId\":\"s-1\"}"
        );

        assertEquals(1, callback.errors.size());
    }

    @Test
    public void handlerCollapsesSameTextErrorRepeat() {
        SessionState state = new SessionState();
        QwenMessageHandler handler = new QwenMessageHandler(state, new CallbackHandler());

        handler.onError(ERROR_TEXT);
        handler.onError(ERROR_TEXT);
        handler.onError(ERROR_TEXT);

        long errorBubbles = state.getMessages().stream()
                .filter(m -> m.type == QwenMateSession.Message.Type.ERROR)
                .count();
        assertEquals("the three sources of one failure must render one bubble",
                1, errorBubbles);
    }

    @Test
    public void handlerKeepsDistinctErrors() {
        SessionState state = new SessionState();
        QwenMessageHandler handler = new QwenMessageHandler(state, new CallbackHandler());

        handler.onError("first failure");
        handler.onError("a different failure");

        long errorBubbles = state.getMessages().stream()
                .filter(m -> m.type == QwenMateSession.Message.Type.ERROR)
                .count();
        assertEquals(2, errorBubbles);
    }

    @Test
    public void handlerKeepsErrorAfterNonErrorMessage() {
        SessionState state = new SessionState();
        QwenMessageHandler handler = new QwenMessageHandler(state, new CallbackHandler());

        handler.onError(ERROR_TEXT);
        state.addMessage(new QwenMateSession.Message(QwenMateSession.Message.Type.USER, "next"));
        handler.onError(ERROR_TEXT);

        long errorBubbles = state.getMessages().stream()
                .filter(m -> m.type == QwenMateSession.Message.Type.ERROR)
                .count();
        // The repeat is no longer trailing — a real new failure, must render.
        assertEquals(2, errorBubbles);
        assertTrue(state.getError() != null);
    }
}
