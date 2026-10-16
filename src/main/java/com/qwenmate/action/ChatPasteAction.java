package com.qwenmate.action;

import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.qwenmate.util.PlatformUtils;
import com.google.gson.Gson;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.RenderingHints;
import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;

/**
 * IDEA Action for Ctrl+V in the QwenMate chat tool window.
 * Reads system clipboard and inserts text at the cursor in the focused element,
 * supporting contenteditable divs, input fields, and textareas.
 *
 * <p>Performance contract (2026-10-15 paste-freeze fix): nothing heavier than a
 * flavor probe runs on the EDT — clipboard image reads, file IO, PNG encoding
 * and preview generation all run on a pooled thread, and the webview only ever
 * receives a ≤512px JPEG preview instead of the full-resolution base64 that
 * previously froze the page on large pastes. The send side never uses the
 * preview: screenshots are persisted to the attachment dir here (referenced by
 * sourcePath), Explorer files are referenced by their original path, so the
 * model always reads the full-resolution original from disk. Only when preview
 * generation is impossible (formats ImageIO cannot decode, e.g. webp) does the
 * action fall back to the legacy full-base64 dispatch, still carrying
 * sourcePath so sends stay disk-backed.</p>
 */
public class ChatPasteAction extends ChatToolWindowAction {

    private static final Logger LOG = Logger.getInstance(ChatPasteAction.class);
    private static final Gson GSON = new Gson();

    /** Aligns with the CLI's 10MB inline media gate; larger files stay @path chips. */
    private static final long MAX_INLINE_IMAGE_FILE_BYTES = 10L * 1024 * 1024;

    /** Longest preview edge in pixels; matches the webview thumbnail budget. */
    private static final int PREVIEW_MAX_DIM = 512;

    private static final float PREVIEW_JPEG_QUALITY = 0.7f;

    /** Keeps Java-written screenshots bounded, mirroring ai-bridge's LRU cap. */
    private static final int MAX_KEPT_FILES = 100;

    @Override
    protected void performAction(@NotNull AnActionEvent e, @NotNull Project project, @NotNull QwenMateChatWindow chatWindow) {
        try {
            Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
            String text = "";
            if (clipboard.isDataFlavorAvailable(DataFlavor.stringFlavor)) {
                text = (String) clipboard.getData(DataFlavor.stringFlavor);
                if (text == null) {
                    text = "";
                }
            }
            if (text.isEmpty()) {
                // Flavor probes are cheap; every read/encode/write below moves to a
                // pooled thread so a multi-megabyte screenshot or file never stalls
                // the EDT (the 2026-10-15 paste-freeze regression).
                boolean hasFileList;
                boolean hasImage;
                try {
                    hasFileList = clipboard.isDataFlavorAvailable(DataFlavor.javaFileListFlavor);
                    hasImage = !hasFileList && clipboard.isDataFlavorAvailable(DataFlavor.imageFlavor);
                } catch (Exception ex) {
                    LOG.warn("Failed to probe clipboard flavors", ex);
                    return;
                }
                if (hasFileList) {
                    final Clipboard cb = clipboard;
                    ApplicationManager.getApplication().executeOnPooledThread(
                            () -> dispatchFilePaste(cb, chatWindow));
                } else if (hasImage) {
                    final Clipboard cb = clipboard;
                    ApplicationManager.getApplication().executeOnPooledThread(
                            () -> dispatchBitmapPaste(cb, chatWindow));
                }
                return;
            }

            // Use Gson JSON encoding to safely embed clipboard text, preventing JS injection
            String jsonEncoded = GSON.toJson(text);
            chatWindow.executeJavaScriptCode(
                "(function(){" +
                "  var txt=" + jsonEncoded + ";" +
                "  var el=document.activeElement;" +
                "  if(el&&el.getAttribute('contenteditable')==='true'){" +
                "    document.execCommand('insertText',false,txt);" +
                "  } else if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')){" +
                "    var s=el.selectionStart,e=el.selectionEnd;" +
                "    el.setRangeText(txt,s,e,'end');" +
                "    el.dispatchEvent(new Event('input',{bubbles:true}));" +
                "  } else if(window.onClipboardRead){" +
                "    var cb=window.onClipboardRead;" +
                "    window.onClipboardRead=undefined;" +
                "    cb(txt);" +
                "  }" +
                "})()"
            );
        } catch (Exception ex) {
            LOG.warn("Failed to read clipboard for paste action", ex);
        }
    }

    /**
     * Clipboard file-list paste on a background thread: image files become a
     * preview + sourcePath attachment, everything else degrades to an @path chip.
     */
    private static void dispatchFilePaste(Clipboard clipboard, QwenMateChatWindow chatWindow) {
        try {
            Object data = clipboard.getData(DataFlavor.javaFileListFlavor);
            if (!(data instanceof List<?> list) || list.isEmpty()) {
                return;
            }
            if (!(list.get(0) instanceof File file)) {
                return;
            }
            String mediaType = imageMediaTypeFor(file.getName());
            if (mediaType != null && dispatchImageFileAsAttachment(chatWindow, file, mediaType)) {
                return;
            }
            dispatchFilePathReference(chatWindow, file);
        } catch (Exception ex) {
            LOG.warn("Failed to read clipboard file list", ex);
        }
    }

    /**
     * Clipboard bitmap paste on a background thread: the full PNG is persisted
     * to the attachment dir (the send references it via sourcePath) and only a
     * small JPEG preview crosses the JS bridge.
     */
    private static void dispatchBitmapPaste(Clipboard clipboard, QwenMateChatWindow chatWindow) {
        try {
            Object data = clipboard.getData(DataFlavor.imageFlavor);
            if (!(data instanceof Image raw)) {
                return;
            }
            BufferedImage image = toBuffered(raw);
            if (image == null) {
                return;
            }
            Path persisted = persistScreenshot(image);
            String preview = previewJpegBase64(image);
            if (persisted != null && preview != null) {
                dispatchAttachmentEvent(chatWindow, preview, "image/jpeg",
                        persisted.getFileName().toString(), persisted.toString());
                return;
            }
            // Persist/preview failure: fall back to the legacy full-base64 path
            // so the paste still works (sourcePath stays null in this branch).
            try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                ImageIO.write(image, "png", baos);
                String base64 = Base64.getEncoder().encodeToString(baos.toByteArray());
                dispatchAttachmentEvent(chatWindow, base64, "image/png",
                        "pasted-image-" + System.currentTimeMillis() + ".png", null);
            }
        } catch (Exception ex) {
            LOG.warn("Failed to dispatch bitmap paste", ex);
        }
    }

    /**
     * Dispatch an image file as a preview attachment. Returns false (caller
     * falls back to an @path chip) when the file is missing/oversized or the
     * legacy full-base64 dispatch fails too.
     */
    private static boolean dispatchImageFileAsAttachment(QwenMateChatWindow chatWindow, File file, String mediaType) {
        if (!file.isFile() || file.length() > MAX_INLINE_IMAGE_FILE_BYTES) {
            return false;
        }
        try {
            BufferedImage decoded = ImageIO.read(file);
            if (decoded != null) {
                String preview = previewJpegBase64(decoded);
                if (preview != null) {
                    dispatchAttachmentEvent(chatWindow, preview, "image/jpeg",
                            file.getName(), file.getAbsolutePath());
                    return true;
                }
            }
            // Preview impossible (webp and other ImageIO-unsupported formats):
            // legacy full-base64 dispatch keeps the thumbnail working; sends
            // still read the original from disk via sourcePath.
            byte[] bytes = Files.readAllBytes(file.toPath());
            String base64 = Base64.getEncoder().encodeToString(bytes);
            dispatchAttachmentEvent(chatWindow, base64, mediaType,
                    file.getName(), file.getAbsolutePath());
            return true;
        } catch (Exception ex) {
            LOG.warn("Failed to read image file for paste: " + file.getAbsolutePath(), ex);
            return false;
        }
    }

    /** Enqueue the java-paste-image event (queue drain runs on the EDT). */
    private static void dispatchAttachmentEvent(
            QwenMateChatWindow chatWindow, String base64, String mediaType, String fileName, String sourcePath) {
        String jsonBase64 = GSON.toJson(base64);
        String jsonFileName = GSON.toJson(fileName);
        String jsonMedia = GSON.toJson(mediaType);
        String jsonPath = GSON.toJson(sourcePath);
        chatWindow.executeJavaScriptCode(
                "(function(){" +
                "  window.dispatchEvent(new CustomEvent('java-paste-image',{detail:{" +
                "    base64:" + jsonBase64 + ",mediaType:" + jsonMedia +
                ",fileName:" + jsonFileName + ",sourcePath:" + jsonPath +
                "}}));" +
                "})()"
        );
    }

    /** Enqueue an @path chip insertion for non-image / oversized files. */
    private static void dispatchFilePathReference(QwenMateChatWindow chatWindow, File file) {
        String jsonPath = GSON.toJson(file.getAbsolutePath());
        chatWindow.executeJavaScriptCode(
                "(function(){" +
                "  window.dispatchEvent(new CustomEvent('java-paste-file-path',{detail:{path:" + jsonPath + "}}));" +
                "})()"
        );
    }

    /**
     * Persist a screenshot to the CLI-visible attachment dir (same directory
     * and att-&lt;ts&gt;-&lt;uuid&gt; naming as ai-bridge attachment-files.js) so
     * the send can reference it by sourcePath instead of shipping full base64.
     * The dir is LRU-trimmed to the same 100-file cap ai-bridge enforces.
     *
     * @return the written file, or null when persisting failed
     */
    private static Path persistScreenshot(BufferedImage image) {
        try {
            Path dir = attachmentDir();
            Files.createDirectories(dir);
            cleanupOldestAttachmentFiles(dir);
            Path file = dir.resolve("att-" + System.currentTimeMillis() + "-"
                    + UUID.randomUUID().toString().substring(0, 8) + ".png");
            ImageIO.write(image, "png", file.toFile());
            return file;
        } catch (Exception ex) {
            LOG.warn("Failed to persist screenshot to attachment dir", ex);
            return null;
        }
    }

    /** Attachment dir mirror of ai-bridge getAttachmentDir (QWEN_MATE_TMP_DIR override included). */
    private static Path attachmentDir() {
        String base = System.getenv("QWEN_MATE_TMP_DIR");
        if (base == null || base.isBlank()) {
            base = Paths.get(PlatformUtils.getHomeDirectory(), ".qwen", "tmp").toString();
        }
        return Paths.get(base, "qwen-mate-attachments");
    }

    /** LRU trim to MAX_KEPT_FILES, mirroring ai-bridge cleanupOldAttachmentFiles. */
    private static void cleanupOldestAttachmentFiles(Path dir) {
        try (var stream = Files.list(dir)) {
            List<Path> files = stream.filter(Files::isRegularFile).toList();
            if (files.size() <= MAX_KEPT_FILES) {
                return;
            }
            files.sort((a, b) -> Long.compare(lastModified(a), lastModified(b)));
            for (int i = 0; i < files.size() - MAX_KEPT_FILES; i++) {
                Files.deleteIfExists(files.get(i));
            }
        } catch (Exception ex) {
            LOG.debug("Attachment dir cleanup skipped: " + ex.getMessage());
        }
    }

    private static long lastModified(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (Exception ex) {
            return 0L;
        }
    }

    /**
     * Encode a ≤PREVIEW_MAX_DIM JPEG preview as base64 for the webview
     * thumbnail. Alpha sources are composited on white (JPEG has no alpha).
     *
     * @return base64 preview, or null when encoding failed
     */
    private static String previewJpegBase64(BufferedImage source) {
        try {
            BufferedImage rgb = toRgb(source);
            int width = rgb.getWidth();
            int height = rgb.getHeight();
            int longest = Math.max(width, height);
            BufferedImage scaled = rgb;
            if (longest > PREVIEW_MAX_DIM) {
                double scale = (double) PREVIEW_MAX_DIM / (double) longest;
                int targetW = Math.max(1, (int) Math.round(width * scale));
                int targetH = Math.max(1, (int) Math.round(height * scale));
                scaled = new BufferedImage(targetW, targetH, BufferedImage.TYPE_INT_RGB);
                Graphics2D g = scaled.createGraphics();
                try {
                    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                            RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                    g.drawImage(rgb, 0, 0, targetW, targetH, null);
                } finally {
                    g.dispose();
                }
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpg");
            if (!writers.hasNext()) {
                return null;
            }
            ImageWriter writer = writers.next();
            try (ImageOutputStream out = ImageIO.createImageOutputStream(baos)) {
                writer.setOutput(out);
                ImageWriteParam param = writer.getDefaultWriteParam();
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(PREVIEW_JPEG_QUALITY);
                writer.write(null, new IIOImage(scaled, null, null), param);
            } finally {
                writer.dispose();
            }
            return Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (Exception ex) {
            LOG.debug("Preview generation failed: " + ex.getMessage());
            return null;
        }
    }

    /** Composite any image onto a white TYPE_INT_RGB canvas (JPEG cannot carry alpha). */
    private static BufferedImage toRgb(BufferedImage source) {
        if (source.getType() == BufferedImage.TYPE_INT_RGB) {
            return source;
        }
        BufferedImage rgb = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = rgb.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, rgb.getWidth(), rgb.getHeight());
            g.drawImage(source, 0, 0, null);
        } finally {
            g.dispose();
        }
        return rgb;
    }

    /** Materialize any Toolkit image as a BufferedImage (cheap when already one). */
    private static BufferedImage toBuffered(Image raw) {
        if (raw instanceof BufferedImage buffered) {
            return buffered;
        }
        int width = Math.max(1, raw.getWidth(null));
        int height = Math.max(1, raw.getHeight(null));
        BufferedImage buffered = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = buffered.createGraphics();
        try {
            g.drawImage(raw, 0, 0, null);
        } finally {
            g.dispose();
        }
        return buffered;
    }

    /**
     * Media type for a supported image file extension, or null when the file is
     * not an image we can inline (falls back to an @path chip reference).
     */
    private static String imageMediaTypeFor(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) {
            return "image/png";
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (lower.endsWith(".gif")) {
            return "image/gif";
        }
        if (lower.endsWith(".webp")) {
            return "image/webp";
        }
        if (lower.endsWith(".bmp")) {
            return "image/bmp";
        }
        return null;
    }
}
