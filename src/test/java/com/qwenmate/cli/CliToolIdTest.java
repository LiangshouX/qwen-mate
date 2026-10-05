package com.qwenmate.cli;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class CliToolIdTest {

    @Test
    public void fromId_acceptsKnownTools() {
        assertEquals(CliToolId.QWEN, CliToolId.fromId("qwen"));
        assertEquals(CliToolId.QWEN, CliToolId.fromId(" QWEN "));
    }

    @Test
    public void fromId_rejectsUnknown() {
        assertNull(CliToolId.fromId(null));
        assertNull(CliToolId.fromId(""));
        assertNull(CliToolId.fromId("legacy-cli"));
    }

    @Test
    public void binaryNames_matchExpected() {
        assertEquals("qwen", CliToolId.QWEN.getBinaryName());
        for (CliToolId tool : CliToolId.values()) {
            assertNotNull(tool.getDisplayName());
        }
    }
}
