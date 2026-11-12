"""Extract the complete IntelliJ / JetBrains API surface the plugin depends on.

Scans every Java source file under qwen-mate/src/main/java, collects imports
and fully-qualified usages of com.intellij.* / com.jetbrains.* symbols, and
reports them grouped by package so the deprecated-API audit has a full surface
list to work against (the verifier only reports what it can attribute to a
bytecode call site).
"""
import os
import re
import json
from collections import defaultdict


def _find_plugin_root():
    """Walk up from this script until the plugin repository root is found.

    The plugin root is the directory that contains `src/main/java` - that is
    unambiguous, unlike a bare directory name, and it keeps working no matter
    where this script is invoked from.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(8):
        if os.path.isdir(os.path.join(here, 'src', 'main', 'java')):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    raise SystemExit('plugin root not found (no src/main/java above %s)'
                     % os.path.abspath(__file__))

ROOT = os.path.join(_find_plugin_root(), 'src', 'main', 'java')
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IMPORT_RE = re.compile(r'^\s*import\s+(static\s+)?([\w.]+)\s*;', re.M)
FQCN_RE = re.compile(r'\b((?:com\.intellij|com\.jetbrains)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)')

# Imports that only appear in javadoc text or comments are not real usages.
COMMENT_RE = re.compile(r'/\*.*?\*/|//[^\n]*', re.S)


def main():
    files = []
    for dirpath, _dirs, names in os.walk(ROOT):
        for n in names:
            if n.endswith('.java'):
                files.append(os.path.join(dirpath, n))

    symbols = defaultdict(set)   # symbol -> set of source files
    static_symbols = defaultdict(set)
    fqcn_hits = defaultdict(set)

    for f in files:
        src = open(f, encoding='utf-8').read()
        code = COMMENT_RE.sub('', src)
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        for is_static, sym in IMPORT_RE.findall(code):
            if sym.startswith(('com.intellij', 'com.jetbrains')):
                if is_static:
                    static_symbols[sym].add(rel)
                else:
                    symbols[sym].add(rel)
        for sym in FQCN_RE.findall(code):
            fqcn_hits[sym].add(rel)

    # Imports plus fully-qualified references = full surface
    all_syms = set(symbols) | set(fqcn_hits)

    print('source files scanned : %d' % len(files))
    print('distinct IDE symbols : %d' % len(all_syms))
    print()

    by_pkg = defaultdict(list)
    for s in sorted(all_syms):
        parts = s.split('.')
        pkg = '.'.join(parts[:4]) if len(parts) >= 4 else '.'.join(parts[:-1])
        by_pkg[pkg].append(s)

    print('=== symbols by package ===')
    for pkg in sorted(by_pkg):
        print('\n[%s]  (%d)' % (pkg, len(by_pkg[pkg])))
        for s in by_pkg[pkg]:
            refs = sorted(symbols.get(s, set()) | fqcn_hits.get(s, set()))
            tag = ' [static]' if s in static_symbols else ''
            print('   %-80s%s' % (s, tag))
            for r in refs:
                print('        <- %s' % r)

    out = {
        'files': len(files),
        'symbolCount': len(all_syms),
        'symbols': {s: sorted(symbols.get(s, set()) | fqcn_hits.get(s, set()))
                    for s in sorted(all_syms)},
        'staticSymbols': {s: sorted(v) for s, v in sorted(static_symbols.items())},
    }
    outp = os.path.join(HERE, 'ide-api-surface.json')
    with open(outp, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print('\nwrote %s' % outp)


if __name__ == '__main__':
    main()
