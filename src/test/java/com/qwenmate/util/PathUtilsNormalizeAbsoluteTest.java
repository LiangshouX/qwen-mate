package com.qwenmate.util;

import org.junit.Test;

import java.nio.file.Paths;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class PathUtilsNormalizeAbsoluteTest {

    @Test
    public void collapsesTrailingDotDot() {
        String base = Paths.get(System.getProperty("java.io.tmpdir")).toAbsolutePath().toString();
        String input = base + java.io.File.separator + "a" + java.io.File.separator + "b"
                + java.io.File.separator + "..";
        String expected = Paths.get(base, "a").toString();

        assertEquals(expected, PathUtils.normalizeAbsolute(input));
    }

    @Test
    public void nullReturnsNull() {
        assertNull(PathUtils.normalizeAbsolute(null));
    }

    @Test
    public void blankReturnsBlankUnchanged() {
        assertEquals("", PathUtils.normalizeAbsolute(""));
    }

    // ---- WSL UNC handling (OS-independent: pure string transform) ----
    // Regression guard: on Windows, feeding the forward-slash //wsl.localhost/... form that
    // IntelliJ's getBasePath() returns to Paths.get(...).toAbsolutePath() collapses the leading
    // "//" and resolves drive-relative (C:\wsl.localhost\...), which made history read/delete/export
    // key off the wrong ~/.qwen/projects/<key> directory. normalizeAbsolute must preserve it.

    @Test
    public void preservesWslForwardSlashUncRoot() {
        assertEquals("//wsl.localhost/Ubuntu/home/alice/proj",
                PathUtils.normalizeAbsolute("//wsl.localhost/Ubuntu/home/alice/proj"));
    }

    @Test
    public void normalizesWslBackslashUncToForwardSlash() {
        assertEquals("//wsl.localhost/Ubuntu/home/alice/proj",
                PathUtils.normalizeAbsolute("\\\\wsl.localhost\\Ubuntu\\home\\alice\\proj"));
    }

    @Test
    public void preservesWslDollarUncRoot() {
        assertEquals("//wsl$/Ubuntu/home/alice/proj",
                PathUtils.normalizeAbsolute("//wsl$/Ubuntu/home/alice/proj"));
    }

    @Test
    public void collapsesDotDotWithinWslUncButKeepsPrefix() {
        assertEquals("//wsl.localhost/Ubuntu/home/alice/y",
                PathUtils.normalizeAbsolute("//wsl.localhost/Ubuntu/home/alice/x/../y"));
    }
}
