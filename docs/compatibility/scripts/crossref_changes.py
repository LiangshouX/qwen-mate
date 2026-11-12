"""Cross-reference JetBrains' official incompatible-changes lists against the
plugin's own API surface.

The Plugin Verifier only reports what has *already* been deprecated in the IDE
build it ran against. This script finds the items that are queued up: every
class / method / field named in the 2023-2026 official change lists, matched
against the symbols the plugin actually uses.
"""
import os
import re
import json


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
CHANGES = os.path.join(HERE, 'apichanges')
SURFACE = os.path.join(HERE, 'ide-api-surface.json')
OUT = os.path.join(HERE, 'official-changes-crossref.json')

TOKEN_RE = re.compile(r'`([^`]+)`')
DESC_RE = re.compile(r'^:\s*(.+)')

MEMBER_KINDS = ('field ', 'method ', 'marked abstract', 'abstract method added',
                'constructor ', 'now extends', 'now implements')
CLASS_KINDS = ('class removed', 'class renamed', 'class moved', 'package removed',
               'class now')


def split_token(tok, kind):
    """Split 'a.b.C.member' into ('a.b.C', 'member') when the entry is a member."""
    if kind is None:
        return tok, None
    if kind.startswith('class ') or kind == 'package removed':
        return tok, None
    if '.' not in tok:
        return tok, None
    cls, member = tok.rsplit('.', 1)
    # Heuristic: a member name starts with an uppercase letter (field/const)
    # or is a lowerCamel method. Heuristic risk is low here because the
    # plugin's touched members are few.
    return cls, member


def parse_changes(path):
    out = []
    year = None
    section = None
    pending = None
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('#'):
            m = re.match(r'#+\s*(\d{4}\.\d+)', line)
            if m:
                year = m.group(1)
            continue
        if line.startswith('### '):
            section = line[4:].strip()
            continue
        m = TOKEN_RE.match(line)
        if m and line.startswith('`'):
            tok = m.group(1)
            low = line.lower()
            kind = None
            for kw in ('class renamed to', 'class moved to', 'class removed',
                       'package removed', 'field type changed', 'field removed',
                       'field moved to', 'field visibility changed',
                       'method removed', 'method moved to the superclass',
                       'method return type changed', 'method visibility changed',
                       'method marked final', 'method parameter type changed',
                       'method parameter removed', 'marked abstract',
                       'abstract method added', 'constructor removed',
                       'constructor parameter type changed',
                       'constructor parameter removed',
                       'constructor visibility changed',
                       'now extends', 'now implements'):
                if kw in low:
                    kind = kw
                    break
            cls, member = split_token(tok, kind)
            pending = {'year': year, 'section': section, 'cls': cls,
                       'member': member, 'kind': kind, 'raw': line, 'note': ''}
            out.append(pending)
            continue
        d = DESC_RE.match(line)
        if d and pending is not None:
            pending['note'] = d.group(1).strip()
            pending = None
    return out


def main():
    surf = json.load(open(SURFACE, encoding='utf-8'))
    symbols = surf['symbols']

    # class -> set of members the plugin touches on it
    class_members = {}
    all_classes = set()
    for s in symbols:
        parts = s.split('.')
        for i in range(len(parts), 0, -1):
            all_classes.add('.'.join(parts[:i]))
        if len(parts) >= 2:
            class_members.setdefault('.'.join(parts[:-1]), set()).add(parts[-1])

    entries = []
    for y in ('2023', '2024', '2025', '2026'):
        p = os.path.join(CHANGES, '%s.md' % y)
        if os.path.exists(p):
            entries.extend(parse_changes(p))

    hits = []
    for e in entries:
        cls, member = e['cls'], e['member']
        if cls in all_classes:
            if member and member in class_members.get(cls, set()):
                sym = '%s.%s' % (cls, member)
                hits.append((e, 'EXACT', sym))
            elif member:
                hits.append((e, 'CLASS-HIT/MEMBER-NOT-USED', cls))
            else:
                hits.append((e, 'CLASS', cls))
        else:
            # maybe the plugin imports a member of a class we do track
            for c, members in class_members.items():
                if member and member in members and c.startswith(cls.split('.')[0]):
                    hits.append((e, 'MEMBER-ONLY', '%s.%s' % (c, member)))
                    break

    print('official change entries parsed : %d' % len(entries))
    print('plugin symbols / classes       : %d / %d'
          % (len(symbols), len(all_classes)))
    print('matches                         : %d' % len(hits))
    print()
    for e, kind, sym in hits:
        print('[%s | %s] %s' % (e['year'], kind, e['raw'][:140]))
        if e['note']:
            print('      -> %s' % e['note'][:240])
        if kind == 'EXACT':
            print('      used in: %s' % ', '.join(symbols.get(sym, [])[:5]))
        print()

    json.dump([{'year': e['year'], 'section': e['section'], 'raw': e['raw'],
                'note': e['note'], 'cls': e['cls'], 'member': e['member'],
                'sym': sym, 'kind': kind}
               for e, kind, sym in hits],
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('wrote %s' % OUT)


if __name__ == '__main__':
    main()
