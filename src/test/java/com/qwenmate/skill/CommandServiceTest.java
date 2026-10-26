package com.qwenmate.skill;

import com.google.gson.JsonObject;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Custom command scanning contract for the command management UI:
 * global (~/.qwen/commands) and project (.qwen/commands) files must surface
 * with their real path, scope and full frontmatter.
 */
public class CommandServiceTest {

    private Path home;
    private Path project;

    @Before
    public void setUp() throws IOException {
        Path root = Files.createTempDirectory("qwen-command-service");
        home = Files.createDirectories(root.resolve("home"));
        project = Files.createDirectories(root.resolve("project"));
    }

    private void writeCommand(Path commandsRoot, String relativePath, String name, String description) throws IOException {
        Path file = commandsRoot.resolve(relativePath);
        Files.createDirectories(file.getParent());
        Files.writeString(file, """
                ---
                name: %s
                description: %s
                argument-hint: <target>
                ---

                Prompt body.
                """.formatted(name, description), StandardCharsets.UTF_8);
    }

    @Test
    public void listsGlobalAndProjectCommandsWithFrontmatter() throws IOException {
        writeCommand(home.resolve(".qwen").resolve("commands"), "review.md", "review", "Review the code");
        writeCommand(project.resolve(".qwen").resolve("commands"), "git/commit.md", "commit", "Write a commit message");

        JsonObject result = CommandService.getAllCommands(project.toString(), home.toString());

        JsonObject global = result.getAsJsonObject("global");
        JsonObject local = result.getAsJsonObject("local");

        assertEquals(1, global.size());
        assertEquals(1, local.size());

        JsonObject globalCommand = global.getAsJsonObject(global.keySet().iterator().next());
        assertEquals("/review", globalCommand.get("name").getAsString());
        assertEquals("global", globalCommand.get("scope").getAsString());
        assertEquals("Review the code", globalCommand.get("description").getAsString());
        assertEquals("<target>", globalCommand.getAsJsonObject("frontmatter").get("argument-hint").getAsString());

        // Nested directory becomes a colon namespace
        JsonObject localCommand = local.getAsJsonObject(local.keySet().iterator().next());
        assertEquals("/git:commit", localCommand.get("name").getAsString());
        assertEquals("local", localCommand.get("scope").getAsString());
        assertTrue(localCommand.get("path").getAsString().endsWith("commit.md"));
    }

    @Test
    public void keepsCommandsWithoutFrontmatterAndSkipsHiddenEntries() throws IOException {
        Path commandsRoot = home.resolve(".qwen").resolve("commands");
        Files.createDirectories(commandsRoot);
        Files.writeString(commandsRoot.resolve("plain.md"), "No frontmatter here.", StandardCharsets.UTF_8);
        Files.writeString(commandsRoot.resolve(".hidden.md"), "hidden", StandardCharsets.UTF_8);

        JsonObject result = CommandService.getAllCommands(project.toString(), home.toString());
        JsonObject global = result.getAsJsonObject("global");

        assertEquals(1, global.size());
        JsonObject command = global.getAsJsonObject(global.keySet().iterator().next());
        assertEquals("/plain", command.get("name").getAsString());
        assertEquals("", command.get("description").getAsString());
        assertFalse(command.getAsJsonObject("frontmatter").has("description"));
    }
}
