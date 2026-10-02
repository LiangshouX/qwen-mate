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
                SessionSendService.resolveEffectivePermissionMode("qwen", "acceptEdits", "default")
        );
    }

    @Test
    public void resolveEffectivePermissionModeFallsBackToSessionModeAndKeepsQwenPlan() {
        // Qwen Code CLI natively supports plan mode (read-only analysis).
        assertEquals(
                "plan",
                SessionSendService.resolveEffectivePermissionMode("qwen", null, "plan")
        );
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode("qwen", null, null)
        );
    }

    @Test
    public void resolveEffectivePermissionModeDowngradesPlanForCliProviders() {
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode("dsh", "plan", "acceptEdits")
        );
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode("dsh", null, "plan")
        );
    }

    @Test
    public void resolveEffectivePermissionModeDowngradesNativeAutoForCliProvidersOnly() {
        // dsh has no SDK-native auto review flow, so auto downgrades to default.
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode("dsh", "auto", "acceptEdits")
        );
        assertEquals(
                "default",
                SessionSendService.resolveEffectivePermissionMode("dsh", null, "auto")
        );
        // qwen keeps the native auto reviewer: auto passes through untouched.
        assertEquals(
                "auto",
                SessionSendService.resolveEffectivePermissionMode("qwen", "auto", "default")
        );
        assertEquals(
                "auto",
                SessionSendService.resolveEffectivePermissionMode("qwen", null, "auto")
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
                SessionSendService.resolveEffectivePermissionMode("dsh", "bypassPermissions", "default")
        );
        assertEquals(
                "yolo",
                SessionSendService.resolveEffectivePermissionMode("dsh", null, "bypassPermissions")
        );
        assertEquals(
                "auto-edit",
                SessionSendService.resolveEffectivePermissionMode("dsh", "acceptEdits", null)
        );
    }

    @Test
    public void normalizeCliModelForProviderMapsSentinelsAndFiltersLeftovers() {
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", null));
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", "auto"));
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", "__config_default__"));
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", "dsh-default"));
        assertEquals("qwen3-coder-plus", SessionSendService.normalizeCliModelForProvider("dsh", "qwen3-coder-plus"));
        // Leftovers after a provider switch without model reset are ignored for CLI.
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", "claude-sonnet-4-6"));
        assertNull(SessionSendService.normalizeCliModelForProvider("dsh", "gpt-5-codex"));
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
