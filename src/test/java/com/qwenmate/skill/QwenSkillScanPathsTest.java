package com.qwenmate.skill;

import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * Skill/command scan roots must discover the Qwen Code layout
 * (~/.qwen/skills, ~/.qwen/commands, project .qwen/*).
 */
public class QwenSkillScanPathsTest {

    private Path home;
    private Path project;

    @Before
    public void setUp() throws IOException {
        Path root = Files.createTempDirectory("qwen-skill-scan");
        home = Files.createDirectories(root.resolve("home"));
        project = Files.createDirectories(root.resolve("project"));
    }

    private void writeSkill(Path skillsRoot, String dirName) throws IOException {
        Path skillDir = Files.createDirectories(skillsRoot.resolve(dirName));
        Files.writeString(skillDir.resolve("SKILL.md"), """
                ---
                name: %s
                description: Test skill %s
                ---

                Body.
                """.formatted(dirName, dirName), StandardCharsets.UTF_8);
    }

    private void writeCommand(Path commandsRoot, String name) throws IOException {
        Files.createDirectories(commandsRoot);
        Files.writeString(commandsRoot.resolve(name + ".md"), """
                ---
                description: Test command %s
                ---

                Prompt body.
                """.formatted(name), StandardCharsets.UTF_8);
    }

    @Test
    public void projectScanDirsDiscoverQwenLayout() throws IOException {
        Path qwenSkills = Files.createDirectories(project.resolve(".qwen").resolve("skills"));

        List<SlashCommandRegistry.SkillScanDir> dirs =
                SlashCommandRegistry.getSkillScanDirs(project.toString(), "skills", home.toString());

        List<String> paths = dirs.stream().map(SlashCommandRegistry.SkillScanDir::path).toList();
        assertTrue(paths.contains(qwenSkills.toString()));
    }

    @Test
    public void projectScanDirsWalkUpwardForQwenLayout() throws IOException {
        Path nested = Files.createDirectories(project.resolve("a").resolve("b"));
        Path projectQwen = Files.createDirectories(project.resolve(".qwen").resolve("commands"));
        Files.createDirectories(home.resolve(".qwen").resolve("commands"));

        List<SlashCommandRegistry.SkillScanDir> dirs =
                SlashCommandRegistry.getSkillScanDirs(nested.toString(), "commands", home.toString());

        List<String> paths = dirs.stream().map(SlashCommandRegistry.SkillScanDir::path).toList();
        assertTrue(paths.contains(projectQwen.toString()));
    }

    @Test
    public void globalScanDirsCoverQwenLayout() {
        List<SlashCommandRegistry.SkillScanDir> cmdDirs =
                SlashCommandRegistry.getGlobalSkillScanDirs(home.toString(), "commands");
        assertEquals(1, cmdDirs.size());
        assertEquals(home.resolve(".qwen").resolve("commands").toString(), cmdDirs.get(0).path());

        List<SlashCommandRegistry.SkillScanDir> skillDirs =
                SlashCommandRegistry.getGlobalSkillScanDirs(home.toString(), "skills");
        assertEquals(1, skillDirs.size());
        assertEquals(home.resolve(".qwen").resolve("skills").toString(), skillDirs.get(0).path());
    }

    @Test
    public void getCommandsDiscoversQwenSkillsAndCommands() throws IOException {
        writeSkill(home.resolve(".qwen").resolve("skills"), "hello-world");
        writeCommand(home.resolve(".qwen").resolve("commands"), "deploy");
        writeSkill(project.resolve(".qwen").resolve("skills"), "proj-skill");
        writeCommand(project.resolve(".qwen").resolve("commands"), "proj-cmd");

        List<SlashCommandRegistry.SlashCommand> commands =
                SlashCommandRegistry.getCommands("qwen", project.toString(), null, home.toString());

        List<String> names = commands.stream().map(SlashCommandRegistry.SlashCommand::name).toList();
        assertTrue("user skill from ~/.qwen/skills", names.contains("/hello-world"));
        assertTrue("user command from ~/.qwen/commands", names.contains("/deploy"));
        assertTrue("project skill from <project>/.qwen/skills", names.contains("/proj-skill"));
        assertTrue("project command from <project>/.qwen/commands", names.contains("/proj-cmd"));
    }
}
