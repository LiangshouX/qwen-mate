package com.qwenmate.skill;

import org.junit.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class AdditionalDirectoryResolverTest {

    @Test
    public void getSkillScanDirsWalksUpwardUntilHomeBoundary() throws IOException {
        Path root = Files.createTempDirectory("slash-command-scan-dirs");
        Path home = Files.createDirectories(root.resolve("home"));
        Path workspace = Files.createDirectories(home.resolve("workspace"));
        Path project = Files.createDirectories(workspace.resolve("project"));
        Path nested = Files.createDirectories(project.resolve("nested"));

        Files.createDirectories(home.resolve(".qwen").resolve("commands"));
        Files.createDirectories(project.resolve(".qwen").resolve("commands"));

        List<SlashCommandRegistry.SkillScanDir> dirs = AdditionalDirectoryResolver.getSkillScanDirs(
                nested.toString(),
                "commands",
                home.toString()
        );

        assertEquals(2, dirs.size());
        assertEquals(project.resolve(".qwen").resolve("commands").toString(), dirs.get(0).path());
        assertEquals(home.resolve(".qwen").resolve("commands").toString(), dirs.get(1).path());
    }
}
