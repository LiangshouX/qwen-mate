#!/usr/bin/env node

/**
 * AI Bridge Channel Manager
 * Unified bridge entry point for the Qwen SDK
 *
 * Command format:
 *   node channel-manager.js <provider> <command> [args...]
 *
 * Provider:
 *   qwen     - Qwen Code SDK (@qwen-code/sdk)
 *
 * Commands:
 *   send                - Send a message (parameters passed via stdin as JSON)
 *   sendWithAttachments - Send a message with attachments (qwen only)
 *   getSession          - Retrieve session message history
 *
 * Design notes:
 * - Single entry point that dispatches to different services based on the provider parameter
 * - sessionId/threadId is managed by the caller (Java side)
 * - Messages and other parameters are passed via stdin in JSON format
 */

// Shared utilities
import './utils/no-flash.cjs';
import { readStdinData } from './utils/stdin-utils.js';
import { handleQwenCommand } from './channels/qwen-channel.js';
import { getSdkStatus, isQwenSdkAvailable } from './utils/sdk-loader.js';

/**
 * Write a JSON payload to stdout and exit once the bytes are flushed.
 *
 * `console.log` followed by `process.exit` races the stdout buffer: for a
 * piped stdout the underlying `process.stdout.write` is asynchronous, and
 * `process.exit` does not wait for it to drain, truncating the JSON. Writing
 * explicitly and exiting in the flush callback guarantees the payload reaches
 * the OS pipe first. The timeout fallback ensures the process still terminates
 * if the callback never fires (e.g. a broken pipe).
 */
function writeJsonAndExit(payload, code = 0) {
  let exited = false;
  const exitNow = () => {
    if (!exited) {
      exited = true;
      process.exit(code);
    }
  };
  process.stdout.write(JSON.stringify(payload) + '\n', 'utf8', exitNow);
  setTimeout(exitNow, 5000);
}

// Diagnostic logging: startup info
console.error('[DIAG-ENTRY] ========== CHANNEL-MANAGER STARTUP ==========');
console.error('[DIAG-ENTRY] Node.js version:', process.version);
console.error('[DIAG-ENTRY] Platform:', process.platform);
console.error('[DIAG-ENTRY] CWD:', process.cwd());
console.error('[DIAG-ENTRY] argv:', process.argv);

// Parse command-line arguments
const provider = process.argv[2];
const command = process.argv[3];
const args = process.argv.slice(4);

// Diagnostic logging: argument info
console.error('[DIAG-ENTRY] Provider:', provider);
console.error('[DIAG-ENTRY] Command:', command);
console.error('[DIAG-ENTRY] Args:', args);

// Error handling
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT_ERROR]', error.message);
  writeJsonAndExit({
    success: false,
    error: error.message
  }, 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason);
  writeJsonAndExit({
    success: false,
    error: String(reason)
  }, 1);
});

/**
 * Handle system-level commands (e.g., SDK status checks)
 */
async function handleSystemCommand(command, args, stdinData) {
  switch (command) {
    case 'getSdkStatus':
      // Return the installation status of all SDKs
      const status = getSdkStatus();
      console.log(JSON.stringify({
        success: true,
        data: status
      }));
      break;

    case 'checkQwenSdk':
      // Check if the Qwen SDK is available
      console.log(JSON.stringify({
        success: true,
        available: isQwenSdkAvailable()
      }));
      break;

    default:
      throw new Error('Unknown system command: ' + command);
  }
}

const providerHandlers = {
  qwen: handleQwenCommand,
  system: handleSystemCommand
};

// Execute command
(async () => {
  console.error('[DIAG-EXEC] ========== STARTING EXECUTION ==========');
  try {
    // Validate provider
    console.error('[DIAG-EXEC] Validating provider...');
    if (!provider || !providerHandlers[provider]) {
      console.error('Invalid provider. Use "qwen" or "system"');
      writeJsonAndExit({
        success: false,
        error: 'Invalid provider: ' + provider
      }, 1);
      return;
    }

    // Validate command
    if (!command) {
      console.error('No command specified');
      writeJsonAndExit({
        success: false,
        error: 'No command specified'
      }, 1);
      return;
    }

    // Read stdin data
    console.error('[DIAG-EXEC] Reading stdin data...');
    const stdinData = await readStdinData(provider);
    console.error('[DIAG-EXEC] Stdin data received, keys:', stdinData ? Object.keys(stdinData) : 'null');

    // Dispatch to the appropriate provider handler
    console.error('[DIAG-EXEC] Dispatching to handler:', provider);
    const handler = providerHandlers[provider];
    await handler(command, args, stdinData);
    console.error('[DIAG-EXEC] Handler completed successfully');

    // IMPORTANT: Do not use process.exit(0) here -- it terminates the process
    // before the stdout buffer is fully flushed, which can truncate large JSON
    // output (e.g., the history returned by getSession).
    // Instead, set process.exitCode and let the process exit naturally so all I/O completes.
    process.exitCode = 0;

  } catch (error) {
    console.error('[COMMAND_ERROR]', error.message);
    writeJsonAndExit({
      success: false,
      error: error.message
    }, 1);
  }
})();
