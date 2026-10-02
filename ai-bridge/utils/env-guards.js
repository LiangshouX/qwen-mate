/**
 * Environment variable guards shared by the daemon and channel entry points.
 *
 * Classifies env vars that a request / settings.json payload may try to inject:
 * - webview-controlled vars (model selection) must never be
 *   overridden by stale settings values;
 * - dangerous vars can hijack process startup or load arbitrary code and must
 *   never be accepted from untrusted input at all.
 */

// Env vars whose value the webview owns per request. Settings.json copies of
// these must never be applied on top of the current request's selections.
//
// Model routing: ANTHROPIC_MODEL is the model-selection env var the downstream
// Qwen Code CLI reads (its model-provider env contract). The request's model is
// passed through the SDK args; a stale settings.json value must not shadow it.
const WEBVIEW_CONTROLLED_ENV_VAR_LIST = [
  'ANTHROPIC_MODEL',
];

export const WEBVIEW_CONTROLLED_ENV_VARS = Object.freeze(WEBVIEW_CONTROLLED_ENV_VAR_LIST);

const WEBVIEW_CONTROLLED_ENV_VAR_SET = new Set(
  WEBVIEW_CONTROLLED_ENV_VARS.map((varName) => varName.toUpperCase())
);

export function isWebviewControlledEnvVar(varName) {
  return WEBVIEW_CONTROLLED_ENV_VAR_SET.has(String(varName ?? '').toUpperCase());
}

// Security (C): environment variables that can hijack process startup or load arbitrary
// native/JS code. These must NEVER be accepted from request params / settings.json env,
// otherwise a malicious project's settings.json {env:{NODE_OPTIONS:'--require ...'}}
// would achieve code execution in the daemon or any child process the SDK spawns.
// NOTE: PATH is intentionally NOT listed — the daemon's legitimate PATH is supplied by the
// Java EnvironmentConfigurator, and blanket-rejecting PATH would risk breaking it.
const DANGEROUS_ENV_VAR_SET = new Set([
  'NODE_OPTIONS',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_EXTRA_CA_CERTS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'BASH_ENV',
  'ENV',
  'PERL5LIB',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'GIT_SSH_COMMAND',
  'GIT_EXTERNAL_DIFF',
]);

export function isDangerousEnvVar(varName) {
  return DANGEROUS_ENV_VAR_SET.has(String(varName ?? '').toUpperCase());
}
