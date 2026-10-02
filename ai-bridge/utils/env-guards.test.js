import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWebviewControlledEnvVar,
  isDangerousEnvVar,
} from './env-guards.js';

test('isWebviewControlledEnvVar classifies model routing controls correctly', () => {
  assert.equal(isWebviewControlledEnvVar('ANTHROPIC_MODEL'), true);
  assert.equal(isWebviewControlledEnvVar('anthropic_model'), true); // case-insensitive
  assert.equal(isWebviewControlledEnvVar('HTTPS_PROXY'), false);
  assert.equal(isWebviewControlledEnvVar('ANTHROPIC_API_KEY'), false);
});

test('isDangerousEnvVar rejects code-execution and library-injection variables', () => {
  assert.equal(isDangerousEnvVar('NODE_OPTIONS'), true);
  assert.equal(isDangerousEnvVar('LD_PRELOAD'), true);
  assert.equal(isDangerousEnvVar('BASH_ENV'), true);
  assert.equal(isDangerousEnvVar('node_options'), true); // case-insensitive
  assert.equal(isDangerousEnvVar('PATH'), false);
  assert.equal(isDangerousEnvVar('ANTHROPIC_API_KEY'), false);
});
