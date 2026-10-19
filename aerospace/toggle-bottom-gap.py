#!/usr/bin/env python3
"""Toggle a bottom gap on the focused AeroSpace monitor."""
import fcntl
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

AEROSPACE = shutil.which('aerospace')
P = 0.13

def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=15).strip()

def toggle():
    if not AEROSPACE:
        raise RuntimeError('aerospace is not on PATH; install it before toggling gaps')
    config = Path(run(AEROSPACE, 'config', '--config-path')).resolve()
    with config.with_suffix('.bottom-gap.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        monitor = run(AEROSPACE, 'list-monitors', '--focused', '--format',
                      '%{monitor-name}%{tab}%{monitor-appkit-nsscreen-screens-id}')
        name, index = monitor.rsplit('\t', 1)
        heights = json.loads(run('/usr/bin/osascript', '-l', 'JavaScript', '-e',
            'ObjC.import("AppKit"); JSON.stringify(ObjC.unwrap($.NSScreen.screens).map(s => s.frame.size.height))'))
        height = heights[int(index) - 1]
        if not 100 <= height <= 20000:
            raise ValueError(f'Unexpected screen height: {height}')
        original = config.read_text()
        parsed = tomllib.loads(original)
        gap = parsed['gaps']['outer']['bottom']
        entries = [gap] if isinstance(gap, int) else list(gap)
        pattern = '^' + re.escape(name) + '$'
        matching = [i for i, item in enumerate(entries)
                    if isinstance(item, dict) and pattern in item.get('monitor', {})]
        if matching:
            pos = matching[0]
            old = entries[pos]['monitor'][pattern]
            entries.pop(pos)
        else:
            old = 0
        value = 0 if old else round(height * P)
        entries.insert(0, {'monitor': {pattern: value}})
        parts = []
        for entry in entries:
            if isinstance(entry, int):
                parts.append(str(entry))
            else:
                for key, amount in entry['monitor'].items():
                    parts.append('{ monitor.' + json.dumps(key, ensure_ascii=False) + ' = ' + str(amount) + ' }')
        replacement = '    outer.bottom = [' + ', '.join(parts) + ']'
        section = re.search(r'(?ms)^\[gaps\]\s*\n(.*?)(?=^\[|\Z)', original)
        if section is None:
            raise ValueError('Cannot find [gaps] section')
        body, count = re.subn(r'(?m)^\s*outer\.bottom\s*=\s*[^\n]+', lambda _: replacement, section.group(1))
        if count != 1:
            raise ValueError('Expected one single-line outer.bottom setting')
        updated = original[:section.start(1)] + body + original[section.end(1):]
        tomllib.loads(updated)
        if config.read_text() != original:
            raise RuntimeError('Configuration changed during toggle')
        config.write_text(updated)
        try:
            run(AEROSPACE, 'reload-config')
        except Exception:
            config.write_text(original)
            run(AEROSPACE, 'reload-config')
            raise
        print(f'{name}: bottom gap {value} pt ({"on" if value else "off"})')

if __name__ == '__main__':
    try:
        toggle()
        Path(__file__).with_suffix('.log').unlink(missing_ok=True)
    except Exception as error:
        detail = getattr(error, 'stderr', '') or str(error)
        Path(__file__).with_suffix('.log').write_text(detail + '\n')
        print(detail, file=sys.stderr)
        sys.exit(1)
