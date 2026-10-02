package com.qwenmate.bridge;

import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.Assert.assertTrue;

public class BridgeArchiveLocatorTest {

    @Test
    public void classpathBuildDirectoryAddsAncestorSandboxPluginCandidates() throws Exception {
        Path sandboxRoot = Files.createTempDirectory("ccgui-sandbox");
        Path classpathDir = sandboxRoot.resolve("build/classes/java/main");
        Path pluginDir = sandboxRoot.resolve("build/idea-sandbox/IC-2024.3.1/plugins/idea-claude-code-gui");
        Files.createDirectories(classpathDir);
        Files.createDirectories(pluginDir);

        List<File> candidates = BridgeArchiveLocator.collectPluginDirCandidates(classpathDir.toFile());

        assertTrue(candidates.stream()
            .map(File::getAbsolutePath)
            .anyMatch(path -> path.equals(pluginDir.toFile().getAbsolutePath())));
    }

    @Test
    public void installedPluginDirectoryRemainsFirstCandidate() throws Exception {
        Path pluginDir = Files.createTempDirectory("idea-claude-code-gui");

        List<File> candidates = BridgeArchiveLocator.collectPluginDirCandidates(pluginDir.toFile());

        assertTrue(candidates.size() > 0);
        assertTrue(candidates.get(0).getAbsolutePath().equals(pluginDir.toFile().getAbsolutePath()));
    }

    @Test
    public void pluginDirCandidatesCoverCurrentAndLegacyDistributionNames() throws Exception {
        Path pluginsRoot = Files.createTempDirectory("ccgui-plugins");
        List<File> pluginDirs = new ArrayList<>();
        BridgePathLocator.addPluginDirCandidates(pluginDirs, pluginsRoot.toFile());

        Set<String> names = pluginDirs.stream().map(File::getName).collect(Collectors.toSet());
        // Regression: the distribution zip root must cover current and legacy names; after the
        // rename the fallback set only held stale names, so an installed plugin
        // was never found and the bridge resolution failed.
        assertTrue(names.contains("qwen-mate"));
        assertTrue(names.contains("qwenmate"));
        assertTrue(names.contains("qwen-code-gui"));
        assertTrue(names.contains("idea-claude-code-gui"));
        assertTrue(names.contains("com.qwenmate"));
    }
}
