"""Verify the platform APIs the P0-c refactor relies on, across 233 / 243 / 263.

Why source and not the SDK jar
------------------------------
The 263 IDE distribution is ~630 MB and downloads at ~0.6 MB/s, so a jar-level
audit of 263 was impractical. The IntelliJ Platform source at the official
release tags is authoritative for @Deprecated markers and is a few KB per
class, so it is fetched from GitHub instead:

    https://raw.githubusercontent.com/JetBrains/intellij-community/<tag>/<path>

Tags used:
    233 -> idea/233.11799.300
    243 -> idea/243.22562.145
    263 -> idea/263.7307.200

What it checks
--------------
1. Does the member exist in each version?
2. Is it marked @Deprecated (Java annotation, Kotlin @Deprecated, or the
   @deprecated javadoc tag) in that version?
3. Do the constructor signatures we call keep the same descriptor across
   versions? A changed return type or parameter list is a *silent* binary
   break: it compiles fine against one version and throws NoSuchMethodError
   on another. That is exactly what happened to
   FileEditorManager.requestOpenFile(VirtualFile) between 243 and 263.
"""
import os
import re
import sys
import tempfile
import urllib.request

TAGS = {
    '233': 'idea/233.11799.300',
    '243': 'idea/243.22562.145',
    '263': 'idea/263.7307.200',
}

# Downloaded sources are cached outside the repository - they are re-fetchable
# artifacts, not source, and must not show up as untracked files in git.
CACHE = os.path.join(tempfile.gettempdir(), 'qwenmate-platform-source-cache')
os.makedirs(CACHE, exist_ok=True)

FILES = {
    'FileEditorManager': 'platform/analysis-api/src/com/intellij/openapi/fileEditor/FileEditorManager',
    'OpenFileDescriptor': 'platform/analysis-api/src/com/intellij/openapi/fileEditor/OpenFileDescriptor',
}

# members whose presence/deprecation we care about, per class
WATCH = {
    'FileEditorManager': ['requestOpenFile', 'getAllEditors', 'getSelectedTextEditor',
                          'selectedTextEditor', 'openFile', 'openTextEditor', 'openEditor'],
    'OpenFileDescriptor': ['navigate', 'navigateInEditor'],
}


def fetch(tag, rel_path):
    """rel_path without the file extension; tries .java then .kt."""
    local = os.path.join(CACHE, tag.replace('/', '_') + '_' +
                         rel_path.replace('/', '_') + '.src')
    if os.path.exists(local):
        return open(local, encoding='utf-8', errors='replace').read()
    for ext in ('.java', '.kt'):
        url = 'https://raw.githubusercontent.com/JetBrains/intellij-community/%s/%s%s' \
              % (tag, rel_path, ext)
        try:
            data = urllib.request.urlopen(url, timeout=120).read().decode('utf-8', 'replace')
        except Exception:
            continue
        with open(local, 'w', encoding='utf-8') as fh:
            fh.write(data)
        return data
    return None


def declarations(text, name):
    """Return [(line_no, decl_line, is_deprecated, context)] for every
    declaration of `name` in the source."""
    lines = text.splitlines()
    out = []
    pattern = re.compile(r'\b%s\b\s*[\(:=]' % re.escape(name))
    for i, ln in enumerate(lines):
        stripped = ln.strip()
        if stripped.startswith('//') or stripped.startswith('*'):
            continue
        if not pattern.search(ln):
            continue
        # walk backwards over the annotation / javadoc block
        ctx = []
        j = i - 1
        while j >= 0:
            prev = lines[j].strip()
            if prev == '':
                break
            ctx.append(prev)
            if prev.startswith('/*') or prev.startswith('/**'):
                break
            j -= 1
        ctx.reverse()
        blob = '\n'.join(ctx)
        dep = bool(re.search(r'@Deprecated\b', blob)) or \
            bool(re.search(r'@deprecated\b', blob, re.IGNORECASE)) or \
            bool(re.search(r'@Deprecated\b', ln))
        out.append((i + 1, stripped, dep, blob))
    return out


def constructors(text, cls):
    """Return the constructor signatures declared for `cls`."""
    out = []
    for ln in text.splitlines():
        s = ln.strip()
        if re.search(r'\b%s\s*\(' % re.escape(cls), s) and 'new ' not in s:
            if 'public ' in s or s.startswith(cls) or 'constructor' in s:
                out.append(s.rstrip('{').strip())
    return out


def main():
    versions = sys.argv[1:] or ['233', '243', '263']
    for v in versions:
        tag = TAGS.get(v, v)
        print('=' * 78)
        print('VERSION %s  (tag %s)' % (v, tag))
        print('=' * 78)
        for cls, members in WATCH.items():
            text = fetch(tag, FILES[cls])
            if text is None:
                print('\n=== %s  -- SOURCE NOT FOUND\n' % cls)
                continue
            print('\n=== %s  (%d bytes)' % (cls, len(text)))
            if cls == 'OpenFileDescriptor':
                print('    constructors:')
                for c in constructors(text, 'OpenFileDescriptor'):
                    print('      %s' % c)
            for m in members:
                rows = declarations(text, m)
                if not rows:
                    print('    %-24s <not present>' % m)
                    continue
                for ln_no, decl, dep, ctx in rows:
                    tag_txt = 'DEPRECATED' if dep else 'ok'
                    print('    %-24s line %-6d %-11s | %s'
                          % (m, ln_no, tag_txt, decl[:96]))
                    if dep:
                        for cl in ctx.splitlines():
                            if 'eprecated' in cl:
                                print('            ^ %s' % cl.strip()[:110])
            print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
