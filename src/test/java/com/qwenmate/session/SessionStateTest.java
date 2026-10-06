package com.qwenmate.session;

import org.junit.Assert;
import org.junit.Test;

/**
 * Regression tests for model id normalization and defaults on session state writes.
 */
public class SessionStateTest {

    @Test
    public void setModelLeavesLiveModelsUntouched() {
        SessionState state = new SessionState();
        state.setModel("qwen3-max");
        Assert.assertEquals("qwen3-max", state.getModel());
        state.setModel("claude-fable-5-1[1m]");
        Assert.assertEquals("claude-fable-5-1[1m]", state.getModel());
    }

    @Test
    public void setModelLeavesOtherProviderAndUnknownIdsUntouched() {
        SessionState state = new SessionState();
        // Other providers' model IDs must pass through unchanged.
        state.setModel("gpt-5.6-sol");
        Assert.assertEquals("gpt-5.6-sol", state.getModel());
        state.setModel("qwen3.5-plus");
        Assert.assertEquals("qwen3.5-plus", state.getModel());
    }

    @Test
    public void setModelHandlesNullAndBlank() {
        SessionState state = new SessionState();
        state.setModel(null);
        Assert.assertNull(state.getModel());
        // Blank input is trimmed like every other normalizeRetiredModelId path.
        state.setModel("  ");
        Assert.assertEquals("", state.getModel());
    }

    @Test
    public void nativeAutoIsAValidPermissionMode() {
        SessionState state = new SessionState();
        state.setPermissionMode("auto");
        Assert.assertEquals("auto", state.getPermissionMode());
        Assert.assertTrue(SessionState.isValidPermissionMode("auto"));
    }

    @Test
    public void unknownPermissionModeDoesNotReplaceCurrentMode() {
        SessionState state = new SessionState();
        state.setPermissionMode("auto");
        state.setPermissionMode("automatic-but-unknown");
        Assert.assertEquals("auto", state.getPermissionMode());
    }

    @Test
    public void legacyAutoEditPermissionModeMigratesToAutoEdit() {
        SessionState state = new SessionState();
        state.setPermissionMode(" autoEdit ");
        Assert.assertEquals("auto-edit", state.getPermissionMode());
    }

    @Test
    public void legacyAcceptEditsAndBypassPermissionsMigrateToCliModes() {
        SessionState state = new SessionState();
        state.setPermissionMode("acceptEdits");
        Assert.assertEquals("auto-edit", state.getPermissionMode());
        state.setPermissionMode("bypassPermissions");
        Assert.assertEquals("yolo", state.getPermissionMode());
    }

    @Test
    public void defaultModelFollowsCliConfiguration() {
        SessionState state = new SessionState();
        Assert.assertEquals("", state.getModel());
    }
}
