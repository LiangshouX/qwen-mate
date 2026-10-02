package com.qwenmate.settings;

import com.qwenmate.util.PathUtils;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;

public class WorkingDirectoryManagerResolveTest {

    private WorkingDirectoryManager managerWithCustom(String projectPath, String customDir) {
        JsonObject config = new JsonObject();
        if (customDir != null) {
            JsonObject workingDirs = new JsonObject();
            workingDirs.addProperty(projectPath, customDir);
            config.add("workingDirectories", workingDirs);
        }
        return new WorkingDirectoryManager((ignored) -> config, (written) -> { });
    }

    @Test
    public void relativeDotDotResolvesToNormalizedParent() throws Exception {
        Path root = Files.createTempDirectory("wdm-root");
        Path child = Files.createDirectory(root.resolve("child"));

        WorkingDirectoryManager manager = managerWithCustom(child.toString(), "..");

        assertEquals(PathUtils.normalizeAbsolute(root.toString()),
                manager.resolveEffectiveWorkingDirectory(child.toString()));
    }

    @Test
    public void noCustomReturnsNormalizedProjectPath() throws Exception {
        Path root = Files.createTempDirectory("wdm-root");
        Path child = Files.createDirectory(root.resolve("child"));

        WorkingDirectoryManager manager = managerWithCustom(child.toString(), null);

        assertEquals(PathUtils.normalizeAbsolute(child.toString()),
                manager.resolveEffectiveWorkingDirectory(child.toString()));
    }

    @Test
    public void nonExistentCustomFallsBackToProjectPath() throws Exception {
        Path root = Files.createTempDirectory("wdm-root");
        Path child = Files.createDirectory(root.resolve("child"));

        WorkingDirectoryManager manager = managerWithCustom(child.toString(), "does-not-exist-xyz");

        assertEquals(PathUtils.normalizeAbsolute(child.toString()),
                manager.resolveEffectiveWorkingDirectory(child.toString()));
    }

    @Test
    public void absoluteExistingCustomIsReturnedNormalized() throws Exception {
        Path root = Files.createTempDirectory("wdm-root");
        Path child = Files.createDirectory(root.resolve("child"));
        Path other = Files.createTempDirectory("wdm-other");

        WorkingDirectoryManager manager = managerWithCustom(child.toString(), other.toString());

        String resolved = manager.resolveEffectiveWorkingDirectory(child.toString());
        assertEquals(PathUtils.normalizeAbsolute(other.toString()), resolved);
        // sanity: it really is the other dir, not the project path
        assertEquals(true, new File(resolved).exists());
    }
}
