/**
 * Commit Message Generation Service — "provider ask" mode.
 *
 * Routes to services/ask-service.js: one-shot text generation on the Qwen SDK
 * engine. The provider parameter is converged to 'qwen' / 'dsh' (any other
 * value falls back to the same engine).
 *
 * stdin JSON: { prompt, provider, model }
 *   - prompt:   the full commit prompt (spec + git diff), assembled by Java
 *   - provider: 'qwen' | 'dsh'
 *   - model:    resolved model id (empty / sentinel tokens mean the default model)
 *
 * stdout markers:
 *   [CONTENT_DELTA] <json-text>  — streamed token chunk
 *   [COMMIT]<text>               — success (newlines encoded as {{NEWLINE}})
 *   [COMMIT_ERROR]<msg>          — failure
 */

import { pathToFileURL } from 'node:url';

import { askOneShot, isAskProvider } from './ask-service.js';
import { getRealHomeDir } from '../utils/path-utils.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function emitContentDelta(text) {
  if (typeof text !== 'string' || !text) return;
  process.stdout.write(`[CONTENT_DELTA] ${JSON.stringify(text)}\n`);
}

async function generateWithAskService(prompt, provider, model) {
  const fullPrompt = [
    prompt,
    '',
    'Remember: output only the commit message, wrapped in <commit></commit>, with no explanation. Do not run tools.',
  ].join('\n');

  const askProvider = isAskProvider(provider) ? provider : 'qwen';
  console.log(`[CommitMessage] ask provider=${askProvider}, model=${model || '(default)'}`);

  return askOneShot({
    provider: askProvider,
    prompt: fullPrompt,
    model,
    cwd: getRealHomeDir(),
    onDelta: emitContentDelta,
  });
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);
    const { prompt, provider, model } = data;

    if (!prompt) {
      console.log('[COMMIT]');
      process.exit(0);
    }

    console.log(`[CommitMessage] provider=${provider}, model=${model || '(default)'}`);

    const text = await generateWithAskService(prompt, provider, model);

    const encoded = text.replace(/\n/g, '{{NEWLINE}}');
    console.log(`[COMMIT]${encoded}`);
    process.exit(0);
  } catch (error) {
    console.error('[CommitMessage] Error:', error && error.message ? error.message : String(error));
    console.log(`[COMMIT_ERROR]${error && error.message ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
