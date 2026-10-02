#!/usr/bin/env node
/**
 * Qwen integration smoke test — drives the real ai-bridge + Qwen Code SDK
 * end-to-end WITHOUT the IDE.
 *
 * Usage:
 *   node scripts/qwen-smoke.mjs            # real send round-trip via channel-manager
 *   node scripts/qwen-smoke.mjs --ask      # one-shot ask-service engine (AI trio)
 *   node scripts/qwen-smoke.mjs --both     # both
 *
 * Env:
 *   QWEN_SMOKE_MODEL   model id (default: omit model → follow ~/.qwen/settings.json)
 *   QWEN_SMOKE_TIMEOUT per-phase timeout ms (default: 120000)
 *
 * Exit code 0 = all phases passed.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const bridgeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-bridge');
const model = process.env.QWEN_SMOKE_MODEL || '';
const timeoutMs = Number(process.env.QWEN_SMOKE_TIMEOUT || 120_000);
const mode = process.argv[2] || '--send';

const log = (...a) => console.log('[smoke]', ...a);
const fail = (...a) => console.error('[smoke][FAIL]', ...a);

function runSend() {
  return new Promise((resolve) => {
    log(`phase 1: channel-manager qwen send (model=${model || 'follow-cli-config'})`);
    const child = spawn(process.execPath, ['channel-manager.js', 'qwen', 'send'], {
      cwd: bridgeDir,
      env: { ...process.env, QWEN_USE_STDIN: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const params = {
      message: 'Reply with exactly this text and nothing else: SMOKE_OK',
      // Empty sessionId = brand new session (SDK resume requires a valid uuid).
      sessionId: '',
      cwd: bridgeDir,
      permissionMode: 'default',
      model,
      streaming: true,
    };
    child.stdin.write(JSON.stringify(params));
    child.stdin.end();

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      fail('timed out waiting for result');
      child.kill();
      resolve(false);
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      const markers = {
        MESSAGE_START: out.includes('[MESSAGE_START]'),
        STREAM_START: out.includes('[STREAM_START]'),
        MESSAGE_END: out.includes('[MESSAGE_END]'),
      };
      // Result payload is the JSON line carrying the "success" field; other
      // JSON lines (e.g. daemon title_log events) may follow it.
      const lines = out.trim().split(/\r?\n/);
      let result = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.includes('"success"')) {
          try { result = JSON.parse(line); break; } catch { /* keep looking */ }
        }
      }
      log('markers:', JSON.stringify(markers));
      log('result :', JSON.stringify(result));
      const text = out.match(/\[CONTENT_DELTA\] (.*)/g)?.slice(-6).join('\n  ') || '(no content deltas)';
      log('last deltas:\n  ' + text);
      if (err.trim()) log('stderr tail:', err.trim().split(/\r?\n/).slice(-3).join(' | '));

      const ok = result?.success === true && markers.MESSAGE_START && markers.MESSAGE_END;
      if (ok) {
        log('phase 1 PASS');
      } else {
        fail('phase 1 failed');
        log('raw stdout tail:\n  ' + lines.slice(-15).join('\n  '));
      }
      resolve(ok);
    });
  });
}

async function runAsk() {
  log('phase 2: ask-service one-shot engine (AI trio)');
  try {
    const { askOneShot } = await import(pathToFileURL(join(bridgeDir, 'services', 'ask-service.js')).href);
    const answer = await askOneShot({
      provider: 'qwen',
      prompt: 'Reply with exactly this text and nothing else: ASK_OK',
      model,
      cwd: bridgeDir,
      timeoutMs,
    });
    const text = typeof answer === 'string' ? answer : (answer?.text ?? JSON.stringify(answer));
    log('answer:', JSON.stringify(text.slice(0, 200)));
    const ok = /ASK_OK/.test(text);
    if (ok) log('phase 2 PASS'); else fail('phase 2 failed (answer did not contain ASK_OK)');
    return ok;
  } catch (e) {
    fail('phase 2 threw:', e?.message || e);
    return false;
  }
}

const results = [];
if (mode === '--send' || mode === '--both') results.push(await runSend());
if (mode === '--ask' || mode === '--both') results.push(await runAsk());
const allOk = results.length > 0 && results.every(Boolean);
log(allOk ? 'ALL PASS' : 'SMOKE FAILED');
process.exit(allOk ? 0 : 1);
