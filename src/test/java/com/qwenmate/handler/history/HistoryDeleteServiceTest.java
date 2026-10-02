package com.qwenmate.handler.history;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.session.QwenMateSession;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class HistoryDeleteServiceTest {

    @Test
    public void parseSessionIdsAcceptsArrayPayload() {
        assertEquals(
                Arrays.asList("session-one", "session-two"),
                HistoryDeleteService.parseSessionIds("[\"session-one\",\"session-two\"]"));
    }

    @Test
    public void parseSessionIdsAcceptsObjectPayload() {
        assertEquals(
                Arrays.asList("session-one", "session-two"),
                HistoryDeleteService.parseSessionIds("{\"sessionIds\":[\"session-one\",\"session-two\"]}"));
    }

    @Test
    public void parseSessionIdsTrimsAndDeduplicates() {
        assertEquals(
                Arrays.asList("session-one", "session-two"),
                HistoryDeleteService.parseSessionIds("[\" session-one \",\"session-two\",\"session-one\",\"\"]"));
    }

    @Test
    public void parseSessionIdsRejectsMissingPayload() {
        assertEquals(Collections.emptyList(), HistoryDeleteService.parseSessionIds(""));
        assertEquals(Collections.emptyList(), HistoryDeleteService.parseSessionIds(null));
    }

    @Test
    public void parseSessionIdsRejectsMalformedPayload() {
        assertEquals(Collections.emptyList(), HistoryDeleteService.parseSessionIds("["));
    }

    @Test
    public void quiescesOnlyTheMatchingProviderSessionBeforeDeletion() {
        RecordingQwenMateSession matching = new RecordingQwenMateSession("session-1", "dsh");
        HistoryDeleteService.quiesceActiveSessionForDeletion(
                matching, Collections.singleton("session-1"), "dsh").join();
        assertTrue(matching.interrupted);

        RecordingQwenMateSession otherSession = new RecordingQwenMateSession("session-2", "dsh");
        HistoryDeleteService.quiesceActiveSessionForDeletion(
                otherSession, Collections.singleton("session-1"), "dsh").join();
        assertFalse(otherSession.interrupted);

        RecordingQwenMateSession otherProvider = new RecordingQwenMateSession("session-1", "qwen");
        HistoryDeleteService.quiesceActiveSessionForDeletion(
                otherProvider, Collections.singleton("session-1"), "dsh").join();
        assertFalse(otherProvider.interrupted);
    }

    @Test
    public void failedQuiesceDoesNotStartDeletionContinuation() {
        RecordingQwenMateSession matching = new RecordingQwenMateSession("session-1", "dsh") {
            @Override
            public CompletableFuture<Void> interrupt() {
                CompletableFuture<Void> failed = new CompletableFuture<>();
                failed.completeExceptionally(new IllegalStateException("interrupt failed"));
                return failed;
            }
        };
        AtomicBoolean deletionStarted = new AtomicBoolean(false);

        CompletableFuture<Void> deletion = HistoryDeleteService.quiesceActiveSessionForDeletion(
                matching, Collections.singleton("session-1"), "dsh")
                .thenRun(() -> deletionStarted.set(true));

        try {
            deletion.join();
        } catch (CompletionException expected) {
            assertEquals("interrupt failed", expected.getCause().getMessage());
        }
        assertFalse(deletionStarted.get());
        assertTrue(deletion.isCompletedExceptionally());
    }

    @Test
    public void abortedDeletionReloadsHistoryAfterOptimisticFrontendRemoval() throws Exception {
        HandlerContext context = new HandlerContext(null, null, null, null);
        context.setSession(new RecordingQwenMateSession("session-1", "dsh") {
            @Override
            public CompletableFuture<Void> interrupt() {
                CompletableFuture<Void> failed = new CompletableFuture<>();
                failed.completeExceptionally(new IllegalStateException("interrupt failed"));
                return failed;
            }
        });
        RecordingHistoryLoadService historyLoadService = new RecordingHistoryLoadService(context);
        HistoryDeleteService service = new HistoryDeleteService(context, null, historyLoadService);

        service.handleDeleteSession("session-1", "dsh");

        assertTrue(historyLoadService.awaitReload());
        assertEquals("dsh", historyLoadService.provider);
    }

    private static class RecordingQwenMateSession extends QwenMateSession {
        private final String sessionId;
        private final String provider;
        private boolean interrupted;

        private RecordingQwenMateSession(String sessionId, String provider) {
            super(null, null, null);
            this.sessionId = sessionId;
            this.provider = provider;
        }

        @Override
        public String getSessionId() {
            return sessionId;
        }

        @Override
        public String getProvider() {
            return provider;
        }

        @Override
        public CompletableFuture<Void> interrupt() {
            interrupted = true;
            return CompletableFuture.completedFuture(null);
        }
    }

    private static class RecordingHistoryLoadService extends HistoryLoadService {
        private final CountDownLatch reloaded = new CountDownLatch(1);
        private String provider;

        private RecordingHistoryLoadService(HandlerContext context) {
            super(context, null);
        }

        @Override
        void handleLoadHistoryData(String provider) {
            this.provider = provider;
            reloaded.countDown();
        }

        private boolean awaitReload() throws InterruptedException {
            return reloaded.await(5, TimeUnit.SECONDS);
        }
    }
}
