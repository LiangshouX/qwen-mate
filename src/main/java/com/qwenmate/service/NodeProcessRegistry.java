package com.qwenmate.service;

import com.qwenmate.provider.common.DaemonBridge;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.qwenmate.ui.toolwindow.QwenMateToolWindow;
import com.qwenmate.util.PlatformUtils;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.ui.content.Content;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * Project-scoped service that aggregates all Node.js subprocess data for the
 * Node Process Management panel.
 *
 * <p>Three data sources are unified:
 * <ol>
 *   <li><b>Daemon processes</b>: Qwen owns a long-lived {@code daemon.js}
 *       via {@link QwenSDKBridge#getCurrentDaemonBridgeForInspection()}.</li>
 *   <li><b>Per-channel processes</b>: tracked in each bridge's {@code ProcessManager}.</li>
 *   <li><b>Orphan processes</b>: discovered by scanning {@link ProcessHandle#allProcesses()}
 *       for {@code daemon.js} / {@code channel-manager.js} command lines that don't match
 *       any registered process — the root cause of "node piling up" user complaints.</li>
 * </ol>
 *
 * <p>The service is read-only with respect to process lifecycle (use {@link #killByPid} for
 * termination). It does not poll — callers invoke {@link #snapshot()} on demand.
 */
@Service(Service.Level.PROJECT)
public final class NodeProcessRegistry implements Disposable {

    private static final Logger LOG = Logger.getInstance(NodeProcessRegistry.class);

    /**
     * Substrings used to identify Node processes that look like ours.
     * Used by the orphan scanner; intentionally narrow to avoid false positives.
     */
    private static final String[] OWNED_PROCESS_HINTS = {
            "daemon.js",
            "channel-manager.js"
    };

    /**
     * Soft deadline for the {@code ProcessHandle.allProcesses()} sweep. On macOS /
     * Windows hosts with thousands of running processes the sweep can otherwise
     * take 100–500 ms per call — and the panel re-fetches on every menu open.
     * Past this budget we return the partial result and warn; missing a late-
     * arriving orphan is acceptable, blocking the user's menu is not.
     */
    private static final long ORPHAN_SCAN_BUDGET_MS = 500L;

    private final Project project;

    public NodeProcessRegistry(@NotNull Project project) {
        this.project = project;
    }

    public static NodeProcessRegistry getInstance(@NotNull Project project) {
        return project.getService(NodeProcessRegistry.class);
    }

    // ============================================================================
    // Snapshot
    // ============================================================================

    /**
     * Build a one-shot snapshot of all Node processes related to this project.
     * Safe to call from any thread; no I/O beyond {@link ProcessHandle} reads.
     *
     * @return list of process descriptors, never null
     */
    public List<NodeProcessInfo> snapshot() {
        long now = System.currentTimeMillis();
        List<NodeProcessInfo> result = new ArrayList<>();
        Set<Long> knownPids = new HashSet<>();

        Set<QwenMateChatWindow> windows = QwenMateToolWindow.getAllChatWindowsForProject(project);

        for (QwenMateChatWindow window : windows) {
            if (window == null) {
                continue;
            }
            String tabName = resolveTabName(window);
            String sessionId = safeGetSessionId(window);
            // Use the tab's *current* provider (what the user sees) rather than the
            // physical SDK type so the label always matches the active provider.
            String tabProvider = safeGetCurrentProvider(window);

            // -- DAEMON + CHANNEL entries from the Qwen bridge --
            QwenSDKBridge qwenBridge = safeQwenBridge(window);
            if (qwenBridge != null) {
                collectDaemonEntry(
                        result,
                        knownPids,
                        qwenBridge.getCurrentDaemonBridgeForInspection(),
                        tabProvider,
                        sessionId,
                        tabName,
                        now
                );

                // -- CHANNEL entries from qwenBridge.processManager --
                collectChannelEntries(
                        result,
                        knownPids,
                        qwenBridge.getProcessManager().getActiveChannelSnapshot(),
                        tabProvider,
                        sessionId,
                        tabName,
                        now
                );
            }
        }

        // -- ORPHAN scan --
        // Find Node processes that look like ours but don't appear in any registry.
        // CRITICAL: we MUST only consider processes whose parent PID is this JVM.
        // When multiple IDEs (e.g. IDEA + PyCharm) both run QwenMate, each instance's
        // daemons would otherwise show up in every other instance's panel — and
        // "Kill all orphans" would terminate live work in foreign IDEs. Each JVM
        // is responsible only for its own children.
        final long currentJvmPid;
        try {
            currentJvmPid = ProcessHandle.current().pid();
        } catch (Exception e) {
            LOG.warn("[NodeProcessRegistry] Cannot resolve current JVM PID, skipping orphan scan: "
                    + e.getMessage());
            return result;
        }

        final long scanDeadline = System.currentTimeMillis() + ORPHAN_SCAN_BUDGET_MS;
        // AtomicBoolean so the forEach lambda can mutate it (effectively-final restriction).
        // Checkstyle forbids single-element arrays for this purpose.
        final AtomicBoolean timedOut = new AtomicBoolean(false);
        try {
            ProcessHandle.allProcesses().forEach(handle -> {
                if (timedOut.get()) {
                    // Lambda return only skips the current element, but subsequent
                    // iterations will hit this guard within microseconds — cheaper
                    // than throwing or short-circuiting via takeWhile.
                    return;
                }
                if (System.currentTimeMillis() > scanDeadline) {
                    timedOut.set(true);
                    return;
                }
                long pid = handle.pid();
                if (knownPids.contains(pid)) {
                    return;
                }
                ProcessHandle.Info info = handle.info();
                String cmdLine = info.commandLine().orElse(null);
                String cmd = info.command().orElse(null);
                String fingerprint = cmdLine != null ? cmdLine : cmd;
                if (fingerprint == null) {
                    return;
                }
                if (!looksLikeOurProcess(fingerprint)) {
                    return;
                }

                // Ownership check: skip processes spawned by another JVM
                long parentPid = handle.parent().map(ProcessHandle::pid).orElse(-1L);
                if (!isOwnedByJvm(parentPid, currentJvmPid)) {
                    return;
                }

                long startedAt = info.startInstant().map(Instant::toEpochMilli).orElse(-1L);
                result.add(NodeProcessInfo.builder()
                        .kind(NodeProcessInfo.Kind.ORPHAN)
                        .provider(detectProviderFromCmd(fingerprint))
                        .pid(pid)
                        .alive(handle.isAlive())
                        .startedAtMs(startedAt)
                        .uptimeMs(startedAt > 0 ? Math.max(0, now - startedAt) : 0L)
                        .command(fingerprint)
                        .build());
            });
            if (timedOut.get()) {
                LOG.warn("[NodeProcessRegistry] Orphan scan exceeded " + ORPHAN_SCAN_BUDGET_MS
                        + "ms budget; returning partial results. Some orphans may not be listed.");
            }
        } catch (Exception e) {
            LOG.warn("[NodeProcessRegistry] Orphan scan failed: " + e.getMessage());
        }

        return result;
    }

    /**
     * Returns true when a process with the given parent PID was spawned by
     * THIS JVM and is therefore a valid orphan candidate for this instance.
     *
     * <p>Package-private so unit tests can pin the matrix:
     * <ul>
     *   <li>parent == currentJvmPid: ours (true)</li>
     *   <li>parent != currentJvmPid (another IDE instance): NOT ours (false)</li>
     *   <li>parent &lt;= 0 (parent died / unresolved): not safely attributable (false)</li>
     * </ul>
     */
    static boolean isOwnedByJvm(long parentPid, long currentJvmPid) {
        return parentPid > 0 && parentPid == currentJvmPid;
    }

    // ============================================================================
    // Process termination
    // ============================================================================

    /**
     * Terminate a process tree by PID. Uses the existing {@link PlatformUtils} helpers
     * for cross-platform correctness. Returns true when the kill command executed
     * successfully — does not guarantee the process is fully reaped yet.
     *
     * <p>Ownership guard: only PIDs that appear in this JVM's own {@link #snapshot()}
     * are eligible. Snapshot entries are either registry-tracked (daemon/channel) or
     * orphans that already passed the {@link #isOwnedByJvm} parent-PID check. Without
     * this guard a malformed or hostile frontend payload could ask us to terminate an
     * arbitrary process tree on the host (the PID arrives untrusted via
     * {@code NodeProcessHandler.handleKillNodeProcess}).
     */
    public boolean killByPid(long pid) {
        if (pid <= 0) {
            return false;
        }
        if (!isPidOwned(pid, snapshotPids())) {
            LOG.warn("[NodeProcessRegistry] Refusing to kill PID " + pid
                    + " — not tracked by this JVM's snapshot");
            return false;
        }
        return terminateTrackedPid(pid);
    }

    /** Collect the PID set of every process in the current snapshot. */
    private Set<Long> snapshotPids() {
        Set<Long> pids = new HashSet<>();
        for (NodeProcessInfo info : snapshot()) {
            pids.add(info.getPid());
        }
        return pids;
    }

    /**
     * Pure ownership predicate for the kill guard. Package-private so the
     * security-sensitive decision can be unit-tested without a live Project.
     */
    static boolean isPidOwned(long pid, Set<Long> ownedPids) {
        return pid > 0 && ownedPids != null && ownedPids.contains(pid);
    }

    /**
     * Unconditional kill — callers MUST have already established that {@code pid}
     * belongs to this JVM (via the {@link #killByPid} guard or a freshly built
     * snapshot in {@link #killAllOrphans}). Kept private to prevent new unguarded
     * termination entry points.
     */
    private boolean terminateTrackedPid(long pid) {
        LOG.info("[NodeProcessRegistry] Killing process tree for PID " + pid);
        return PlatformUtils.terminateProcessTree(pid);
    }

    /**
     * Restart the daemon associated with the first ChatWindow that owns the given PID.
     * If no window owns this daemon (e.g., it's an orphan), falls back to {@link #killByPid}.
     */
    public boolean restartDaemonByPid(long pid) {
        Set<QwenMateChatWindow> windows = QwenMateToolWindow.getAllChatWindowsForProject(project);
        for (QwenMateChatWindow window : windows) {
            QwenSDKBridge qwenBridge = safeQwenBridge(window);
            if (tryRestartDaemon(qwenBridge != null ? qwenBridge.getCurrentDaemonBridgeForInspection() : null,
                    qwenBridge != null ? qwenBridge::shutdownDaemon : null, pid)) {
                return true;
            }
        }
        // PID didn't match any tracked daemon — fall back to plain kill
        return killByPid(pid);
    }

    private boolean tryRestartDaemon(
            @Nullable DaemonBridge daemon,
            @Nullable Runnable shutdown,
            long pid
    ) {
        if (daemon == null || !daemon.isAlive() || shutdown == null) {
            return false;
        }
        Process p = daemon.getDaemonProcessForInspection();
        if (p == null || p.pid() != pid) {
            return false;
        }
        LOG.info("[NodeProcessRegistry] Restarting daemon for window PID=" + pid);
        shutdown.run();
        return true;
    }

    /**
     * Bulk kill every orphan reported in the current snapshot. Returns the number
     * of processes for which the kill command was successfully dispatched.
     */
    public int killAllOrphans() {
        int killed = 0;
        // Orphans in the snapshot already passed the isOwnedByJvm check, so kill
        // them directly — re-running killByPid would rebuild the snapshot per PID.
        for (NodeProcessInfo info : snapshot()) {
            if (info.getKind() == NodeProcessInfo.Kind.ORPHAN && terminateTrackedPid(info.getPid())) {
                killed++;
            }
        }
        return killed;
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    // Package-private for unit testing.
    static boolean looksLikeOurProcess(String fingerprint) {
        if (fingerprint == null) {
            return false;
        }
        String lower = fingerprint.toLowerCase();
        for (String hint : OWNED_PROCESS_HINTS) {
            if (lower.contains(hint.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    // Package-private for unit testing.
    //
    // Provider names are matched on word boundaries, not as bare substrings:
    // a coincidental path segment must not mislabel an unrelated process. `\b`
    // sits between [a-z0-9_] and anything else, so "qwen-agent" still matches
    // while "myqwen" does not.
    private static final Pattern QWEN_WORD = Pattern.compile("\\bqwen\\b");
    private static final Pattern DSH_WORD = Pattern.compile("\\bdsh\\b");

    static @Nullable String detectProviderFromCmd(String cmd) {
        if (cmd == null) {
            return null;
        }
        String lower = cmd.toLowerCase();
        if (lower.contains("channel-manager")) {
            if (DSH_WORD.matcher(lower).find()) {
                return "dsh";
            }
            if (QWEN_WORD.matcher(lower).find()) {
                return "qwen";
            }
        }
        if (lower.contains("daemon.js")) {
            return "qwen";
        }
        return null;
    }

    private static void collectDaemonEntry(
            List<NodeProcessInfo> result,
            Set<Long> knownPids,
            @Nullable DaemonBridge daemon,
            String tabProvider,
            @Nullable String sessionId,
            @Nullable String tabName,
            long now
    ) {
        if (daemon == null || !daemon.isAlive()) {
            return;
        }
        Process daemonProcess = daemon.getDaemonProcessForInspection();
        if (daemonProcess == null || !daemonProcess.isAlive()) {
            return;
        }
        long pid = daemonProcess.pid();
        knownPids.add(pid);
        ProcessHandle.Info info = safeInfo(daemonProcess);
        long startedAt = info != null
                ? info.startInstant().map(Instant::toEpochMilli).orElse(-1L)
                : -1L;
        result.add(NodeProcessInfo.builder()
                .kind(NodeProcessInfo.Kind.DAEMON)
                .provider(tabProvider)
                .pid(pid)
                .alive(true)
                .startedAtMs(startedAt)
                .uptimeMs(startedAt > 0 ? Math.max(0, now - startedAt) : 0L)
                .command(extractCommand(info))
                .activeRequestCount(daemon.getActiveRequestCount())
                .sessionId(sessionId)
                .tabName(tabName)
                .build());

        // Include daemon children (CLI stdio subprocesses) so they are not
        // listed as orphans and "Kill all orphans" does not tear down live ACP turns.
        try {
            daemonProcess.toHandle().descendants().forEach(child -> knownPids.add(child.pid()));
        } catch (Exception ignored) {
        }
    }

    private static void collectChannelEntries(
            List<NodeProcessInfo> result,
            Set<Long> knownPids,
            @Nullable Map<String, Process> channels,
            String tabProvider,
            @Nullable String sessionId,
            @Nullable String tabName,
            long now
    ) {
        if (channels == null || channels.isEmpty()) {
            return;
        }
        for (Map.Entry<String, Process> entry : channels.entrySet()) {
            Process p = entry.getValue();
            if (p == null || !p.isAlive()) {
                continue;
            }
            long pid = p.pid();
            knownPids.add(pid);
            // channel-manager children (e.g. one-shot agent stdio paths)
            try {
                p.toHandle().descendants().forEach(child -> knownPids.add(child.pid()));
            } catch (Exception ignored) {
            }
            ProcessHandle.Info info = safeInfo(p);
            long startedAt = info != null
                    ? info.startInstant().map(Instant::toEpochMilli).orElse(-1L)
                    : -1L;
            result.add(NodeProcessInfo.builder()
                    .kind(NodeProcessInfo.Kind.CHANNEL)
                    .provider(tabProvider)
                    .pid(pid)
                    .alive(true)
                    .startedAtMs(startedAt)
                    .uptimeMs(startedAt > 0 ? Math.max(0, now - startedAt) : 0L)
                    .command(extractCommand(info))
                    .channelId(entry.getKey())
                    .sessionId(sessionId)
                    .tabName(tabName)
                    .build());
        }
    }

    private static @Nullable ProcessHandle.Info safeInfo(Process p) {
        try {
            return p.toHandle().info();
        } catch (Exception e) {
            return null;
        }
    }

    private static @Nullable String extractCommand(@Nullable ProcessHandle.Info info) {
        if (info == null) {
            return null;
        }
        Optional<String> cmdLine = info.commandLine();
        if (cmdLine.isPresent()) {
            return cmdLine.get();
        }
        // Windows fallback: commandLine() may return empty for cross-owner processes
        return info.command().orElse(null);
    }

    private static @Nullable QwenSDKBridge safeQwenBridge(QwenMateChatWindow window) {
        try {
            return window != null ? window.getQwenSDKBridge() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static @Nullable String safeGetSessionId(QwenMateChatWindow window) {
        try {
            String sid = window != null ? window.getSessionId() : null;
            return (sid != null && !sid.isEmpty()) ? sid : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String safeGetCurrentProvider(QwenMateChatWindow window) {
        try {
            if (window == null) {
                return "qwen";
            }
            String provider = window.getCurrentProvider();
            return provider != null && !provider.isEmpty() ? provider : "qwen";
        } catch (Exception e) {
            return "qwen";
        }
    }

    private static @Nullable String resolveTabName(QwenMateChatWindow window) {
        try {
            if (window == null) {
                return null;
            }
            // Try parent content's display name first (e.g., "AI1", "AI2")
            Content content = window.getParentContent();
            if (content != null) {
                String displayName = content.getDisplayName();
                if (displayName != null && !displayName.isEmpty()) {
                    return displayName;
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void dispose() {
        // No long-lived resources — the registry is a pure aggregator.
        // Individual processes are owned by their respective bridges and disposed there.
    }
}
