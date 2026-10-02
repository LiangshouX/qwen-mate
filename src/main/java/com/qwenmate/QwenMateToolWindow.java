package com.qwenmate;

/**
 * Binary-compatibility shim for users upgrading from v0.3, where the tool window
 * factory lived in the root package. Keep the old class name loadable so cached
 * IDE metadata does not fail with ClassNotFoundException during upgrade.
 */
public class QwenMateToolWindow extends com.qwenmate.ui.toolwindow.QwenMateToolWindow {
}
