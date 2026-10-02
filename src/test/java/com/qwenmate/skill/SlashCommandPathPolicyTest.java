package com.qwenmate.skill;

import org.junit.Test;

import java.nio.file.Path;
import java.util.List;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class SlashCommandPathPolicyTest {

    @Test
    public void matchesPathPatternsSupportsNestedPathMatchingAndRejectsDangerousGlobs() {
        Path currentFile = Path.of("/workspace/demo/src/main/App.java");

        assertTrue(SlashCommandPathPolicy.matchesPathPatterns(currentFile, List.of("src/**/*.java")));
        assertTrue(SlashCommandPathPolicy.matchesPathPatterns(currentFile, List.of("App.java")));
        assertFalse(SlashCommandPathPolicy.matchesPathPatterns(currentFile, List.of("**/**/**/**/**/App.java")));
        assertFalse(SlashCommandPathPolicy.matchesPathPatterns(currentFile, List.of("src/**/*.kt")));
    }
}
