package com.qwenmate.cli;

/**
 * Supported headless CLI tools shown in Settings → Provider Management → CLI.
 */
public enum CliToolId {
    QWEN("qwen", "Qwen Code", "qwen", null);

    private final String id;
    private final String displayName;
    private final String binaryName;
    private final String altBinaryName;

    CliToolId(String id, String displayName, String binaryName, String altBinaryName) {
        this.id = id;
        this.displayName = displayName;
        this.binaryName = binaryName;
        this.altBinaryName = altBinaryName;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getBinaryName() {
        return binaryName;
    }

    /**
     * Secondary command name to probe when the primary one is not found
     * (e.g. MiniMax Code: `minimax` from the official installer, `mcode` from npm).
     */
    public String getAltBinaryName() {
        return altBinaryName;
    }

    public static CliToolId fromId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String normalized = raw.trim().toLowerCase();
        for (CliToolId tool : values()) {
            if (tool.id.equals(normalized)) {
                return tool;
            }
        }
        return null;
    }
}
