package com.qwenmate.skill;

import com.intellij.openapi.diagnostic.Logger;

import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Pattern;

final class SlashCommandPathPolicy {

    private static final Logger LOG = Logger.getInstance(SlashCommandPathPolicy.class);
    private static final int MAX_GLOB_PATTERN_LENGTH = 256;
    private static final Pattern DANGEROUS_GLOB = Pattern.compile("(\\*\\*/){5,}");

    private SlashCommandPathPolicy() {
    }

    static boolean matchesPathPatterns(Path currentFile, List<String> patterns) {
        if (patterns == null || patterns.isEmpty()) {
            return true;
        }
        if (currentFile == null) {
            return false;
        }

        String normalized = currentFile.toString().replace('\\', '/');
        for (String pattern : patterns) {
            if (pattern == null || pattern.trim().isEmpty()) {
                continue;
            }

            String trimmed = pattern.trim();
            if (trimmed.length() > MAX_GLOB_PATTERN_LENGTH) {
                LOG.debug("Pattern too long, skip: " + trimmed.substring(0, 50) + "...");
                continue;
            }

            String patternBody = trimmed.startsWith("glob:") ? trimmed.substring(5) : trimmed;
            if (DANGEROUS_GLOB.matcher(patternBody).find()) {
                LOG.debug("Pattern too complex, skip: " + trimmed);
                continue;
            }

            String candidatePattern = trimmed.startsWith("glob:") ? trimmed : "glob:" + trimmed;

            try {
                PathMatcher matcher = Paths.get("").getFileSystem().getPathMatcher(candidatePattern);
                Path currentPath = Paths.get(normalized);
                if (matcher.matches(currentPath)) {
                    return true;
                }

                Path fileName = currentFile.getFileName();
                if (fileName != null && matcher.matches(fileName)) {
                    return true;
                }

                for (int i = 0; i < currentPath.getNameCount(); i++) {
                    if (matcher.matches(currentPath.subpath(i, currentPath.getNameCount()))) {
                        return true;
                    }
                }
            } catch (Exception e) {
                LOG.debug("Invalid path pattern, skip: " + trimmed);
            }
        }

        return false;
    }

    static String normalizePath(String path) {
        if (path == null || path.isEmpty()) {
            return path;
        }
        try {
            return Paths.get(path).toAbsolutePath().normalize().toString();
        } catch (Exception e) {
            return path;
        }
    }

    static Path toNormalizedPath(String path) {
        if (path == null || path.isEmpty()) {
            return null;
        }
        try {
            return Paths.get(path).toAbsolutePath().normalize();
        } catch (Exception e) {
            return null;
        }
    }
}
