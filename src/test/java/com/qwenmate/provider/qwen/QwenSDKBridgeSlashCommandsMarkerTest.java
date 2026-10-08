package com.qwenmate.provider.qwen;

import com.qwenmate.provider.common.MessageCallback;
import com.qwenmate.provider.common.SDKResult;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;

/**
 * The [SLASH_COMMANDS] marker emitted by ai-bridge must surface as a
 * "slash_commands" callback message so the palette can be calibrated.
 */
public class QwenSDKBridgeSlashCommandsMarkerTest {

    private static final class RecordingCallback implements MessageCallback {
        private final List<String[]> events = new ArrayList<>();

        @Override
        public void onMessage(String type, String content) {
            events.add(new String[] {type, content});
        }

        @Override
        public void onError(String error) {
            events.add(new String[] {"error", error});
        }

        @Override
        public void onComplete(SDKResult result) {
            events.add(new String[] {"complete", ""});
        }
    }

    private static List<String[]> process(String line) {
        RecordingCallback callback = new RecordingCallback();
        new QwenSDKBridge().processOutputLine(
                line,
                callback,
                new SDKResult(),
                new StringBuilder(),
                new AtomicBoolean(false),
                new AtomicReference<>("")
        );
        return callback.events;
    }

    @Test
    public void slashCommandsMarkerIsForwardedVerbatim() {
        List<String[]> events = process("[SLASH_COMMANDS] [\"compress\",\"help\"]");

        assertEquals(1, events.size());
        assertEquals("slash_commands", events.get(0)[0]);
        assertEquals("[\"compress\",\"help\"]", events.get(0)[1]);
    }

    @Test
    public void emptySlashCommandsMarkerIsDropped() {
        assertEquals(0, process("[SLASH_COMMANDS]   ").size());
    }
}
