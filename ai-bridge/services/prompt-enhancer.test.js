import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePromptEnhancerRuntimeConfig,
  resolveAutoChatModel,
  buildFullPrompt,
  extractAppendedDelta,
  computeMaxTokens,
} from './prompt-enhancer.js';

test('resolvePromptEnhancerRuntimeConfig prefers the Java-resolved effectiveProvider', () => {
  const resolved = resolvePromptEnhancerRuntimeConfig({
    promptEnhancerConfig: {
      provider: null,
      effectiveProvider: 'dsh',
      resolutionSource: 'auto',
      models: {
        qwen: 'qwen-max',
        dsh: 'deepseek-v4',
      },
      availability: {
        qwen: true,
        dsh: true,
      },
    },
  });

  assert.equal(resolved.provider, 'dsh');
  assert.equal(resolved.model, 'deepseek-v4');
});

test('resolvePromptEnhancerRuntimeConfig accepts qwen as effectiveProvider', () => {
  const resolved = resolvePromptEnhancerRuntimeConfig({
    promptEnhancerConfig: {
      provider: 'qwen',
      effectiveProvider: 'qwen',
      resolutionSource: 'manual',
      models: {
        qwen: 'qwen-max',
        dsh: 'deepseek-v4',
      },
      availability: {
        qwen: true,
        dsh: true,
      },
    },
  });

  assert.equal(resolved.provider, 'qwen');
  assert.equal(resolved.model, 'qwen-max');
});

test('resolvePromptEnhancerRuntimeConfig throws a strict error when a removed provider is configured', () => {
  assert.throws(
    () => resolvePromptEnhancerRuntimeConfig({
      promptEnhancerConfig: {
        provider: 'unsupported',
        effectiveProvider: null,
        resolutionSource: 'unavailable',
        models: {},
        availability: {},
      },
    }),
    /No available prompt enhancer provider/
  );
});

test('resolveAutoChatModel uses chat model in auto mode when provider matches', () => {
  assert.equal(
    resolveAutoChatModel({
      provider: 'dsh',
      configuredModel: 'auto',
      resolutionSource: 'auto',
      chatProvider: 'dsh',
      chatModel: 'deepseek/deepseek-v4-flash',
    }),
    'deepseek/deepseek-v4-flash'
  );
});

test('resolveAutoChatModel keeps configured model in manual mode', () => {
  assert.equal(
    resolveAutoChatModel({
      provider: 'dsh',
      configuredModel: 'auto',
      resolutionSource: 'manual',
      chatProvider: 'dsh',
      chatModel: 'deepseek/deepseek-v4-flash',
    }),
    'auto'
  );
});

test('resolveAutoChatModel ignores chat model when provider differs', () => {
  assert.equal(
    resolveAutoChatModel({
      provider: 'qwen',
      configuredModel: 'qwen-max',
      resolutionSource: 'auto',
      chatProvider: 'dsh',
      chatModel: 'deepseek/deepseek-v4-flash',
    }),
    'qwen-max'
  );
});

test('resolvePromptEnhancerRuntimeConfig auto follows chat model for qwen', () => {
  const resolved = resolvePromptEnhancerRuntimeConfig({
    promptEnhancerConfig: {
      provider: null,
      effectiveProvider: 'qwen',
      resolutionSource: 'auto',
      models: {
        qwen: 'auto',
        dsh: 'auto',
      },
      availability: {
        qwen: true,
        dsh: true,
      },
    },
    chatProvider: 'qwen',
    chatModel: 'qwen-max',
  });

  assert.equal(resolved.provider, 'qwen');
  assert.equal(resolved.model, 'qwen-max');
  assert.equal(resolved.resolutionSource, 'auto');
});

test('resolvePromptEnhancerRuntimeConfig manual does not follow chat model', () => {
  const resolved = resolvePromptEnhancerRuntimeConfig({
    promptEnhancerConfig: {
      provider: 'qwen',
      effectiveProvider: 'qwen',
      resolutionSource: 'manual',
      models: {
        qwen: 'qwen-max',
      },
      availability: {
        qwen: true,
      },
    },
    chatProvider: 'qwen',
    chatModel: 'qwen-plus',
  });

  assert.equal(resolved.model, 'qwen-max');
});

// ---------- computeMaxTokens ----------

test('computeMaxTokens scales with prompt length and stays within bounds', () => {
  assert.equal(computeMaxTokens(0), 2048);
  assert.equal(computeMaxTokens(100), 2048);
  assert.equal(computeMaxTokens(2000), 4000);
  assert.equal(computeMaxTokens(10000), 8192);
  assert.equal(computeMaxTokens(-1), 2048);
});

// ---------- extractAppendedDelta ----------

test('extractAppendedDelta returns the new slice when next extends previous', () => {
  assert.equal(extractAppendedDelta('Hello', 'Hello world'), ' world');
});

test('extractAppendedDelta returns empty when next equals previous', () => {
  assert.equal(extractAppendedDelta('Hello', 'Hello'), '');
});

test('extractAppendedDelta returns the full next when previous is not a prefix', () => {
  assert.equal(extractAppendedDelta('Hi', 'Hello'), 'Hello');
});

test('extractAppendedDelta returns full next when previous is empty', () => {
  assert.equal(extractAppendedDelta('', 'World'), 'World');
});

test('extractAppendedDelta returns empty when next is empty string', () => {
  // next.trim() === '' short-circuits regardless of previous.
  assert.equal(extractAppendedDelta('Hello', ''), '');
});

test('extractAppendedDelta returns empty when next contains only whitespace', () => {
  assert.equal(extractAppendedDelta('Hello', '   \n\t'), '');
});

test('extractAppendedDelta coerces non-string inputs to empty strings safely', () => {
  // null/undefined previous is treated as ''
  assert.equal(extractAppendedDelta(null, 'Hello'), 'Hello');
  assert.equal(extractAppendedDelta(undefined, 'Hello'), 'Hello');
  // null/undefined next is treated as '' which fails trim() check -> ''
  assert.equal(extractAppendedDelta('Hello', null), '');
  assert.equal(extractAppendedDelta('Hello', undefined), '');
});

test('extractAppendedDelta handles multi-byte / unicode characters', () => {
  assert.equal(extractAppendedDelta('你好', '你好世界'), '世界');
});

// ---------- buildFullPrompt ----------

test('buildFullPrompt returns plain prompt when context is missing', () => {
  const result = buildFullPrompt('Make this faster', null);
  assert.equal(result, 'Please optimize the following prompt:\n\nMake this faster');
});

test('buildFullPrompt returns plain prompt when context is undefined', () => {
  const result = buildFullPrompt('Make this faster');
  assert.equal(result, 'Please optimize the following prompt:\n\nMake this faster');
});

test('buildFullPrompt embeds selected code with detected language from path', () => {
  const result = buildFullPrompt('Refactor', {
    selectedCode: 'const x = 1;',
    currentFile: { path: '/repo/src/foo.ts' },
  });
  assert.match(result, /\[User Selected Code\]/);
  assert.match(result, /```typescript/);
  assert.match(result, /const x = 1;/);
});

test('buildFullPrompt prefers explicit context.currentFile.language over path-derived language', () => {
  const result = buildFullPrompt('Refactor', {
    selectedCode: 'print(1)',
    currentFile: { path: '/repo/foo.ts', language: 'python' },
  });
  // Selected code block should use the explicitly provided language.
  assert.match(result, /\[User Selected Code\]\n```python/);
});

test('buildFullPrompt truncates very long selected code', () => {
  const longCode = 'a'.repeat(5000); // > MAX_SELECTED_CODE_LENGTH (2000)
  const result = buildFullPrompt('Refactor', {
    selectedCode: longCode,
    currentFile: { path: 'foo.ts' },
  });
  // Truncation appends '\n...' marker.
  assert.match(result, /\n\.\.\./);
  // Truncated content length cap (2000) + '\n...' suffix => block is bounded.
  // Verify we did NOT include all 5000 'a' chars.
  const aMatches = result.match(/a+/g) || [];
  const longestA = aMatches.reduce((m, s) => Math.max(m, s.length), 0);
  assert.ok(longestA <= 2000, `Selected code should be truncated to 2000 chars, got ${longestA}`);
});

test('buildFullPrompt uses cursor context only when no selected code is present', () => {
  const withSelection = buildFullPrompt('Refactor', {
    selectedCode: 'const x = 1;',
    cursorContext: 'function foo() {}',
    currentFile: { path: 'foo.ts' },
  });
  assert.doesNotMatch(withSelection, /Code Around Cursor/);

  const withoutSelection = buildFullPrompt('Refactor', {
    cursorContext: 'function foo() {}',
    cursorPosition: { line: 42 },
    currentFile: { path: 'foo.ts' },
  });
  assert.match(withoutSelection, /\[Code Around Cursor \(line 42\)\]/);
  assert.match(withoutSelection, /function foo\(\) \{\}/);
});

test('buildFullPrompt enforces related-files total length cap', () => {
  const bigContent = 'x'.repeat(800); // > MAX_SINGLE_RELATED_FILE_LENGTH (500)
  const relatedFiles = [];
  for (let i = 0; i < 10; i += 1) {
    relatedFiles.push({ path: `file${i}.ts`, content: bigContent });
  }
  const result = buildFullPrompt('Refactor', { relatedFiles });
  assert.match(result, /\[Related Files\]/);
  // The 'x' run length per file is bounded by truncation; total 'x' across the
  // prompt should not exceed MAX_RELATED_FILES_LENGTH (2000) by much.
  const totalXs = (result.match(/x/g) || []).length;
  assert.ok(totalXs <= 2100, `Total related files content should be bounded, got ${totalXs}`);
});

test('buildFullPrompt detects language for common extensions', () => {
  const cases = [
    { path: 'foo.ts', expected: 'typescript' },
    { path: 'foo.tsx', expected: 'typescript' },
    { path: 'foo.js', expected: 'javascript' },
    { path: 'foo.py', expected: 'python' },
    { path: 'foo.java', expected: 'java' },
    { path: 'foo.kt', expected: 'kotlin' },
    { path: 'foo.go', expected: 'go' },
    { path: 'foo.rs', expected: 'rust' },
    { path: 'foo.unknown', expected: 'text' },
  ];
  for (const { path, expected } of cases) {
    const result = buildFullPrompt('p', {
      selectedCode: 'sample',
      currentFile: { path },
    });
    assert.match(
      result,
      new RegExp(`\\[User Selected Code\\]\\n\`\`\`${expected}`),
      `Expected language '${expected}' for path '${path}'`
    );
  }
});

test('buildFullPrompt includes current-file content preview when no selection or cursor context', () => {
  const result = buildFullPrompt('Refactor', {
    currentFile: {
      path: 'src/foo.ts',
      content: 'export const greet = () => "hi";',
    },
  });
  assert.match(result, /\[Current File\] src\/foo\.ts/);
  assert.match(result, /\[Language Type\] typescript/);
  assert.match(result, /\[File Content Preview\]/);
  assert.match(result, /export const greet/);
});

test('buildFullPrompt skips current-file content preview when selection is present', () => {
  const result = buildFullPrompt('Refactor', {
    selectedCode: 'const x = 1;',
    currentFile: {
      path: 'src/foo.ts',
      content: 'export const greet = () => "hi";',
    },
  });
  assert.doesNotMatch(result, /\[File Content Preview\]/);
  // But path/language metadata should still be present.
  assert.match(result, /\[Current File\] src\/foo\.ts/);
});

test('buildFullPrompt appends project type when provided', () => {
  const result = buildFullPrompt('Refactor', { projectType: 'React + Vite' });
  assert.match(result, /\[Project Type\] React \+ Vite/);
});
