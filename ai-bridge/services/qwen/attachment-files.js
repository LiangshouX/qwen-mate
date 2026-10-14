/**
 * Attachment file persistence — the GUI equivalent of the CLI's clipboard
 * image handling (save to temp, reference by @path).
 *
 * The SDK query() prompt is text-only: ContentBlock has no image variant, and
 * the CLI's non-interactive input reader stringifies every non-text block
 * into message text (nonInteractiveHelpers.ts). Sending base64 blocks
 * therefore never reaches the model as an image — it becomes a huge JSON text
 * blob that floods the context window. Persisting attachments to disk and
 * referencing them by @path keeps the message text tiny; the model reads the
 * file with read_file, which returns inlineData parts it can actually see.
 *
 * The directory MUST live under ~/.qwen/tmp: the CLI's file workspace checks
 * explicitly allow the configured project temp dir (~/.qwen/tmp), while
 * other locations (e.g. ~/.qwenmate) are rejected as outside the workspace.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

// LRU keep: retain the newest files, drop the rest. Mirrors the CLI's
// cleanupOldClipboardImages policy so pasted attachments never pile up.
const MAX_KEPT_FILES = 100;

function getAttachmentDir() {
  // QWEN_MATE_TMP_DIR lets tests redirect writes into a sandbox dir.
  const base = process.env.QWEN_MATE_TMP_DIR || join(homedir(), '.qwen', 'tmp');
  return join(base, 'qwen-mate-attachments');
}

const IMAGE_EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

function resolveExtension(att) {
  const byMedia = IMAGE_EXT_BY_MEDIA_TYPE[att.mediaType];
  if (byMedia) return byMedia;
  const fromFileName = att.fileName ? extname(att.fileName).replace(/^\./, '') : '';
  if (fromFileName) return fromFileName;
  const slash = typeof att.mediaType === 'string' && att.mediaType.includes('/')
    ? att.mediaType.split('/')[1]
    : '';
  return slash || 'bin';
}

function cleanupOldAttachmentFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  if (names.length <= MAX_KEPT_FILES) return;
  const entries = names
    .map((name) => {
      try {
        return { name, mtime: statSync(join(dir, name)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries.slice(MAX_KEPT_FILES)) {
    try {
      unlinkSync(join(dir, entry.name));
    } catch {
      // Best effort: a concurrently removed file is fine.
    }
  }
}

/**
 * Persist attachments (base64 payloads) to the CLI-visible temp dir.
 *
 * @param {Array<{fileName?: string, mediaType?: string, data?: string}>} attachments
 * @returns {string[]} '@'-prefixed absolute paths of the persisted files
 */
export function persistAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }
  const dir = getAttachmentDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`[attachment-files] cannot create attachment dir: ${error?.message || error}`);
    return [];
  }
  cleanupOldAttachmentFiles(dir);

  const refs = [];
  for (const att of attachments) {
    if (!att || typeof att.data !== 'string' || !att.data) {
      continue;
    }
    try {
      const filePath = join(dir, `att-${Date.now()}-${randomUUID().slice(0, 8)}.${resolveExtension(att)}`);
      writeFileSync(filePath, Buffer.from(att.data, 'base64'));
      refs.push(`@${filePath}`);
    } catch (error) {
      console.error(`[attachment-files] failed to persist attachment: ${error?.message || error}`);
    }
  }
  return refs;
}

/**
 * Prepend @path references to the user message, matching the CLI composer
 * (attachments become "@path" lines before the typed text).
 *
 * @param {string} message
 * @param {string[]} refs
 * @returns {string}
 */
export function prependAttachmentRefs(message, refs) {
  if (!refs || refs.length === 0) return message;
  return `${refs.join(' ')}\n\n${message ?? ''}`;
}
