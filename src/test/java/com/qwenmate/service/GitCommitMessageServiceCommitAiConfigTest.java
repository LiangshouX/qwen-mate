package com.qwenmate.service;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.qwenmate.service.commit.CommitMessageCallback;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vcs.LocalFilePath;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vcs.changes.Change;
import com.intellij.openapi.vcs.changes.ContentRevision;
import com.intellij.openapi.vcs.history.VcsRevisionNumber;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class GitCommitMessageServiceCommitAiConfigTest {

    @Test
    public void shouldReturnUnavailableErrorWhenNoCommitAiProviderIsResolved() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig(null, "qwen3-coder-plus", "alt-model"));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertNull(callback.success);
        assertNotNull(callback.error);
        assertNull(service.lastCliProvider);
    }

    @Test
    public void shouldRouteToResolvedQwenModel() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig("qwen", "qwen3-coder-plus", "alt-model"));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertEquals("qwen", service.lastCliProvider);
        assertEquals("qwen3-coder-plus", service.lastCliModel);
        assertEquals("fix: use cli routing", callback.success);
    }

    @Test
    public void shouldRouteToResolvedAlternateProviderModel() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig("alt", "qwen3-coder-plus", "alt-model"));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertEquals("alt", service.lastCliProvider);
        assertEquals("alt-model", service.lastCliModel);
        assertEquals("fix: use cli routing", callback.success);
    }

    @Test
    public void shouldRouteToResolvedGrokCliProvider() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(
                buildConfigWithModels("grok", "qwen3-coder-plus", "alt-model", "grok-4", null, null, null, null));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertEquals("grok", service.lastCliProvider);
        assertEquals("grok-4", service.lastCliModel);
        assertEquals("fix: use cli routing", callback.success);
    }

    @Test
    public void shouldRouteToResolvedKimiCliProvider() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(
                buildConfigWithModels("kimi", "qwen3-coder-plus", "alt-model", null, "kimi-k2", null, null, null));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertEquals("kimi", service.lastCliProvider);
        assertEquals("kimi-k2", service.lastCliModel);
        assertEquals("fix: use cli routing", callback.success);
    }

    @Test
    public void shouldRouteToResolvedOmpCliProvider() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(
                buildConfigWithModels("omp", "qwen3-coder-plus", "alt-model", null, null, null, null, "auto"));
        ResultCapture callback = new ResultCapture();

        service.generateCommitMessage(Collections.<Change>emptyList(), callback);

        assertEquals("omp", service.lastCliProvider);
        assertEquals("auto", service.lastCliModel);
        assertEquals("fix: use cli routing", callback.success);
    }

    @Test
    public void shouldIgnoreLineEndingOnlyDiffs() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig("qwen", "qwen3-coder-plus", "alt-model"));

        String diff = service.exposeGeneratedDiff(Collections.singletonList(
                modification("README.md", "line 1\r\nline 2\r\n", "line 1\nline 2\n")
        ));

        assertEquals("", diff);
    }

    @Test
    public void shouldKeepContentChangesWhenLineEndingsAlsoChange() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig("qwen", "qwen3-coder-plus", "alt-model"));

        String diff = service.exposeGeneratedDiff(Collections.singletonList(
                modification("README.md", "line 1\r\nold text\r\n", "line 1\nnew text\n")
        ));

        assertEquals("\n=== MODIFICATION: README.md ===\n- old text\n+ new text\n", diff);
    }

    @Test
    public void shouldKeepEarlierContentChangesWhenIgnoringLaterLineEndingOnlyDiff() {
        TestableGitCommitMessageService service = new TestableGitCommitMessageService(buildConfig("qwen", "qwen3-coder-plus", "alt-model"));

        String diff = service.exposeGeneratedDiff(Arrays.asList(
                modification("content.md", "old text\n", "new text\n"),
                modification("line-endings.md", "line 1\r\nline 2\r\n", "line 1\nline 2\n")
        ));

        assertEquals("\n=== MODIFICATION: content.md ===\n- old text\n+ new text\n", diff);
    }

    private static Change modification(String path, String before, String after) {
        FilePath filePath = new LocalFilePath(path, false);
        return new Change(revision(filePath, before), revision(filePath, after));
    }

    private static ContentRevision revision(FilePath filePath, String content) {
        return new ContentRevision() {
            @Override
            public String getContent() throws VcsException {
                return content;
            }

            @Override
            public FilePath getFile() {
                return filePath;
            }

            @Override
            public VcsRevisionNumber getRevisionNumber() {
                return VcsRevisionNumber.NULL;
            }
        };
    }

    private JsonObject buildConfig(String effectiveProvider, String qwenModel, String altModel) {
        return buildConfigWithModels(effectiveProvider, qwenModel, altModel, null, null, null, null, null);
    }

    private JsonObject buildConfigWithModels(
            String effectiveProvider,
            String qwenModel,
            String altModel,
            String grokModel,
            String kimiModel,
            String opencodeModel,
            String piModel,
            String ompModel
    ) {
        JsonObject config = new JsonObject();
        config.add("provider", JsonNull.INSTANCE);
        if (effectiveProvider == null) {
            config.add("effectiveProvider", JsonNull.INSTANCE);
        } else {
            config.addProperty("effectiveProvider", effectiveProvider);
        }
        config.addProperty("resolutionSource", effectiveProvider == null ? "unavailable" : "auto");

        JsonObject models = new JsonObject();
        models.addProperty("qwen", qwenModel);
        models.addProperty("alt", altModel);
        if (grokModel != null) models.addProperty("grok", grokModel);
        if (kimiModel != null) models.addProperty("kimi", kimiModel);
        if (opencodeModel != null) models.addProperty("opencode", opencodeModel);
        if (piModel != null) models.addProperty("pi", piModel);
        if (ompModel != null) models.addProperty("omp", ompModel);
        config.add("models", models);

        JsonObject availability = new JsonObject();
        availability.addProperty("qwen", true);
        availability.addProperty("alt", true);
        config.add("availability", availability);
        return config;
    }

    private static class ResultCapture implements CommitMessageCallback {
        private String success;
        private String error;

        @Override
        public void onSuccess(String commitMessage) {
            this.success = commitMessage;
        }

        @Override
        public void onError(String error) {
            this.error = error;
        }
    }

    private static class TestableGitCommitMessageService extends GitCommitMessageService {
        private final JsonObject config;
        private String lastCliProvider;
        private String lastCliModel;

        private TestableGitCommitMessageService(JsonObject config) {
            super((Project) null);
            this.config = config;
        }

        @Override
        protected String generateGitDiff(java.util.Collection<Change> changes) {
            return "diff";
        }

        @Override
        protected JsonObject getCommitAiConfig() {
            return config;
        }

        @Override
        protected void callProviderAPI(
                String prompt,
                String provider,
                String model,
                CommitMessageCallback callback
        ) {
            this.lastCliProvider = provider;
            this.lastCliModel = model;
            callback.onSuccess("fix: use cli routing");
        }

        private String exposeGeneratedDiff(java.util.Collection<Change> changes) {
            return super.generateGitDiff(changes);
        }
    }
}
