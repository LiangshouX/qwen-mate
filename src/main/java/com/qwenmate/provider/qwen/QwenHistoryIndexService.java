package com.qwenmate.provider.qwen;

import com.qwenmate.cache.SessionIndexCache;
import com.qwenmate.cache.SessionIndexManager;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Session index management for qwen transcripts.
 *
 * <p>Mirrors the reference {@code ClaudeHistoryIndexService}: a per-project scan
 * backed by {@link SessionIndexManager} (durable index, mtime/size freshness) plus
 * {@link SessionIndexCache} (in-memory TTL cache) so the history panel does not
 * re-parse unchanged transcripts.</p>
 *
 * <p>Unlike the Claude lite reader, metadata always comes from a full transcript
 * parse (the same {@link QwenTranscriptParser} used for restore), so title, message
 * count and timestamps are exact — qwen transcripts carry many non-message
 * telemetry rows that make line counting unreliable.</p>
 */
class QwenHistoryIndexService {

    private static final Logger LOG = Logger.getInstance(QwenHistoryIndexService.class);

    /** Session files are UUID-named; anything else in the chats dir is skipped. */
    private static final Pattern SESSION_FILE_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.jsonl$");

    private final Path qwenHome;
    private final SessionIndexManager indexManager;

    QwenHistoryIndexService(Path qwenHome) {
        this(qwenHome, SessionIndexManager.getInstance());
    }

    /** Test seam: lets fixtures run against an isolated index directory. */
    QwenHistoryIndexService(Path qwenHome, SessionIndexManager indexManager) {
        this.qwenHome = qwenHome;
        this.indexManager = indexManager;
    }

    Path qwenHome() {
        return qwenHome;
    }

    /**
     * Read the session list of one project, using the durable index and the
     * in-memory cache whenever the transcripts are unchanged.
     *
     * @param projectPath the project working directory
     * @return session summaries sorted by newest activity first
     */
    List<QwenHistoryReader.SessionInfo> readProjectSessions(String projectPath) {
        if (projectPath == null || projectPath.isBlank()) {
            return List.of();
        }
        List<Path> chatsDirs = new ArrayList<>();
        for (String key : QwenHistoryReader.projectKeyCandidates(projectPath)) {
            Path chatsDir = qwenHome.resolve(QwenHistoryReader.PROJECTS_DIR).resolve(key).resolve(QwenHistoryReader.CHATS_DIR);
            if (Files.isDirectory(chatsDir) && !chatsDirs.contains(chatsDir)) {
                chatsDirs.add(chatsDir);
            }
        }
        if (chatsDirs.isEmpty()) {
            return List.of();
        }

        Path primaryChatsDir = chatsDirs.get(0);
        List<QwenHistoryReader.SessionInfo> cached =
                SessionIndexCache.getInstance().getQwenMateSessions(projectPath, primaryChatsDir);
        if (cached != null) {
            return cached;
        }

        Map<String, QwenHistoryReader.SessionInfo> bySessionId = new LinkedHashMap<>();
        SessionIndexManager.ProjectIndex projectIndex = indexManager.readClaudeIndex().projects.get(projectPath);
        SessionIndexManager.UpdateType updateType = indexManager.getUpdateType(projectIndex, primaryChatsDir);

        List<SessionIndexManager.SessionIndexEntry> refreshedEntries = new ArrayList<>();
        for (int dirIndex = 0; dirIndex < chatsDirs.size(); dirIndex++) {
            Path chatsDir = chatsDirs.get(dirIndex);
            boolean indexed = dirIndex == 0;
            Map<String, SessionIndexManager.SessionIndexEntry> existingById =
                    indexed && projectIndex != null ? indexEntriesById(projectIndex) : Map.of();

            for (Path file : listSessionFiles(chatsDir)) {
                String sessionId = sessionIdOf(file);
                if (sessionId == null) {
                    continue;
                }
                BasicFileAttributes attrs = readAttributes(file);
                SessionIndexManager.SessionIndexEntry existing = existingById.get(sessionId);
                boolean reusable = indexed
                        && updateType != SessionIndexManager.UpdateType.FULL
                        && existing != null
                        && attrs != null
                        && existing.fileLastModified == attrs.lastModifiedTime().toMillis()
                        && existing.fileSize == attrs.size()
                        && existing.entrypoint != null
                        && existing.model != null;
                if (reusable) {
                    refreshedEntries.add(existing);
                    bySessionId.putIfAbsent(sessionId, toSessionInfo(existing, attrs));
                    continue;
                }
                SessionIndexManager.SessionIndexEntry entry = indexSession(file, sessionId, attrs);
                if (indexed && entry != null) {
                    refreshedEntries.add(entry);
                }
                if (entry != null) {
                    bySessionId.putIfAbsent(sessionId, toSessionInfo(entry, attrs));
                }
            }
        }

        if (updateType != SessionIndexManager.UpdateType.NONE) {
            SessionIndexManager.ProjectIndex refreshed = new SessionIndexManager.ProjectIndex();
            // Match SessionIndexManager.getUpdateType's own file count (all *.jsonl,
            // including non-session files) so unchanged projects report UpdateType.NONE.
            refreshed.fileCount = countJsonlFiles(primaryChatsDir);
            refreshed.lastDirScanTime = System.currentTimeMillis();
            refreshed.sessions = refreshedEntries;
            indexManager.saveClaudeProjectIndex(projectPath, refreshed);
        }

        List<QwenHistoryReader.SessionInfo> sessions = new ArrayList<>(bySessionId.values());
        sessions.sort(Comparator.comparingLong((QwenHistoryReader.SessionInfo info) -> info.lastTimestamp).reversed());
        SessionIndexCache.getInstance().updateClaudeCache(projectPath, primaryChatsDir, sessions);
        LOG.info("[QwenHistoryIndexService] Project " + projectPath + ": " + sessions.size()
                + " sessions (updateType=" + updateType + ")");
        return sessions;
    }

    /**
     * Parse one transcript into an index entry. Returns null (and logs) for
     * unreadable files so a single corrupt session cannot break the panel;
     * sessions without any renderable message are skipped entirely.
     */
    private SessionIndexManager.SessionIndexEntry indexSession(Path file, String sessionId, BasicFileAttributes attrs) {
        try {
            QwenTranscriptParser.ParsedSession session = QwenTranscriptParser.parse(file);
            if (session.messages.isEmpty()) {
                return null;
            }
            long fileSize = attrs != null ? attrs.size() : fileSizeOf(file);
            long fileLastModified = attrs != null ? attrs.lastModifiedTime().toMillis() : 0L;
            long lastTimestamp = session.lastTimestamp > 0 ? session.lastTimestamp : fileLastModified;
            SessionIndexManager.SessionIndexEntry entry = SessionIndexManager.createEntry(
                    sessionId,
                    session.title,
                    session.messages.size(),
                    lastTimestamp,
                    session.firstTimestamp,
                    fileSize,
                    fileLastModified,
                    session.cwd,
                    session.entrypoint);
            // "" records "extracted but absent" (same convention as entrypoint) so the
            // incremental scan does not re-parse model-less transcripts forever.
            entry.model = session.model != null ? session.model : "";
            return entry;
        } catch (Exception e) {
            LOG.warn("[QwenHistoryIndexService] Failed to index session " + sessionId + ": " + e.getMessage());
            return null;
        }
    }

    private static QwenHistoryReader.SessionInfo toSessionInfo(
            SessionIndexManager.SessionIndexEntry entry,
            BasicFileAttributes attrs
    ) {
        QwenHistoryReader.SessionInfo info = new QwenHistoryReader.SessionInfo();
        info.sessionId = entry.sessionId;
        info.title = entry.title;
        info.messageCount = entry.messageCount;
        info.lastTimestamp = entry.lastTimestamp;
        info.firstTimestamp = entry.firstTimestamp;
        info.cwd = entry.cwd;
        info.fileSize = entry.fileSize > 0
                ? entry.fileSize
                : (attrs != null ? attrs.size() : 0L);
        info.model = entry.model == null || entry.model.isEmpty() ? null : entry.model;
        info.entrypoint = entry.entrypoint != null ? entry.entrypoint : "";
        return info;
    }

    private static Map<String, SessionIndexManager.SessionIndexEntry> indexEntriesById(
            SessionIndexManager.ProjectIndex projectIndex
    ) {
        Map<String, SessionIndexManager.SessionIndexEntry> byId = new HashMap<>();
        if (projectIndex == null || projectIndex.sessions == null) {
            return byId;
        }
        for (SessionIndexManager.SessionIndexEntry entry : projectIndex.sessions) {
            if (entry != null && entry.sessionId != null) {
                byId.put(entry.sessionId, entry);
            }
        }
        return byId;
    }

    private static List<Path> listSessionFiles(Path chatsDir) {
        List<Path> files = new ArrayList<>();
        if (chatsDir == null || !Files.isDirectory(chatsDir)) {
            return files;
        }
        try (Stream<Path> stream = Files.list(chatsDir)) {
            stream.filter(Files::isRegularFile)
                    .filter(path -> SESSION_FILE_PATTERN.matcher(fileName(path)).matches())
                    .forEach(files::add);
        } catch (IOException e) {
            LOG.warn("[QwenHistoryIndexService] Failed to list " + chatsDir + ": " + e.getMessage());
        }
        files.sort(Comparator.comparingLong(QwenHistoryIndexService::lastModifiedOf).reversed());
        return files;
    }

    /** Every regular *.jsonl file in the chats dir (including non-session files). */
    private static int countJsonlFiles(Path chatsDir) {
        if (chatsDir == null || !Files.isDirectory(chatsDir)) {
            return 0;
        }
        try (Stream<Path> stream = Files.list(chatsDir)) {
            return (int) stream.filter(Files::isRegularFile)
                    .filter(path -> fileName(path).endsWith(".jsonl"))
                    .count();
        } catch (IOException e) {
            LOG.warn("[QwenHistoryIndexService] Failed to count " + chatsDir + ": " + e.getMessage());
            return 0;
        }
    }

    private static String sessionIdOf(Path file) {
        String name = fileName(file);
        if (!SESSION_FILE_PATTERN.matcher(name).matches()) {
            return null;
        }
        return name.substring(0, name.length() - ".jsonl".length());
    }

    private static String fileName(Path path) {
        Path name = path.getFileName();
        return name != null ? name.toString() : "";
    }

    private static BasicFileAttributes readAttributes(Path file) {
        try {
            return Files.readAttributes(file, BasicFileAttributes.class);
        } catch (IOException e) {
            return null;
        }
    }

    private static long lastModifiedOf(Path file) {
        try {
            return Files.getLastModifiedTime(file).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    private static long fileSizeOf(Path file) {
        try {
            return Files.size(file);
        } catch (IOException e) {
            return 0L;
        }
    }
}
