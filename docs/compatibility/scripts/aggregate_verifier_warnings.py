"""Aggregate all JetBrains Plugin Verifier warning categories across every report.

Produces a full picture of which deprecated / experimental / internal APIs the
plugin touches, per IDE build, so the upgrade plan can start from the newest IDE.
"""
import json
import glob
import os
import re
from collections import defaultdict


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

ROOT = os.path.join(_find_data_dir('qwenmate-verifier-reports'),
                    'qwenmate-verifier-reports', 'reports-compact')

CATS = ['compatibilityWarnings', 'compatibilityProblems',
        'deprecatedApiUsages', 'experimentalApiUsages', 'internalApiUsages',
        'overrideOnlyApiUsages', 'nonExtendableApiUsages',
        'ignoredCompatibilityProblems', 'ignoredInternalApiUsages',
        'pluginStructureWarnings', 'pluginStructureErrors']


def entry_text(e):
    """Normalize one usage entry to (apiSignature, usageLocation, deprecatedInfo)."""
    if isinstance(e, str):
        return e, '', {}
    if isinstance(e, dict):
        api = e.get('apiElement') or e.get('apiSignature') or ''
        loc = e.get('usageLocation') or ''
        info = e.get('deprecationInfo') or {}
        return api, loc, info
    return str(e), '', {}


def api_key(text):
    """Extract the bare API signature, dropping the 'is invoked in' tail."""
    text = text.split('\n')[0].strip()
    m = re.match(r'^(.*?)\s+(?:is invoked in|is accessed in|is overridden in|usage)\b', text)
    if m:
        return m.group(1).strip()
    return text


def main():
    files = sorted(glob.glob(os.path.join(ROOT, '*.json')))
    per_cat = defaultdict(lambda: defaultdict(set))   # cat -> api -> builds
    per_loc = defaultdict(lambda: defaultdict(set))   # cat -> "api @ loc" -> builds
    cat_counts = defaultdict(lambda: defaultdict(int))  # cat -> build -> count
    removal = defaultdict(set)                        # api -> forRemoval/until info
    build_ids = set()
    versions = set()
    verdicts = defaultdict(list)

    for f in files:
        d = json.load(open(f, encoding='utf-8'))
        ide = d.get('ideVersion')
        ide = ide.get('ideVersion') if isinstance(ide, dict) else ide
        build_ids.add(ide)
        versions.add(d.get('updateId'))
        verdicts[d.get('verificationVerdict', '?')].append((ide, os.path.basename(f)))
        for c in CATS:
            for e in d.get(c) or []:
                api, loc, info = entry_text(e)
                key = api_key(api) or api_key(loc)
                per_cat[c][key].add(ide)
                per_loc[c]['%s  @  %s' % (key, loc)].add(ide)
                cat_counts[c][ide] += 1
                if info:
                    removal['%s | forRemoval=%s until=%s' % (
                        key, info.get('forRemoval'), info.get('untilVersion'))].add(ide)

    print('reports: %d   IDE builds: %d' % (len(files), len(build_ids)))
    print()
    print('=== verdict distribution ===')
    for v, items in sorted(verdicts.items()):
        print('  %-60s %d' % (str(v)[:60], len(items)))
    print()

    print('=== category x build counts ===')
    builds = sorted(build_ids)
    header = '  %-32s' % 'category' + ''.join('%12s' % b.split('-')[-1][:11] for b in builds)
    print(header)
    for c in CATS:
        if not per_cat[c]:
            continue
        row = '  %-32s' % c
        for b in builds:
            n = cat_counts[c].get(b, 0)
            row += '%12s' % (n if n else '-')
        print(row)
    print()

    for c in CATS:
        if not per_cat[c]:
            continue
        print('=' * 100)
        print('%s  (%d distinct APIs)' % (c.upper(), len(per_cat[c])))
        print('=' * 100)
        for api, builds_hit in sorted(per_cat[c].items(),
                                      key=lambda kv: (-len(kv[1]), kv[0])):
            print('  [%2d builds] %s' % (len(builds_hit), api))
            if len(builds_hit) <= 4:
                print('           builds: %s' % ', '.join(sorted(builds_hit)))
        if c == 'deprecatedApiUsages':
            print('  -- call sites --')
            for site, hits in sorted(per_loc[c].items()):
                print('     %s   [%d builds]' % (site, len(hits)))
        print()

    if removal:
        print('=' * 100)
        print('DEPRECATION METADATA (forRemoval / untilVersion)')
        print('=' * 100)
        for k, hits in sorted(removal.items()):
            print('  %-100s builds=%d' % (k, len(hits)))
        print()


if __name__ == '__main__':
    main()
