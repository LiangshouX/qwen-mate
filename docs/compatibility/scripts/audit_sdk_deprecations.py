"""Precise IntelliJ SDK deprecation / internal-API auditor.

Parses .class files directly (no javap text scraping) so the answer is exact:
  * ACC_DEPRECATED (0x00020000) on classes, fields and methods
  * RuntimeVisibleAnnotations: @ApiStatus.Internal / @ApiStatus.Experimental /
    @ApiStatus.Obsolete / @Deprecated

Cross-references the plugin's own API surface (ide-api-surface.json) with the
SDK, so every symbol the plugin touches gets a real status instead of a guess.
"""
import os
import io
import json
import struct
import zipfile


def _find_data_dir(marker):
    """Walk up from this script until a directory containing `marker` is found."""
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        if os.path.exists(os.path.join(here, marker)):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HERE = _find_data_dir('ide-api-surface.json')


def _find_sdk():
    """Locate the IntelliJ SDK the plugin is compiled against.

    The Gradle transform directory name contains a content hash that changes
    whenever the dependency is re-resolved, so it must be discovered rather
    than hard-coded. Falls back to the compile target declared in build.gradle.
    """
    caches = os.path.join(os.path.expanduser('~'), '.gradle', 'caches')
    wanted = 'ideaIC-2024.3.1-win'
    for dp, dn, fn in os.walk(caches):
        for d in dn:
            if d == wanted:
                return os.path.join(dp, d)
        # do not descend into the giant transformed trees twice
        if 'transformed' in dp:
            dn[:] = []
    return None


SDK = _find_sdk()
SURFACE = os.path.join(HERE, 'ide-api-surface.json')
OUT = os.path.join(HERE, 'sdk-243-deprecation-audit.json')

ACC_DEPRECATED = 0x00020000


class Reader:
    """Byte reader with an independent cursor."""

    def __init__(self, data):
        self.d = io.BytesIO(data)

    def u1(self):
        return struct.unpack('>B', self.d.read(1))[0]

    def u2(self):
        return struct.unpack('>H', self.d.read(2))[0]

    def u4(self):
        return struct.unpack('>I', self.d.read(4))[0]

    def bytes(self, n):
        return self.d.read(n)


class ClassFile:
    def __init__(self, data):
        self.r = Reader(data)
        self.cp = {}
        self._parse()

    def _parse(self):
        r = self.r
        assert r.u4() == 0xCAFEBABE
        r.u2(); r.u2()
        count = r.u2()
        i = 1
        while i < count:
            tag = r.u1()
            if tag == 1:
                n = r.u2()
                self.cp[i] = r.bytes(n).decode('utf-8', 'replace')
            elif tag in (3, 4):
                self.cp[i] = r.u4()
            elif tag in (5, 6):
                self.cp[i] = (r.u4(), r.u4()); i += 1
            elif tag in (7, 8, 16, 19, 20):
                self.cp[i] = r.u2()
            elif tag in (9, 10, 11, 12, 17, 18):
                self.cp[i] = (r.u2(), r.u2())
            elif tag == 15:
                r.u1(); r.u2(); self.cp[i] = None
            else:
                raise ValueError('bad cp tag %d' % tag)
            i += 1

        self.access = r.u2()
        self.this_class = r.u2()
        self.super_class = r.u2()
        n_ifaces = r.u2()
        for _ in range(n_ifaces):
            r.u2()
        self.fields = self._members()
        self.methods = self._members()
        self.class_annotations = self._annotations_of(self._attributes())

    def _members(self):
        r = self.r
        out = []
        for _ in range(r.u2()):
            flags = r.u2()
            name = self.cp[r.u2()]
            desc = self.cp[r.u2()]
            attrs = self._attributes()
            out.append({'name': name, 'desc': desc, 'flags': flags,
                        'deprecated': bool(flags & ACC_DEPRECATED),
                        'annotations': self._annotations_of(attrs)})
        return out

    def _attributes(self):
        r = self.r
        out = {}
        for _ in range(r.u2()):
            name = self.cp[r.u2()]
            length = r.u4()
            out[name] = r.bytes(length)
        return out

    def _annotations_of(self, attrs):
        raw = attrs.get('RuntimeVisibleAnnotations')
        if not raw:
            return []
        d = Reader(raw)
        n = d.u2()
        out = []
        for _ in range(n):
            out.append(self._annotation(d))
        return out

    def _annotation(self, d):
        type_desc = self.cp[d.u2()]
        pairs = d.u2()
        for _ in range(pairs):
            d.u2()                       # element name index
            self._element_value(d)
        return type_desc

    def _element_value(self, d):
        tag = chr(d.u1())
        if tag in 'BCDFIJSZs':
            d.u2()
        elif tag == 'e':
            d.u2(); d.u2()
        elif tag == 'c':
            d.u2()
        elif tag == '@':
            self._annotation(d)
        elif tag == '[':
            n = d.u2()
            for _ in range(n):
                self._element_value(d)

    def class_name(self):
        return self.cp[self.cp[self.this_class][1]].replace('/', '.')

    def member_annotations(self):
        return {m['name']: m['annotations'] for m in self.methods + self.fields}


def annotation_names(descs):
    out = []
    for t in descs:
        if t and t.startswith('L'):
            out.append(t[1:-1].replace('/', '.'))
    return out


def index_sdk():
    """fqcn -> (jar path, class entry).

    Platform jars (lib/) are indexed first and win over plugin jars, because
    kotlin-compiler.jar ships *shaded* copies of a subset of com.intellij.*
    (DynamicBundle, ide.util.PropertiesComponent, pom.Navigatable ...). Reading
    annotations from those copies would report the wrong deprecation status.
    """
    idx = {}
    jars = []
    for sub in ('lib', 'plugins'):
        root = os.path.join(SDK, sub)
        if not os.path.isdir(root):
            continue
        for dp, _d, names in os.walk(root):
            for n in names:
                if n.endswith('.jar'):
                    jars.append(os.path.join(dp, n))
    # platform lib/ first, then plugins
    jars.sort(key=lambda p: (0 if os.sep + 'lib' + os.sep in p else 1, p))
    for jar in jars:
        try:
            with zipfile.ZipFile(jar) as z:
                for e in z.namelist():
                    if not e.endswith('.class'):
                        continue
                    fqcn = e[:-6].replace('/', '.')
                    if fqcn not in idx:
                        idx[fqcn] = (jar, e)
        except Exception:
            pass
    return idx, jars


def load_class(idx, cls):
    jar, entry = idx[cls]
    with zipfile.ZipFile(jar) as z:
        return ClassFile(z.read(entry)), jar


def summarize(cf, jar=None):
    ann = annotation_names(cf.class_annotations)
    # Keep every overload: keying by simple name would collapse e.g.
    # DynamicBundle(String) and DynamicBundle(Class, String) into one entry
    # and silently hide the deprecated overload.
    members = []
    for m in cf.methods + cf.fields:
        mann = annotation_names(m['annotations'])
        # ACC_DEPRECATED is set by javac for @Deprecated. Kotlin's @Deprecated
        # only emits the annotation, never the flag - and the IntelliJ
        # Platform is largely Kotlin, so the annotation must count too.
        ann_dep = any(a in ('java.lang.Deprecated', 'kotlin.Deprecated')
                      for a in mann)
        members.append({
            'name': m['name'],
            'desc': m['desc'],
            'deprecated': bool(m['deprecated'] or ann_dep),
            'deprecatedBy': ('flag' if m['deprecated']
                             else ('annotation' if ann_dep else None)),
            'annotations': mann,
        })
    cls_dep = bool(cf.access & ACC_DEPRECATED) or any(
        a in ('java.lang.Deprecated', 'kotlin.Deprecated') for a in ann)
    return {
        'jar': os.path.relpath(jar, SDK) if jar else None,
        'deprecatedClass': cls_dep,
        'classAnnotations': ann,
        'internal': any('ApiStatus$Internal' in a for a in ann),
        'experimental': any('ApiStatus$Experimental' in a for a in ann),
        'obsolete': any('ApiStatus$Obsolete' in a for a in ann),
        'members': members,
    }


def main():
    idx, jars = index_sdk()
    print('SDK    : %s' % SDK)
    print('jars   : %d' % len(jars))
    print('classes: %d' % len(idx))

    surf = json.load(open(SURFACE, encoding='utf-8'))
    symbols = surf['symbols']

    resolved = {}
    for sym in symbols:
        parts = sym.split('.')
        for i in range(len(parts), 0, -1):
            cand = '.'.join(parts[:i])
            if cand in idx:
                resolved[sym] = (cand, '.'.join(parts[i:]) if i < len(parts) else None)
                break
        else:
            resolved[sym] = (None, None)

    classes = sorted({c for c, _ in resolved.values() if c})
    print('plugin symbols: %d -> classes: %d' % (len(symbols), len(classes)))

    info = {}
    errors = 0
    for i, cls in enumerate(classes, 1):
        try:
            cf, jar = load_class(idx, cls)
            info[cls] = summarize(cf, jar)
        except Exception as e:
            errors += 1
            info[cls] = {'error': '%s: %s' % (type(e).__name__, e)}
        if i % 40 == 0:
            print('  ... %d/%d' % (i, len(classes)))
    print('parse errors: %d' % errors)

    rows = []
    for sym in sorted(symbols):
        cls, member = resolved[sym]
        ci = info.get(cls, {})
        members = ci.get('members') or []
        hit = None
        if member:
            want = member.split('.')[-1]
            for m in members:
                if m['name'] == want and m['deprecated']:
                    hit = m
                    break
        rows.append({
            'symbol': sym,
            'class': cls,
            'member': member,
            'deprecatedClass': ci.get('deprecatedClass', False),
            'deprecatedMember': bool(hit),
            'deprecatedMemberDetail': hit,
            'internal': ci.get('internal', False),
            'experimental': ci.get('experimental', False),
            'obsolete': ci.get('obsolete', False),
            'classAnnotations': ci.get('classAnnotations', []),
            'jar': ci.get('jar'),
            'error': ci.get('error'),
            'refs': symbols[sym],
        })

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump({'sdk': SDK, 'rows': rows}, fh, ensure_ascii=False, indent=1)

    def flag(r):
        return (r['deprecatedClass'] or r['deprecatedMember'] or r['internal']
                or r['experimental'] or r['obsolete'])

    print('\n=== FLAGGED SYMBOLS in SDK 243 ===')
    for r in rows:
        if not flag(r):
            continue
        tags = []
        if r['deprecatedClass']:
            tags.append('DEPRECATED-CLASS')
        if r['deprecatedMember']:
            tags.append('DEPRECATED-MEMBER')
        if r['internal']:
            tags.append('INTERNAL')
        if r['experimental']:
            tags.append('EXPERIMENTAL')
        if r['obsolete']:
            tags.append('OBSOLETE')
        print('[%s] %s' % ('|'.join(tags), r['symbol']))
        for ref in r['refs'][:6]:
            print('     <- %s' % ref)

    print('\nflagged %d / %d symbols' % (sum(1 for r in rows if flag(r)), len(rows)))
    print('wrote %s' % OUT)


if __name__ == '__main__':
    main()
