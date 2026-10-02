package com.qwenmate.session;

import com.qwenmate.permission.PermissionManager;
import com.qwenmate.permission.PermissionRequest;
import com.qwenmate.provider.common.MarkerCliBridge;
import org.junit.Test;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class QwenMateSessionTest {

    @Test
    public void setSessionInfoNotifiesSessionIdWhenRestoringHistorySession() {
        QwenMateSession session = new QwenMateSession(null, null, null);
        RecordingCallback callback = new RecordingCallback();
        session.setCallback(callback);

        session.setSessionInfo("history-session-123", "/workspace/demo");

        assertEquals("history-session-123", session.getSessionId());
        assertEquals("history-session-123", callback.lastSessionId);
        assertEquals("/workspace/demo", session.getCwd());
    }

    @Test
    public void hasNoTurnStartTimestampBeforeFirstSubmission() {
        QwenMateSession session = new QwenMateSession(null, null, null);

        assertEquals(0L, session.getLastTurnStartedAtMillis());
    }

    @Test
    public void interruptDoesNotResetAReplacementChannel() throws Exception {
        BlockingDshBridge bridge = new BlockingDshBridge(false);
        QwenMateSession session = new QwenMateSession(null, null, SessionProviderRouter.registerCliBridges(bridge));
        session.setProvider("dsh");
        session.getState().setChannelId("old-channel");
        session.getState().setBusy(true);
        session.getState().setLoading(true);

        CompletableFuture<Void> interrupt = session.interrupt();
        assertTrue(bridge.awaitInterrupt());
        session.getState().setChannelId("new-channel");
        session.getState().setError("new-channel-state");
        bridge.releaseInterrupt();
        interrupt.join();

        assertEquals("new-channel", session.getChannelId());
        assertTrue(session.isBusy());
        assertTrue(session.isLoading());
        assertEquals("new-channel-state", session.getError());
    }

    @Test(expected = CompletionException.class)
    public void interruptCompletesExceptionallyWhenProviderInterruptFails() {
        BlockingDshBridge bridge = new BlockingDshBridge(true);
        QwenMateSession session = new QwenMateSession(null, null, SessionProviderRouter.registerCliBridges(bridge));
        session.setProvider("dsh");
        session.getState().setChannelId("failing-channel");

        session.interrupt().join();
    }

    @Test
    public void nativeAutoKeepsResidualPermissionRequestsInteractive() {
        QwenMateSession session = new QwenMateSession(null, null, null);

        session.setPermissionMode("auto");
        assertEquals(PermissionManager.PermissionMode.DEFAULT, session.getPermissionManager().getPermissionMode());

        session.setPermissionMode("bypassPermissions");
        assertEquals(PermissionManager.PermissionMode.ALLOW_ALL, session.getPermissionManager().getPermissionMode());
    }

    private static class RecordingCallback implements QwenMateSession.SessionCallback {
        private String lastSessionId;

        @Override
        public void onMessageUpdate(List<QwenMateSession.Message> messages) {
        }

        @Override
        public void onStateChange(boolean busy, boolean loading, String error) {
        }

        @Override
        public void onSessionIdReceived(String sessionId) {
            this.lastSessionId = sessionId;
        }

        @Override
        public void onPermissionRequested(PermissionRequest request) {
        }

        @Override
        public void onThinkingStatusChanged(boolean isThinking) {
        }

        @Override
        public void onSlashCommandsReceived(List<String> slashCommands) {
        }

        @Override
        public void onNodeLog(String log) {
        }

        @Override
        public void onSummaryReceived(String summary) {
        }
    }

    private static class BlockingDshBridge extends MarkerCliBridge {
        private final CountDownLatch interruptStarted = new CountDownLatch(1);
        private final CountDownLatch interruptRelease = new CountDownLatch(1);
        private final boolean fail;

        private BlockingDshBridge(boolean fail) {
            super(BlockingDshBridge.class);
            this.fail = fail;
        }

        @Override
        protected String getProviderName() {
            return "dsh";
        }

        @Override
        protected String getStdinEnvKey() {
            return "DSH_USE_STDIN";
        }

        @Override
        public void interruptChannel(String channelId) {
            interruptStarted.countDown();
            if (fail) {
                throw new IllegalStateException("interrupt failed");
            }
            try {
                if (!interruptRelease.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("interrupt test timed out");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupt test interrupted", e);
            }
        }

        private boolean awaitInterrupt() throws InterruptedException {
            return interruptStarted.await(5, TimeUnit.SECONDS);
        }

        private void releaseInterrupt() {
            interruptRelease.countDown();
        }
    }
}
