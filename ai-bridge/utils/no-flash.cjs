/**
 * Windows console-flash guard (CJS, loaded first in every entry process).
 *
 * On Windows a console-app child spawned from a console-less parent gets a
 * brand-new VISIBLE console — every SDK MCP server / shim / helper spawn then
 * flashes a terminal window.  Forcing windowsHide gives each spawn a windowless
 * console (all descendants inherit it), and neutralizing detached avoids the
 * DETACHED_PROCESS no-console trap.  Loaded via import at entry tops and via
 * NODE_OPTIONS=--require so node descendants inherit it too.
 */
'use strict';

const cp = require('node:child_process');

if (process.platform === 'win32' && !cp.__qwenMateNoFlash) {
  Object.defineProperty(cp, '__qwenMateNoFlash', { value: true, enumerable: false });

  const patchOptions = (args) => {
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (typeof a === 'function') return;
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        a.windowsHide = true;
        if (a.detached === true) a.detached = false;
        return;
      }
    }
  };

  for (const name of ['spawn', 'exec', 'execFile', 'spawnSync', 'execSync', 'execFileSync']) {
    const orig = cp[name];
    if (typeof orig !== 'function') continue;
    const wrapped = function (...args) {
      patchOptions(args);
      return orig.apply(this, args);
    };
    Object.defineProperty(wrapped, 'name', { value: orig.name });
    cp[name] = wrapped;
  }

  // Propagate the guard to every node descendant (SDK cli.js, subagents, …):
  // child node processes preload this file too, so their own spawns — including
  // detached ones — stay hidden-console on Windows.  NODE_OPTIONS tokenizes
  // backslashes away, so the path must be quoted with forward slashes.
  const requireFlag = `--require "${__filename.replace(/\\/g, '/')}"`;
  const current = process.env.NODE_OPTIONS || '';
  if (!current.includes('no-flash.cjs')) {
    process.env.NODE_OPTIONS = current ? `${current} ${requireFlag}` : requireFlag;
  }
}

module.exports = {};
