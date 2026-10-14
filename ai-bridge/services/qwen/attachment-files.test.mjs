import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistAttachments, prependAttachmentRefs } from './attachment-files.js';

function withAttachmentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'att-files-'));
  const saved = process.env.QWEN_MATE_TMP_DIR;
  process.env.QWEN_MATE_TMP_DIR = dir;
  t.after(() => {
    if (saved === undefined) {
      delete process.env.QWEN_MATE_TMP_DIR;
    } else {
      process.env.QWEN_MATE_TMP_DIR = saved;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return join(dir, 'qwen-mate-attachments');
}

test('persistAttachments writes files and returns @path refs', (t) => {
  const attachmentDir = withAttachmentDir(t);
  // "hi" in base64
  const refs = persistAttachments([
    { fileName: 'shot.png', mediaType: 'image/png', data: 'aGk=' },
  ]);

  assert.equal(refs.length, 1);
  assert.ok(refs[0].startsWith('@'), 'refs must be @-prefixed so the model treats them as file references');
  const filePath = refs[0].slice(1);
  assert.ok(filePath.startsWith(attachmentDir), `expected ${filePath} inside ${attachmentDir}`);
  assert.ok(filePath.endsWith('.png'), 'media type drives the extension');
  assert.equal(readFileSync(filePath, 'utf8'), 'hi');
});

test('persistAttachments infers the extension from fileName for non-image types', (t) => {
  withAttachmentDir(t);
  const refs = persistAttachments([
    { fileName: 'notes.md', mediaType: 'text/markdown', data: 'dGVzdA==' },
  ]);

  assert.equal(refs.length, 1);
  assert.ok(refs[0].endsWith('.md'));
});

test('persistAttachments skips entries without base64 data', (t) => {
  withAttachmentDir(t);
  const refs = persistAttachments([
    undefined,
    { fileName: 'empty.png', mediaType: 'image/png' },
    { fileName: 'blank.png', mediaType: 'image/png', data: '' },
  ]);

  assert.deepEqual(refs, []);
});

test('persistAttachments keeps only the newest files (LRU cap)', (t) => {
  const attachmentDir = withAttachmentDir(t);
  mkdirSync(attachmentDir, { recursive: true });
  // Seed 105 old files with staggered mtimes.
  const now = Date.now() / 1000;
  for (let i = 0; i < 105; i++) {
    const filePath = join(attachmentDir, `old-${i}.png`);
    writeFileSync(filePath, 'x');
    utimesSync(filePath, now - (105 - i), now - (105 - i));
  }

  persistAttachments([{ mediaType: 'image/png', data: 'aGk=' }]);

  const remaining = readdirSync(attachmentDir);
  assert.ok(remaining.length <= 101, `expected LRU trim, found ${remaining.length} files`);
  assert.ok(
    remaining.some((name) => name.startsWith('att-')),
    'the newly persisted file must survive the trim',
  );
});

test('prependAttachmentRefs keeps the message plain when there are no refs', () => {
  assert.equal(prependAttachmentRefs('hello', []), 'hello');
  assert.equal(prependAttachmentRefs('hello', undefined), 'hello');
});

test('prependAttachmentRefs places refs before the typed text like the CLI composer', () => {
  const text = prependAttachmentRefs('这张图是啥？', ['@C:\\tmp\\a.png', '@C:\\tmp\\b.jpg']);
  assert.equal(text, '@C:\\tmp\\a.png @C:\\tmp\\b.jpg\n\n这张图是啥？');
});
