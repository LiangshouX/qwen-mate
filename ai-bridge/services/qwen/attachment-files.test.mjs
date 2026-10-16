import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistAttachments, prependAttachmentRefs, inlineExternalImageRefs } from './attachment-files.js';

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

test('persistAttachments keeps the original path as a second ref for outside-workspace source files', (t) => {
  withAttachmentDir(t);
  const sourceDir = mkdtempSync(join(tmpdir(), 'att-source-'));
  t.after(() => rmSync(sourceDir, { recursive: true, force: true }));
  const sourcePath = join(sourceDir, 'copied.png');
  writeFileSync(sourcePath, 'orig');

  const refs = persistAttachments(
    [{ fileName: 'copied.png', mediaType: 'image/png', data: 'aGk=', sourcePath }],
    { cwd: join(sourceDir, 'workspace-that-is-not-the-source-dir') },
  );

  assert.equal(refs.length, 2, 'temp copy ref + original source ref');
  assert.ok(refs[0].includes('qwen-mate-attachments'), `first ref is the temp copy, got ${refs[0]}`);
  assert.equal(
    refs[1],
    `@${sourcePath} (same file)`,
    'the original ref carries the annotation so the model does not count two images',
  );
});

test('persistAttachments references the workspace source directly without a temp copy', (t) => {
  const attachmentDir = withAttachmentDir(t);
  const workspaceDir = mkdtempSync(join(tmpdir(), 'att-workspace-'));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const sourcePath = join(workspaceDir, 'inside.png');
  writeFileSync(sourcePath, 'orig');

  const refs = persistAttachments(
    [{ fileName: 'inside.png', mediaType: 'image/png', data: 'aGk=', sourcePath }],
    { cwd: workspaceDir },
  );

  assert.deepEqual(refs, [`@${sourcePath}`]);
  assert.deepEqual(readdirSync(attachmentDir), [], 'no temp copy is written for in-workspace sources');
});

test('inlineExternalImageRefs prepends a temp copy in front of outside-workspace image refs', (t) => {
  const attachmentDir = withAttachmentDir(t);
  const workspaceDir = mkdtempSync(join(tmpdir(), 'att-inline-ws-'));
  const externalDir = mkdtempSync(join(tmpdir(), 'att-inline-ext-'));
  t.after(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  });
  const externalPath = join(externalDir, 'outside.png');
  writeFileSync(externalPath, 'x');
  const workspacePath = join(workspaceDir, 'inside.png');
  writeFileSync(workspacePath, 'x');

  const { message } = inlineExternalImageRefs(
    `@${externalPath} @${workspacePath} 识图`,
    { cwd: workspaceDir },
  );

  assert.ok(message.includes('qwen-mate-attachments'), 'temp copy ref is inserted');
  assert.ok(message.includes(`@${externalPath}`), 'original external path stays as literal text');
  assert.ok(message.includes(`@${workspacePath}`), 'workspace refs are untouched');
  assert.equal(readdirSync(attachmentDir).length, 1, 'exactly one temp copy written');
});

test('inlineExternalImageRefs leaves non-image and missing refs untouched', (t) => {
  withAttachmentDir(t);
  const externalDir = mkdtempSync(join(tmpdir(), 'att-inline-miss-'));
  t.after(() => rmSync(externalDir, { recursive: true, force: true }));
  const docPath = join(externalDir, 'notes.md');
  writeFileSync(docPath, 'x');

  const input = `@${docPath} @${join(externalDir, 'missing.png')} no images`;
  const { message, copied } = inlineExternalImageRefs(input, { cwd: externalDir });

  assert.equal(message, input);
  assert.equal(copied, 0);
});
