package com.qwenmate.skill;

import org.junit.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Static command table contract: the palette must cover the Qwen Code command
 * surface (not the Claude Code one) before the runtime list arrives.
 */
public class SlashCommandRegistryBuiltinTest {

    private static Set<String> builtinNames() {
        return SlashCommandRegistry.QWEN_BUILTIN.stream()
                .map(SlashCommandRegistry.SlashCommand::name)
                .collect(Collectors.toSet());
    }

    @Test
    public void builtinTableCoversQwenCodeCoreCommands() {
        Set<String> names = builtinNames();

        assertTrue("compaction command must be /compress", names.contains("/compress"));
        assertTrue(names.contains("/compress-fast"));
        assertTrue(names.contains("/help"));
        assertTrue(names.contains("/model"));
        assertTrue(names.contains("/summary"));
        assertTrue(names.contains("/mcp"));
    }

    @Test
    public void builtinTableDropsClaudeCodeOnlyCommands() {
        Set<String> names = builtinNames();

        assertFalse("/compact is Claude Code's compaction command", names.contains("/compact"));
        assertFalse(names.contains("/update-config"));
    }

    @Test
    public void guiHandledCommandsAreMarkedSoRuntimeCalibrationKeepsThem() {
        Set<String> names = SlashCommandRegistry.QWEN_BUILTIN.stream()
                .filter(cmd -> "gui".equals(cmd.source()))
                .map(SlashCommandRegistry.SlashCommand::name)
                .collect(Collectors.toSet());

        assertTrue(names.contains("/resume"));
        assertTrue(names.contains("/continue"));
        assertTrue(names.contains("/plan"));
        assertTrue(names.contains("/context"));
        assertTrue(names.contains("/clear"));
    }

    @Test
    public void builtinTableHasNoDuplicateNames() {
        assertEquals(SlashCommandRegistry.QWEN_BUILTIN.size(), builtinNames().size());
    }

    @Test
    public void everyBuiltinCommandHasNonBlankDescription() {
        List<SlashCommandRegistry.SlashCommand> blankDescriptions =
                SlashCommandRegistry.QWEN_BUILTIN.stream()
                        .filter(cmd -> cmd.description() == null || cmd.description().isBlank())
                        .toList();

        assertTrue("commands without a description: " + blankDescriptions, blankDescriptions.isEmpty());
    }
}
