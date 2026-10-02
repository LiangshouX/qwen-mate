package com.qwenmate;

import org.junit.Test;

import static org.junit.Assert.assertTrue;

public class LegacyToolWindowCompatibilityTest {

    @Test
    public void legacyToolWindowClassRemainsAssignableToCurrentImplementation() {
        assertTrue(
            com.qwenmate.ui.toolwindow.QwenMateToolWindow.class
                .isAssignableFrom(QwenMateToolWindow.class)
        );
    }
}
