"""Probe the 243 SDK for the replacement APIs the migration plan will rely on.

For every deprecated call site we must know the recommended replacement exists
in the OLDEST supported SDK (243), otherwise "fix the deprecation" would break
the 233..243 half of the supported range.
"""
import os
import sys


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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_sdk_deprecations import index_sdk, load_class, summarize

idx, _jars = index_sdk()

CHECKS = [
    ('com.intellij.openapi.actionSystem.ExecutionDataKeys', ['CONSOLE_VIEW']),
    ('com.intellij.openapi.actionSystem.LangDataKeys', ['CONSOLE_VIEW']),
    ('com.intellij.DynamicBundle', ['<init>']),
    ('com.intellij.AbstractBundle', ['<init>']),
    ('com.intellij.openapi.fileEditor.FileEditorManager',
     ['openFile', 'openTextEditor', 'requestOpenFile', 'requestOpenTextEditor']),
    ('com.intellij.openapi.fileEditor.OpenFileDescriptor',
     ['navigate', 'navigateIn', '<init>']),
    ('com.intellij.openapi.components.PropertiesComponent', []),
    ('com.intellij.ide.util.PropertiesComponent', []),
    ('com.intellij.execution.ui.ConsoleView', []),
    ('com.intellij.execution.impl.ConsoleViewImpl', []),
    ('com.intellij.pom.Navigatable', []),
    ('com.intellij.util.OpenSourceUtil', []),
    ('com.intellij.openapi.startup.StartupActivity', []),
    ('com.intellij.openapi.startup.ProjectActivity', []),
]


def show(cls, members):
    if cls not in idx:
        print('\n### %s  -- NOT PRESENT IN SDK 243' % cls)
        return
    try:
        cf, jar = load_class(idx, cls)
    except Exception as e:
        print('\n### %s  -- PARSE ERROR %s' % (cls, e))
        return
    s = summarize(cf, jar)
    print('\n### %s   (%s)' % (cls, s['jar']))
    print('    deprecatedClass=%s internal=%s experimental=%s obsolete=%s'
          % (s['deprecatedClass'], s['internal'], s['experimental'], s['obsolete']))
    if s['classAnnotations']:
        print('    classAnnotations: %s' % s['classAnnotations'])
    by_name = {}
    for m in s['members']:
        by_name.setdefault(m['name'], []).append(m)
    for name in members:
        lst = by_name.get(name, [])
        if not lst:
            print('    %-24s <ABSENT>' % name)
        for m in lst:
            print('    %-24s %-74s dep=%-5s ann=%s'
                  % (name, m['desc'][:74], m['deprecated'],
                     m['annotations'] or '-'))
    dep = [(m['name'], m['desc']) for m in s['members'] if m['deprecated']]
    if dep:
        print('    !! deprecated members: %s'
              % ', '.join('%s%s' % (n, d[:50]) for n, d in dep[:8]))
    internal = [(m['name'], m['desc']) for m in s['members']
                if any('ApiStatus$Internal' in a for a in m['annotations'])]
    if internal:
        print('    !! @ApiStatus.Internal members: %s'
              % ', '.join('%s%s' % (n, d[:40]) for n, d in internal[:8]))


for cls, members in CHECKS:
    show(cls, members)
