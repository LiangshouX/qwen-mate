package com.qwenmate.ui.toolwindow;

import com.qwenmate.session.SessionState;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class QwenMateChatWindowSessionPreferencesTest {

    @Test
    public void shouldCopyProviderPreferencesWithoutConversationState() {
        SessionState source = new SessionState();
        source.setProvider("dsh");
        source.setModel("gpt-5.6-sol");
        source.setPermissionMode("plan");
        source.setReasoningEffort("xhigh");
        source.setSessionId("existing-session");
        source.setCwd("C:/source-project");

        SessionState target = new SessionState();
        target.setSessionId("new-session");
        target.setCwd("C:/target-project");

        QwenMateChatWindow.copySessionPreferences(source, target);

        assertEquals("dsh", target.getProvider());
        assertEquals("gpt-5.6-sol", target.getModel());
        assertEquals("plan", target.getPermissionMode());
        assertEquals("xhigh", target.getReasoningEffort());
        assertEquals("new-session", target.getSessionId());
        assertEquals("C:/target-project", target.getCwd());
    }

    @Test
    public void shouldClearOptionalPreferencesWhenSourceUsesDefaults() {
        SessionState source = new SessionState();
        source.setProvider("dsh");
        source.setModel(null);
        source.setReasoningEffort(null);

        SessionState target = new SessionState();
        target.setModel("stale-model");
        target.setReasoningEffort("high");

        QwenMateChatWindow.copySessionPreferences(source, target);

        assertNull(target.getModel());
        assertNull(target.getReasoningEffort());
    }
}
