"""Check the compiled plugin classes for calls to the deprecated platform APIs.

The Plugin Verifier reports a "deprecated API usage" precisely when the plugin
bytecode invokes a deprecated platform member. So scanning the compiled classes
for the relevant method references tells us exactly how many of the six
verifier findings are still present - without needing the 2 GB IDE download.

Descriptors are tracked as well as names, because several of the watched
members have a deprecated and a non-deprecated overload (e.g.
DynamicBundle(String) vs DynamicBundle(Class, String)).

Usage:
    python check_compiled_refs.py [path-to-classes-dir]
"""
import io
import os
import struct
import sys

DEFAULT_CLASSES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               '..', '..', '..', 'build',
                               'classes', 'java', 'main')

# (owner class, member name) -> description
WATCH = {
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'openFile'):
        'FileEditorManager.openFile(...)',
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'openTextEditor'):
        'FileEditorManager.openTextEditor(...)',
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'requestOpenFile'):
        'FileEditorManager.requestOpenFile(VirtualFile)',
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'getAllEditors'):
        'FileEditorManager.getAllEditors(VirtualFile)',
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'getSelectedTextEditor'):
        'FileEditorManager.getSelectedTextEditor()',
    ('com/intellij/openapi/fileEditor/OpenFileDescriptor', 'navigate'):
        'OpenFileDescriptor.navigate(boolean)',
    ('com/intellij/openapi/fileEditor/FileDocumentManager', 'getDocument'):
        'FileDocumentManager.getDocument(VirtualFile)',
    ('com/intellij/openapi/fileEditor/FileDocumentManager', 'getFile'):
        'FileDocumentManager.getFile(Document)',
    ('com/intellij/openapi/fileEditor/TextEditor', 'getEditor'):
        'TextEditor.getEditor()',
    ('com/intellij/DynamicBundle', '<init>'):
        'DynamicBundle.<init>(...)',
    ('com/intellij/openapi/actionSystem/LangDataKeys', 'CONSOLE_VIEW'):
        'LangDataKeys.CONSOLE_VIEW',
    ('java/net/URL', '<init>'):
        'java.net.URL.<init>(...)',
    ('com/intellij/pom/Navigatable', 'navigate'):
        'com.intellij.pom.Navigatable.navigate(boolean)',
}

# Exact descriptors that the 2026.3 verifier flags as deprecated.
# (owner, name) -> set of deprecated descriptors; None => every overload is deprecated.
DEPRECATED_DESTS = {
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'openFile'): None,
    ('com/intellij/openapi/fileEditor/FileEditorManager', 'openTextEditor'): None,
    ('com/intellij/DynamicBundle', '<init>'): {'(Ljava/lang/String;)V'},
    ('com/intellij/openapi/actionSystem/LangDataKeys', 'CONSOLE_VIEW'): None,
    ('java/net/URL', '<init>'): {
        '(Ljava/lang/String;)V',
        '(Ljava/lang/String;Ljava/net/URL;)V',
    },
    ('com/intellij/pom/Navigatable', 'navigate'): {'(Z)V'},
}


class Cp:
    """Minimal constant-pool reader: enough to resolve member references."""

    def __init__(self, data):
        d = self.d = data
        self.pos = 0
        self.cp = {}
        assert struct.unpack('>I', d.read(4))[0] == 0xCAFEBABE
        d.read(4)
        count = struct.unpack('>H', d.read(2))[0]
        i = 1
        while i < count:
            tag = d.read(1)[0]
            if tag == 1:
                n = struct.unpack('>H', d.read(2))[0]
                self.cp[i] = ('utf8', d.read(n).decode('utf-8', 'replace'))
            elif tag == 7:
                self.cp[i] = ('class', struct.unpack('>H', d.read(2))[0])
            elif tag == 8:
                self.cp[i] = ('string', struct.unpack('>H', d.read(2))[0])
            elif tag in (9, 10, 11):
                self.cp[i] = ('ref', struct.unpack('>HH', d.read(4)))
            elif tag == 12:
                self.cp[i] = ('nameandtype', struct.unpack('>HH', d.read(4)))
            elif tag == 3:
                self.cp[i] = ('int', d.read(4))
            elif tag == 4:
                self.cp[i] = ('float', d.read(4))
            elif tag == 5:
                self.cp[i] = ('long', d.read(8)); i += 1
            elif tag == 6:
                self.cp[i] = ('double', d.read(8)); i += 1
            elif tag == 15:  # MethodHandle
                self.cp[i] = ('methodhandle', d.read(3))
            elif tag == 16:  # MethodType
                self.cp[i] = ('methodtype', struct.unpack('>H', d.read(2))[0])
            elif tag == 17:  # Dynamic
                self.cp[i] = ('dynamic', struct.unpack('>HH', d.read(4)))
            elif tag == 18:  # InvokeDynamic
                self.cp[i] = ('invokedynamic', struct.unpack('>HH', d.read(4)))
            else:
                raise ValueError('tag %d' % tag)
            i += 1
        self.pos = d.tell()

    def utf8(self, idx):
        e = self.cp.get(idx)
        return e[1] if e and e[0] == 'utf8' else None

    def class_name(self, idx):
        e = self.cp.get(idx)
        if not e or e[0] != 'class':
            return None
        return self.utf8(e[1])

    def member_refs(self):
        """Yield (owner_class, member_name, descriptor) for every Fieldref/Methodref."""
        for idx, e in self.cp.items():
            if e[0] != 'ref':
                continue
            class_idx, nat_idx = e[1]
            owner = self.class_name(class_idx)
            nat = self.cp.get(nat_idx)
            if not nat or nat[0] != 'nameandtype':
                continue
            name = self.utf8(nat[1][0])
            desc = self.utf8(nat[1][1])
            yield owner, name, desc


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CLASSES)
    if not os.path.isdir(root):
        print('compiled classes not found: %s' % root)
        return 1

    hits = {}
    scanned = 0
    errors = 0
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            if not f.endswith('.class'):
                continue
            scanned += 1
            with open(os.path.join(dp, f), 'rb') as fh:
                data = fh.read()
            try:
                cp = Cp(io.BytesIO(data))
            except Exception as e:
                print('parse error %s: %s' % (f, e))
                errors += 1
                continue
            rel = os.path.relpath(os.path.join(dp, f), root)
            for owner, name, desc in cp.member_refs():
                key = (owner, name)
                if key in WATCH:
                    hits.setdefault(key, set()).add((rel, desc))

    dep_total = 0
    rows = []
    for key, label in WATCH.items():
        sites = sorted(hits.get(key, []))
        dep_descs = DEPRECATED_DESTS.get(key) if key in DEPRECATED_DESTS else set()
        dep_sites = []
        if key in DEPRECATED_DESTS and dep_descs is None:
            dep_sites = sites
        elif dep_descs:
            dep_sites = [s for s in sites if s[1] in dep_descs]
        dep_total += len(dep_sites)
        rows.append((label, key in DEPRECATED_DESTS, sites, dep_sites))

    print('scanned %d class files (%d parse errors)\n' % (scanned, errors))
    print('%-56s %-6s %s' % ('API', 'calls', 'deprecated calls'))
    print('-' * 96)
    for label, watched_dep, sites, dep_sites in rows:
        flag = 'YES' if watched_dep else '-'
        print('%-56s %-6d %d   [%s]' % (label, len(sites), len(dep_sites), flag))
        for rel, desc in sites:
            mark = '  DEPRECATED' if (rel, desc) in dep_sites else ''
            print('      %-70s %s%s' % (rel, desc, mark))

    print('\n=> remaining deprecated call sites in compiled output: %d' % dep_total)
    return 0


if __name__ == '__main__':
    sys.exit(main())
