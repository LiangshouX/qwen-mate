package com.qwenmate.skill;

import com.intellij.openapi.diagnostic.Logger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class AdditionalDirectoryResolver {

    private static final Logger LOG = Logger.getInstance(AdditionalDirectoryResolver.class);
    // Upper bound on upward directory traversal from cwd toward home.
    // 20 is generous enough for deeply nested workspaces while preventing runaway loops.
    private static final int MAX_UPWARD_TRAVERSAL_DEPTH = 20;

    private AdditionalDirectoryResolver() {
    }

    static List<SlashCommandRegistry.SkillScanDir> getSkillScanDirs(String cwd, String type, String userHome) {
        List<SlashCommandRegistry.SkillScanDir> dirs = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        if (cwd == null || cwd.isEmpty() || type == null || type.isEmpty()) {
            return dirs;
        }

        Path current;
        try {
            current = Paths.get(cwd).toAbsolutePath().normalize();
        } catch (Exception e) {
            LOG.debug("Invalid cwd for skill scanning: " + cwd);
            return dirs;
        }

        Path homePath = null;
        if (userHome != null && !userHome.isEmpty()) {
            try {
                homePath = Paths.get(userHome).toAbsolutePath().normalize();
            } catch (Exception e) {
                LOG.debug("Invalid user home path for skill scanning: " + userHome);
            }
        }

        if (homePath == null) {
            LOG.warn("Cannot determine home directory, skipping upward skill scan");
            return dirs;
        }

        Path fsRoot = current.getRoot();
        int depth = 0;

        while (current != null && !current.equals(fsRoot) && depth < MAX_UPWARD_TRAVERSAL_DEPTH) {
            Path candidate = current.resolve(".qwen").resolve(type);
            String normalizedCandidate = SlashCommandPathPolicy.normalizePath(candidate.toString());
            if (Files.isDirectory(candidate) && seen.add(normalizedCandidate)) {
                dirs.add(new SlashCommandRegistry.SkillScanDir(candidate.toString(), "project"));
            }

            if (current.equals(homePath)) {
                break;
            }

            current = current.getParent();
            depth++;
        }

        return dirs;
    }
}
