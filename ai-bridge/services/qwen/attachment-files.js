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
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';

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
 * Annotation appended after an original-path ref when a temp copy feeds the
 * CLI expansion. Without it the model reads "@temp @orig" as two images (the
 * temp expands inline while the original stays literal text) and runs vision
 * on the same file twice; " (same file)" disambiguates. The display layer
 * strips it together with the temp ref, so bubbles never show it.
 */
export const SAME_FILE_ANNOTATION = ' (same file)';

/**
 * Persist attachments to the CLI-visible temp dir.
 *
 * Disk-first: an attachment with a `sourcePath` is referenced from disk, so
 * the model always receives the full-resolution original even though `data`
 * may only carry a small preview (paste-channel rework):
 * - sourcePath inside the workspace or already inside the attachment dir
 *   (Java-persisted screenshots) → referenced directly, no copy;
 * - sourcePath elsewhere → copied from the ORIGINAL file (never from `data`)
 *   with the original kept as a second, "(same file)"-annotated ref;
 * - no sourcePath (native DOM paste fallback) → `data` written as before.
 *
 * A ref the message already carries is skipped: the frontend prepends
 * `@sourcePath` so the bubble shows it immediately, and `inlineExternalImageRefs`
 * owns the temp copy for message-embedded external refs — prepending again
 * would duplicate the reference.
 *
 * @param {Array<{fileName?: string, mediaType?: string, data?: string, sourcePath?: string}>} attachments
 * @param {{cwd?: string, message?: string}} [opts]
 * @returns {string[]} '@'-prefixed references of the persisted files
 */
export function persistAttachments(attachments, opts = {}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }
  const cwd = typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : null;
  const message = typeof opts.message === 'string' ? opts.message : null;
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
    if (!att) {
      continue;
    }
    const sourcePath = typeof att.sourcePath === 'string' && att.sourcePath ? att.sourcePath : null;
    if (sourcePath && fileExists(sourcePath)) {
      // The message already references this file: expansion is covered
      // (workspace/temp paths expand natively, external paths get their temp
      // copy from inlineExternalImageRefs), so nothing to persist or prepend.
      if (message && message.includes(`@${sourcePath}`)) {
        continue;
      }
      if (isInsideDir(cwd, sourcePath) || isInsideDir(dir, sourcePath)) {
        refs.push(`@${sourcePath}`);
        continue;
      }
      try {
        const filePath = join(dir, `att-${Date.now()}-${randomUUID().slice(0, 8)}${extname(sourcePath)}`);
        copyFileSync(sourcePath, filePath);
        refs.push(`@${filePath}`);
        refs.push(`@${sourcePath}${SAME_FILE_ANNOTATION}`);
      } catch (error) {
        console.error(`[attachment-files] failed to persist attachment: ${error?.message || error}`);
      }
      continue;
    }
    if (typeof att.data !== 'string' || !att.data) {
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

const IMAGE_REF_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/**
 * Inline-copy @path references to image files that sit OUTSIDE the workspace:
 * each `@origPath` token gets a temp-dir copy inserted in front of it
 * ("@origPath" → "@tempPath @origPath (same file)") so the CLI expands the
 * temp copy to an inlineData image while the original path stays literal text
 * the model can see. The "(same file)" annotation stops the model from
 * counting the two refs as two images. The display layer strips the temp ref
 * and the annotation from lines that mix temp and non-temp refs, so the bubble
 * renders the user's original text unchanged. Workspace files, non-images, and
 * missing files are left untouched.
 *
 * @param {string} message
 * @param {{cwd?: string}} [opts]
 * @returns {{message: string, copied: number}}
 */
export function inlineExternalImageRefs(message, opts = {}) {
  if (typeof message !== 'string' || !message) {
    return { message: message ?? '', copied: 0 };
  }
  const cwd = typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : null;
  if (!cwd) {
    return { message, copied: 0 };
  }
  const dir = getAttachmentDir();
  // Mirrors the CLI's parseAllAtCommands break set (whitespace and
  // ,;!?()[]{}); '.' stays in the class so extensions survive, and a
  // trailing sentence period degrades to a fileExists miss (left untouched).
  const atRefRegex = /@(?:[A-Za-z]:[\\/]|\\\\)[^\s,;!?()[\]{}]+/g;
  let copied = 0;
  const rewritten = message.replace(atRefRegex, (match) => {
    const rawPath = match.slice(1);
    const lower = rawPath.toLowerCase();
    if (!IMAGE_REF_EXT.has(extname(lower).toLowerCase())) {
      return match;
    }
    if (isInsideDir(cwd, rawPath) || isInsideDir(dir, rawPath) || !fileExists(rawPath)) {
      return match;
    }
    try {
      mkdirSync(dir, { recursive: true });
      const tempPath = join(dir, `att-${Date.now()}-${randomUUID().slice(0, 8)}${extname(lower)}`);
      copyFileSync(rawPath, tempPath);
      copied += 1;
      return `@${tempPath} ${match}${SAME_FILE_ANNOTATION}`;
    } catch (error) {
      console.error(`[attachment-files] failed to copy external image ref: ${error?.message || error}`);
      return match;
    }
  });
  if (copied > 0) {
    cleanupOldAttachmentFiles(dir);
  }
  return { message: rewritten, copied };
}

/** True when child is the parent dir or lives inside it (path-separator agnostic). */
function isInsideDir(parent, child) {
  if (!parent || !child) {
    return false;
  }
  const normalizedParent = resolve(parent).replace(/[\\/]+$/, '').toLowerCase();
  const normalizedChild = resolve(child).toLowerCase();
  return normalizedChild === normalizedParent
    || normalizedChild.startsWith(`${normalizedParent}\\`)
    || normalizedChild.startsWith(`${normalizedParent}/`);
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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
