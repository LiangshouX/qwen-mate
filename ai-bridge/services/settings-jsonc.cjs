/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Format-preserving JSONC settings writer — a CommonJS port of the Qwen Code
 * CLI's packages/cli/src/utils/jsonc-editor.ts + utils/write-with-backup.ts
 * (version 0.25.0), using the same vendored jsonc-parser@3.3.1 the CLI ships.
 *
 * Porting the CLI's own algorithm (minimal `modify` edits against the original
 * text, comment/indent/EOL detection, duplicate-key normalization, post-edit
 * deep-equal validation, staging + single-rename publication with a recovery
 * copy) keeps GUI writes byte-compatible with what `qwen` itself would produce,
 * so hand-written comments and formatting survive and a corrupt result is
 * never published.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const jsonc = require('./vendor/jsonc-parser/lib/main.js');

const PARSE_OPTIONS = { allowTrailingComma: true };

class SettingsWriteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SettingsWriteError';
    this.code = code || 'write_failed';
  }
}

function stripBom(content) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parseJsoncObject(content) {
  const errors = [];
  const root = jsonc.parseTree(stripBom(content), errors, PARSE_OPTIONS);
  if (errors.length > 0) {
    const error = errors[0];
    throw new SettingsWriteError(
      `${jsonc.printParseErrorCode(error.error)} at offset ${error.offset}`,
      'parse_error',
    );
  }
  if (root === undefined || root.type !== 'object') {
    throw new SettingsWriteError('JSONC document root is not a JSON object.', 'parse_error');
  }
  return JSON.parse(JSON.stringify(jsonc.getNodeValue(root)));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

/** Deep-merge `updates` into `current` (arrays and scalars replace wholesale). */
function applyUpdates(current, updates, sync = false, replacePath = [], currentPath = []) {
  const result = current;

  if (sync) {
    for (const key of Object.keys(result)) {
      if (!Object.hasOwn(updates, key)) delete result[key];
    }
  }

  for (const key of Object.getOwnPropertyNames(updates)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

    const value = updates[key];
    const nextPath = [...currentPath, key];
    const valueIsObject = isRecord(value) && Object.keys(value).length > 0;

    if (pathsEqual(nextPath, replacePath)) {
      result[key] = valueIsObject ? applyUpdates({}, value) : value;
      continue;
    }

    if (valueIsObject && (!isRecord(result[key]) || Array.isArray(result[key]))) {
      result[key] = applyUpdates({}, value, sync, replacePath, nextPath);
    } else if (valueIsObject && isRecord(result[key]) && !Array.isArray(result[key])) {
      result[key] = applyUpdates(result[key], value, sync, replacePath, nextPath);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function detectFormattingOptions(content) {
  const root = jsonc.parseTree(content, [], PARSE_OPTIONS);
  const firstKey = root?.children?.[0]?.children?.[0];
  const lineStart = firstKey === undefined ? -1 : content.lastIndexOf('\n', firstKey.offset - 1);
  const candidate =
    firstKey === undefined ? undefined : content.slice(lineStart + 1, firstKey.offset);
  const indentation = candidate !== undefined && /^[ \t]*$/.test(candidate) ? candidate : '  ';
  return {
    eol: content.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indentation.startsWith('\t'),
    tabSize: indentation.startsWith('\t') ? 1 : indentation.length,
    insertFinalNewline: content.endsWith('\n'),
  };
}

function collectOperations(current, target, path = [], operations = []) {
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(target, key)) operations.push({ path: [...path, key], value: undefined });
  }
  for (const key of Object.keys(target)) {
    const nextPath = [...path, key];
    if (!Object.hasOwn(current, key)) {
      operations.push({ path: nextPath, value: target[key] });
    } else if (isRecord(current[key]) && isRecord(target[key])) {
      collectOperations(current[key], target[key], nextPath, operations);
    } else if (!isDeepStrictEqual(current[key], target[key])) {
      operations.push({ path: nextPath, value: target[key] });
    }
  }
  return operations;
}

function findDuplicateProperty(node, path = []) {
  if (node.type !== 'object' || node.children === undefined) return undefined;

  const properties = new Map();
  for (const property of node.children) {
    const keyNode = property.children?.[0];
    const key = keyNode?.value;
    if (typeof key !== 'string' || keyNode === undefined) continue;
    const previous = properties.get(key);
    if (previous !== undefined) {
      return {
        objectPath: [...path],
        keyNode: previous,
        propertyNames: new Set(properties.keys()),
      };
    }
    properties.set(key, keyNode);
  }

  for (const property of node.children) {
    const key = property.children?.[0]?.value;
    const valueNode = property.children?.[1];
    if (typeof key !== 'string' || valueNode === undefined) continue;
    const duplicate = findDuplicateProperty(valueNode, [...path, key]);
    if (duplicate !== undefined) return duplicate;
  }
  return undefined;
}

function removeTrailingInlineComment(content, path) {
  const root = jsonc.parseTree(content, [], PARSE_OPTIONS);
  if (root === undefined) return content;
  const node = jsonc.findNodeAtLocation(root, path);
  if (node === undefined) return content;

  const tail = content.slice(node.offset + node.length);
  const match = tail.match(/^[ \t]*(?:,[ \t]*)?(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/);
  const comment = match?.[1];
  if (comment === undefined || match === null) return content;

  const commentOffset = node.offset + node.length + match[0].indexOf(comment);
  return content.slice(0, commentOffset) + content.slice(commentOffset + comment.length);
}

function normalizeDuplicateProperties(content, options) {
  let normalized = content;
  let duplicateIndex = 0;
  for (;;) {
    const root = jsonc.parseTree(normalized, [], PARSE_OPTIONS);
    if (root === undefined) return normalized;
    const duplicate = findDuplicateProperty(root);
    if (duplicate === undefined) return normalized;

    let temporaryKey;
    do {
      temporaryKey = `__qwen_duplicate_${duplicateIndex}`;
      duplicateIndex += 1;
    } while (duplicate.propertyNames.has(temporaryKey));

    let renamed =
      normalized.slice(0, duplicate.keyNode.offset) +
      JSON.stringify(temporaryKey) +
      normalized.slice(duplicate.keyNode.offset + duplicate.keyNode.length);
    renamed = removeTrailingInlineComment(renamed, [...duplicate.objectPath, temporaryKey]);
    normalized = jsonc.applyEdits(
      renamed,
      jsonc.modify(renamed, [...duplicate.objectPath, temporaryKey], undefined, options),
    );
  }
}

/**
 * Compute the updated JSONC text for `updates` against `content`.
 * Throws SettingsWriteError when the source is unparseable or the edited
 * result would not be valid JSON / would not match the intended settings.
 */
function updateJsoncContent(content, updates, sync = false, replacePath = []) {
  const bom = content.charCodeAt(0) === 0xfeff ? content.slice(0, 1) : '';
  const editableContent = stripBom(content);
  const parsed = parseJsoncObject(editableContent);
  const targetWithUndefined = applyUpdates(structuredClone(parsed), updates, sync, replacePath);
  const target = JSON.parse(JSON.stringify(targetWithUndefined));

  const options = { formattingOptions: detectFormattingOptions(editableContent) };
  let updated = normalizeDuplicateProperties(editableContent, options);
  const current = parseJsoncObject(updated);

  for (const operation of collectOperations(current, target)) {
    if (operation.value === undefined) {
      updated = removeTrailingInlineComment(updated, operation.path);
    }
    updated = jsonc.applyEdits(updated, jsonc.modify(updated, operation.path, operation.value, options));
  }

  const reparsed = parseJsoncObject(updated);
  if (!isDeepStrictEqual(reparsed, target)) {
    throw new SettingsWriteError(
      'Edited JSONC does not match the intended settings.',
      'validation_failed',
    );
  }
  return bom + updated;
}

/**
 * Compute the file content after applying `updates`. Pure — no disk I/O.
 * When the file does not exist yet, renders `updates` as 2-space JSON (CLI
 * parity). Returns the new full text.
 */
function renderSettingsUpdate(filePath, updates, replacePath = []) {
  if (!fs.existsSync(filePath)) {
    return JSON.stringify(updates, null, 2);
  }
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  try {
    return updateJsoncContent(originalContent, updates, false, replacePath);
  } catch (error) {
    if (error instanceof SettingsWriteError) throw error;
    throw new SettingsWriteError(
      `Error parsing settings file: ${error instanceof Error ? error.message : String(error)}`,
      'parse_error',
    );
  }
}

function sameContents(first, second) {
  try {
    return fs.readFileSync(first).equals(fs.readFileSync(second));
  } catch {
    return false;
  }
}

/**
 * Atomically publish `content` to `targetPath` — staging file + backup copy
 * beside the target + one rename (CLI parity: existing settings stay readable
 * throughout; a failed publication retains a recovery copy).
 */
function writeWithBackupSync(targetPath, content, options = {}) {
  const { backupSuffix = '.orig', encoding = 'utf-8' } = options;
  const existing = fs.existsSync(targetPath) ? fs.statSync(targetPath) : undefined;
  if (existing?.isDirectory()) {
    throw new SettingsWriteError(
      `Cannot write to '${targetPath}' because it is a directory`,
      'write_failed',
    );
  }

  const workingDirectory = fs.mkdtempSync(`${targetPath}.write-`);
  const basename = path.basename(targetPath);
  const tempPath = path.join(workingDirectory, `${basename}.tmp`);
  const backupPath = path.join(workingDirectory, `${basename}${backupSuffix}`);
  let backupCreated = false;

  try {
    const mode =
      existing && fs.lstatSync(targetPath, { throwIfNoEntry: false })?.isFile()
        ? existing.mode & 0o777
        : undefined;
    fs.writeFileSync(tempPath, content, { encoding, flag: 'wx', mode });
    if (mode !== undefined) {
      try {
        fs.chmodSync(tempPath, mode);
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (
          (code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EPERM') ||
          (fs.statSync(tempPath).mode & 0o777 & ~mode) !== 0
        ) {
          throw error;
        }
      }
    }

    if (fs.existsSync(targetPath)) {
      try {
        fs.copyFileSync(targetPath, backupPath, fs.constants.COPYFILE_EXCL);
        backupCreated = true;
      } catch (backupError) {
        throw new SettingsWriteError(
          `Failed to backup existing file: ${backupError instanceof Error ? backupError.message : String(backupError)}`,
          'backup_failed',
        );
      }
    }

    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    const recoveryRetained = backupCreated && !sameContents(backupPath, targetPath);
    try {
      if (recoveryRetained) {
        fs.unlinkSync(tempPath);
      } else {
        fs.rmSync(workingDirectory, { recursive: true, force: true });
      }
    } catch {
      // Cleanup must not obscure the write failure or remove a recovery copy.
    }
    if (recoveryRetained && error instanceof SettingsWriteError) {
      throw new SettingsWriteError(
        `${error.message} Recovery copy retained at '${backupPath}'.`,
        error.code,
      );
    }
    if (recoveryRetained) {
      throw new SettingsWriteError(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}. ` +
          `Recovery copy retained at '${backupPath}'; inspect the current target before restoring it.`,
        'write_failed',
      );
    }
    throw error instanceof SettingsWriteError
      ? error
      : new SettingsWriteError(
          error instanceof Error ? error.message : String(error),
          'write_failed',
        );
  }

  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  } catch {
    // Publication already succeeded; leftover artifacts do not invalidate it.
  }
}

/**
 * Validate + atomically persist a batch of settings updates in one file write.
 * Returns the published text. Throws SettingsWriteError (leaving the original
 * file untouched) when parsing/validation/publication fails.
 */
function persistSettingsUpdates(filePath, updates, replacePath = []) {
  const nextContent = renderSettingsUpdate(filePath, updates, replacePath);
  writeWithBackupSync(filePath, nextContent);
  return nextContent;
}

module.exports = {
  SettingsWriteError,
  applyUpdates,
  detectFormattingOptions,
  parseJsoncObject,
  persistSettingsUpdates,
  renderSettingsUpdate,
  stripBom,
  updateJsoncContent,
  writeWithBackupSync,
};
