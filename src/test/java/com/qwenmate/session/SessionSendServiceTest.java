package com.qwenmate.session;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class SessionSendServiceTest {

    @Test
    public void normalizeRequestedPermissionModeRejectsBlankAndUnknownValues() {
        assertNull(SessionSendService.normalizeRequestedPermissionMode(null));
        assertNull(SessionSendService.normalizeRequestedPermissionMode(" "));
        assertNull(SessionSendService.normalizeRequestedPermissionMode("dangerouslyAllowEverything"));
        assertEquals("auto-edit", SessionSendService.normalizeRequestedPermissionMode("autoEdit"));
    }

    @Test
    public void resolveEffectivePermissionModePrefersRequestedModeWhenValid() {
        assertEquals(
                "auto-edit",
                SessionSendService.resolveEffectivePermissionMode("acceptEdits", "default")
        );
    }

    @Test
    public void resolveEffectivePermissionModeFallsBackToSessionModeAndKeepsQwenPlan() {
        // Qwen Code CLI natively supports plan mode (read-only analysis).
        assertEquals(
                "plan",
                SessionSendService.resolveEffectivePermissionMode(null, "plan")
        );
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode(null, null)
        );
    }

    @Test
    public void resolveEffectivePermissionModeKeepsNativeAuto() {
        // qwen keeps the native auto reviewer: auto passes through untouched.
        assertEquals(
                "auto",
                SessionSendService.resolveEffectivePermissionMode("auto", "default")
        );
        assertEquals(
                "auto",
                SessionSendService.resolveEffectivePermissionMode(null, "auto")
        );
    }

    @Test
    public void resolveEffectivePermissionModeMigratesBypassToYolo() {
        // Regression: UI "YOLO 模式" must survive resolution so the bridge can
        // pass it into the CLI auto-approve — otherwise every edit/tool still
        // pops the permission dialog under default mode. Legacy pre-QwenMate ids are
        // migrated to the Qwen Code CLI approval-mode ids.
        assertEquals(
                "yolo",
                SessionSendService.resolveEffectivePermissionMode("bypassPermissions", "default")
        );
        assertEquals(
                "yolo",
                SessionSendService.resolveEffectivePermissionMode(null, "bypassPermissions")
        );
        assertEquals(
                "auto-edit",
                SessionSendService.resolveEffectivePermissionMode("acceptEdits", null)
        );
    }

    @Test
    public void normalizeRequestedReasoningEffortRejectsBlankAndUnknownValues() {
        assertNull(SessionSendService.normalizeRequestedReasoningEffort(null));
        assertNull(SessionSendService.normalizeRequestedReasoningEffort(" "));
        assertNull(SessionSendService.normalizeRequestedReasoningEffort("extreme"));
        assertEquals("low", SessionSendService.normalizeRequestedReasoningEffort(" low "));
        assertEquals("xhigh", SessionSendService.normalizeRequestedReasoningEffort("xhigh"));
        assertEquals("max", SessionSendService.normalizeRequestedReasoningEffort("max"));
    }

    @Test
    public void newSessionStateDoesNotInjectDefaultReasoningEffort() {
        SessionState state = new SessionState();

        assertNull(state.getReasoningEffort());
    }
}
