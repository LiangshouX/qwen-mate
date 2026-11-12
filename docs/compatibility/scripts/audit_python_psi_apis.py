"""Audit the Python PSI APIs the plugin uses, against the Python plugin sources
of two IntelliJ Platform releases.

Why this exists
---------------
The plugin declares `externalPrefixes = ['com.jetbrains.python']`, so the JetBrains
Plugin Verifier cannot resolve *any* Python class on any IDE it verifies (IU bundles
no Python plugin). Every deprecation or removal on the Python side is therefore
completely invisible - the verification reports stay green while the Python support
silently rots.

This script closes the blind spot at the source level: it fetches the Python PSI
sources of the compile-time release and of the current `untilBuild` release from the
official intellij-community repository and checks the exact classes and methods the
plugin calls for deprecation markers.

Usage:
    python audit_python_psi_apis.py [243-tag] [263-tag]
"""
import os
import re
import sys
import tempfile
import urllib.request

# Downloaded sources are cached outside the repository (re-fetchable artifacts).
CACHE = os.path.join(tempfile.gettempdir(), 'qwenmate-platform-source-cache')
os.makedirs(CACHE, exist_ok=True)

DEFAULT_TAGS = {
    '243': 'idea/243.22562.145',
    '263': 'idea/263.7307.200',
}

# Python PSI types referenced by com.qwenmate.handler.context.PythonContextCollector
CLASSES = ['PyFile', 'PyFunction', 'PyClass', 'PyStatementList', 'PyStatement',
           'PyExpressionStatement', 'PyExpression', 'PyStringLiteralExpression',
           'PyParameter', 'PyParameterList', 'PyImportStatement', 'PyFromImportStatement',
           # getParameterList() is inherited: PyFunction extends PyAstFunction / PyCallable
           'PyCallable']

# The methods the plugin actually calls that are NOT inherited from PsiElement /
# PsiNamedElement - those are the ones that can disappear or change shape.
METHODS = {
    'PyFunction': ['getStatementList'],
    'PyCallable': ['getParameterList'],
    'PyClass': ['getSuperClassExpressions'],
    'PyStatementList': ['getStatements'],
    'PyExpressionStatement': ['getExpression'],
    'PyParameterList': ['getParameters'],
}

SOURCE_PREFIXES = [
    'python/python-psi-api/src/com/jetbrains/python/psi/',
    'python/python-psi/src/com/jetbrains/python/psi/',
]


def fetch(tag, cls):
    local = os.path.join(CACHE, '%s_py_%s.src' % (tag.replace('/', '_'), cls))
    if os.path.exists(local):
        return open(local, encoding='utf-8', errors='replace').read()
    for prefix in SOURCE_PREFIXES:
        for ext in ('.java', '.kt'):
            url = 'https://raw.githubusercontent.com/JetBrains/intellij-community/%s/%s%s%s' \
                  % (tag, prefix, cls, ext)
            try:
                data = urllib.request.urlopen(url, timeout=90).read().decode('utf-8', 'replace')
            except Exception:
                continue
            with open(local, 'w', encoding='utf-8') as fh:
                fh.write(data)
            return data
    return None


def annotation_above(lines, index):
    """Collect the annotation / javadoc block directly above `lines[index]`."""
    ctx = []
    j = index - 1
    while j >= 0 and lines[j].strip():
        ctx.append(lines[j].strip())
        j -= 1
    ctx.reverse()
    return ctx


def class_is_deprecated(lines, cls):
    for i, ln in enumerate(lines):
        if re.search(r'\b(interface|class)\s+%s\b' % re.escape(cls), ln) \
                and 'public' in ln:
            ctx = annotation_above(lines, i)
            return any('@Deprecated' in c for c in ctx) or '@Deprecated' in ln
    return False


def method_is_deprecated(lines, name):
    """Return (found, deprecated) for the first declaration of `name`."""
    for i, ln in enumerate(lines):
        stripped = ln.strip()
        if stripped.startswith('//') or stripped.startswith('*'):
            continue
        if re.search(r'\b%s\s*\(' % re.escape(name), ln):
            ctx = annotation_above(lines, i)
            return True, (any('@Deprecated' in c for c in ctx) or '@Deprecated' in ln)
    return False, False


def audit(tag):
    print('=' * 74)
    print('TAG %s' % tag)
    print('=' * 74)
    problems = []
    for cls in CLASSES:
        text = fetch(tag, cls)
        if text is None:
            print('  %-26s <source not found>' % cls)
            problems.append('%s: source not found' % cls)
            continue
        lines = text.splitlines()
        cls_dep = class_is_deprecated(lines, cls)
        print('  %-26s class: %s' % (cls, 'DEPRECATED' if cls_dep else 'ok'))
        if cls_dep:
            problems.append('%s: class deprecated' % cls)
        for m in METHODS.get(cls, []):
            found, dep = method_is_deprecated(lines, m)
            if not found:
                print('      %-26s <not found>' % m)
                problems.append('%s.%s: not found' % (cls, m))
                continue
            print('      %-26s %s' % (m, 'DEPRECATED' if dep else 'ok'))
            if dep:
                problems.append('%s.%s: deprecated' % (cls, m))
    print()
    return problems


def main():
    tags = sys.argv[1:] or list(DEFAULT_TAGS.values())
    all_problems = []
    for tag in tags:
        all_problems += audit(tag)
    print('=' * 74)
    if all_problems:
        print('PROBLEMS FOUND:')
        for p in all_problems:
            print('  ' + p)
        return 1
    print('No deprecated Python PSI APIs among the ones the plugin uses.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
